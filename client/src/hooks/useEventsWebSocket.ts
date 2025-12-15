import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";

export interface BotEvent {
  id?: number;
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  type: string;
  message: string;
  meta?: Record<string, any> | null;
}

type WsStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

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

  static getInstance(): EventsWebSocketSingleton {
    if (!window.__eventsWsSingleton) {
      console.log("[WS-Singleton] Creating new singleton instance");
      window.__eventsWsSingleton = new EventsWebSocketSingleton();
    }
    return window.__eventsWsSingleton;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.refCount++;
    console.log(`[WS-Singleton] subscribe called, refCount: ${this.refCount}, status: ${this.state.status}, ws: ${this.ws?.readyState}`);
    
    if (this.refCount === 1 && this.state.status === "disconnected") {
      this.connect();
    }
    
    return () => {
      this.listeners.delete(listener);
      this.refCount--;
      console.log(`[WS-Singleton] unsubscribe called, refCount: ${this.refCount}`);
    };
  }

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

  private getWsUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = localStorage.getItem("WS_ADMIN_TOKEN") || "";
    return `${protocol}//${window.location.host}/ws/events${token ? `?token=${token}` : ""}`;
  }

  private flushBuffer = (): void => {
    if (this.eventBuffer.length > 0) {
      const newEvents = [...this.eventBuffer, ...this.state.events].slice(0, this.maxEvents);
      this.eventBuffer = [];
      this.setState({ events: newEvents });
    }
  };

  connect(): void {
    console.log(`[WS-Singleton] connect() called, ws state: ${this.ws?.readyState}, lock: ${this.connectLock}`);
    
    if (this.connectLock) {
      console.log("[WS-Singleton] Connect locked, skipping");
      return;
    }
    
    if (this.ws?.readyState === WebSocket.OPEN || 
        this.ws?.readyState === WebSocket.CONNECTING) {
      console.log("[WS-Singleton] Already connected/connecting, skipping");
      return;
    }

    const now = Date.now();
    if (now - this.lastConnectTime < 2000) {
      console.log("[WS-Singleton] Too soon to reconnect, waiting...");
      if (!this.reconnectTimeout) {
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          this.connect();
        }, 2000 - (now - this.lastConnectTime));
      }
      return;
    }

    this.connectLock = true;
    this.lastConnectTime = now;
    this.setState({ status: "connecting", error: null });
    console.log("[WS-Singleton] Creating new WebSocket connection");

    try {
      const ws = new WebSocket(this.getWsUrl());
      this.ws = ws;

      ws.onopen = () => {
        console.log("[WS-Singleton] onopen");
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
        console.log(`[WS-Singleton] onclose: code=${event.code}, reason=${event.reason}, refCount=${this.refCount}`);
        this.ws = null;
        this.connectLock = false;
        
        if (this.flushInterval) {
          clearInterval(this.flushInterval);
          this.flushInterval = null;
        }

        if (event.code !== 4001 && event.code !== 1000 && this.refCount > 0) {
          const delay = Math.max(2000, Math.min(2000 * Math.pow(2, this.reconnectAttempts), 30000));
          this.reconnectAttempts++;
          console.log(`[WS-Singleton] Scheduling reconnect in ${delay}ms`);
          this.setState({ status: "reconnecting" });
          
          this.reconnectTimeout = setTimeout(() => {
            if (this.refCount > 0) this.connect();
          }, delay);
        } else {
          this.setState({ status: "disconnected" });
        }
      };

      ws.onerror = (e) => {
        console.log("[WS-Singleton] onerror", e);
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
