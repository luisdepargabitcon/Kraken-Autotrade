import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";

export interface BotEvent {
  id?: number;
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  type: string;
  message: string;
  meta?: Record<string, any> | null;
}

type WsStatus = "connecting" | "connected" | "disconnected" | "reconnecting" | "needsAuth";

interface WsState {
  events: BotEvent[];
  status: WsStatus;
  error: string | null;
}

type Listener = () => void;

declare global {
  interface Window {
    __eventsWsSingleton?: EventsWebSocketSingleton;
  }
}

class EventsWebSocketSingleton {
  private ws: WebSocket | null = null;
  private state: WsState = { events: [], status: "disconnected", error: null };
  private listeners: Set<Listener> = new Set();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private flushInterval: NodeJS.Timeout | null = null;
  private eventBuffer: BotEvent[] = [];
  private maxEvents = 500;
  private refCount = 0;
  private lastConnectTime = 0;
  private connectLock = false;
  private storageListenerAdded = false;

  static getInstance(): EventsWebSocketSingleton {
    if (!window.__eventsWsSingleton) {
      window.__eventsWsSingleton = new EventsWebSocketSingleton();
    }
    return window.__eventsWsSingleton;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.refCount++;
    
    // Add storage listener to auto-reconnect when token is saved
    if (!this.storageListenerAdded) {
      this.storageListenerAdded = true;
      window.addEventListener("storage", this.handleStorageChange);
      window.addEventListener("ws-tokens-updated", this.handleTokensUpdated);
    }
    
    if (this.refCount === 1 && (this.state.status === "disconnected" || this.state.status === "needsAuth")) {
      this.connect();
    }
    
    return () => {
      this.listeners.delete(listener);
      this.refCount--;
    };
  }

  private handleStorageChange = (e: StorageEvent): void => {
    if (e.key === "WS_ADMIN_TOKEN" && e.newValue && this.state.status === "needsAuth") {
      console.log("[WS-EVENTS] Token detectado en storage (cross-tab), intentando reconectar...");
      this.reconnectAttempts = 0;
      this.connect();
    }
  };

  private handleTokensUpdated = (e: Event): void => {
    try {
      const customEvent = e as CustomEvent<{ wsToken: boolean; terminalToken: boolean }>;
      if (customEvent.detail?.wsToken && this.state.status === "needsAuth") {
        console.log("[WS-EVENTS] Token actualizado (same-tab), intentando reconectar...");
        this.reconnectAttempts = 0;
        this.connect();
      }
    } catch (err) {
      console.warn("[WS-EVENTS] Error en handleTokensUpdated:", err);
    }
  };

  getSnapshot(): WsState {
    return this.state;
  }

  private notify(): void {
    this.listeners.forEach(listener => listener());
  }

  private setState(partial: Partial<WsState>): void {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  private getAuthToken(): string | null {
    try {
      const token = localStorage.getItem("WS_ADMIN_TOKEN");
      return token && token.trim() ? token.trim() : null;
    } catch (e) {
      console.warn("[WS-EVENTS] localStorage no disponible:", e);
      return null;
    }
  }

  private getWsUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = this.getAuthToken();
    return `${protocol}//${window.location.host}/ws/events${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  }

  private flushBuffer = (): void => {
    if (this.eventBuffer.length > 0) {
      const newEvents = [...this.eventBuffer, ...this.state.events].slice(0, this.maxEvents);
      this.eventBuffer = [];
      this.setState({ events: newEvents });
    }
  };

  connect(): void {
    if (this.connectLock) return;
    
    if (this.ws?.readyState === WebSocket.OPEN || 
        this.ws?.readyState === WebSocket.CONNECTING) return;

    const now = Date.now();
    if (now - this.lastConnectTime < 2000) {
      if (!this.reconnectTimeout) {
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          this.connect();
        }, 2000 - (now - this.lastConnectTime));
      }
      return;
    }

    // Check token BEFORE connecting
    const token = this.getAuthToken();
    const hasToken = !!token;
    console.log(`[WS-EVENTS] connect -> hasToken=${hasToken}`);
    
    if (!hasToken) {
      console.warn("[WS-EVENTS] No hay token configurado. Ve a Ajustes para configurar WS_ADMIN_TOKEN.");
      this.setState({ status: "needsAuth", error: "Token no configurado - ve a Ajustes" });
      return;
    }

    this.connectLock = true;
    this.lastConnectTime = now;
    this.setState({ status: "connecting", error: null });

    try {
      const ws = new WebSocket(this.getWsUrl());
      this.ws = ws;

      ws.onopen = () => {
        this.connectLock = false;
        this.setState({ status: "connected", error: null });
        this.reconnectAttempts = 0;

        if (this.flushInterval) clearInterval(this.flushInterval);
        this.flushInterval = setInterval(this.flushBuffer, 300);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === "EVENTS_SNAPSHOT") {
            this.setState({ events: data.payload || [] });
          } else if (data.type === "BOT_EVENT") {
            this.eventBuffer.unshift(data.payload);
          } else if (data.type === "ERROR") {
            this.setState({ error: data.payload?.message || "Error desconocido" });
          }
        } catch (e) {
          console.error("[WS] Error parseando mensaje:", e);
        }
      };

      ws.onclose = (event) => {
        this.ws = null;
        this.connectLock = false;
        
        if (this.flushInterval) {
          clearInterval(this.flushInterval);
          this.flushInterval = null;
        }

        // 4001 = auth error, 1000 = normal close - don't reconnect
        if (event.code === 4001) {
          console.warn("[WS-EVENTS] Conexión rechazada por token inválido/ausente. No se reintentará.");
          this.setState({ status: "needsAuth", error: "Token rechazado por el servidor" });
          return;
        }

        if (event.code !== 1000 && this.refCount > 0) {
          // Exponential backoff: 2s, 4s, 8s, 16s, 30s max
          const delay = Math.max(2000, Math.min(2000 * Math.pow(2, this.reconnectAttempts), 30000));
          this.reconnectAttempts++;
          console.log(`[WS-EVENTS] Reconectando en ${delay / 1000}s (intento ${this.reconnectAttempts})`);
          this.setState({ status: "reconnecting" });
          
          this.reconnectTimeout = setTimeout(() => {
            if (this.refCount > 0) this.connect();
          }, delay);
        } else {
          this.setState({ status: "disconnected" });
        }
      };

      ws.onerror = () => {
        this.setState({ error: "Error de conexión WebSocket" });
      };
    } catch (e) {
      this.connectLock = false;
      this.setState({ error: "No se pudo establecer conexión WebSocket", status: "disconnected" });
    }
  }

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    if (this.ws) {
      this.ws.close(1000, "User disconnect");
      this.ws = null;
    }
    this.setState({ status: "disconnected" });
  }

  clearEvents(): void {
    this.eventBuffer = [];
    this.setState({ events: [] });
  }
}

interface UseEventsWebSocketOptions {
  maxEvents?: number;
  autoConnect?: boolean;
}

export function useEventsWebSocket(_options: UseEventsWebSocketOptions = {}) {
  const singleton = EventsWebSocketSingleton.getInstance();
  
  const state = useSyncExternalStore(
    (listener) => singleton.subscribe(listener),
    () => singleton.getSnapshot()
  );

  const connect = useCallback(() => singleton.connect(), [singleton]);
  const disconnect = useCallback(() => singleton.disconnect(), [singleton]);
  const clearEvents = useCallback(() => singleton.clearEvents(), [singleton]);

  return {
    events: state.events,
    status: state.status,
    error: state.error,
    connect,
    disconnect,
    clearEvents,
    isConnected: state.status === "connected",
  };
}
