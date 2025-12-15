import { useState, useEffect, useCallback, useRef } from "react";

export interface BotEvent {
  id?: number;
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR";
  type: string;
  message: string;
  meta?: Record<string, any> | null;
}

type WsStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

interface UseEventsWebSocketOptions {
  maxEvents?: number;
  autoConnect?: boolean;
}

export function useEventsWebSocket(options: UseEventsWebSocketOptions = {}) {
  const { maxEvents = 500, autoConnect = true } = options;
  
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const eventBufferRef = useRef<BotEvent[]>([]);
  const flushIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const maxEventsRef = useRef(maxEvents);
  const mountedRef = useRef(true);

  maxEventsRef.current = maxEvents;

  const getWsUrl = () => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = localStorage.getItem("WS_ADMIN_TOKEN") || "";
    return `${protocol}//${window.location.host}/ws/events${token ? `?token=${token}` : ""}`;
  };

  const flushBuffer = () => {
    if (eventBufferRef.current.length > 0 && mountedRef.current) {
      setEvents((prev) => {
        const newEvents = [...eventBufferRef.current, ...prev];
        eventBufferRef.current = [];
        return newEvents.slice(0, maxEventsRef.current);
      });
    }
  };

  const connectWs = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN || 
        wsRef.current?.readyState === WebSocket.CONNECTING) return;

    setStatus("connecting");
    setError(null);

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close();
          return;
        }
        setStatus("connected");
        setError(null);
        reconnectAttemptsRef.current = 0;

        if (flushIntervalRef.current) clearInterval(flushIntervalRef.current);
        flushIntervalRef.current = setInterval(flushBuffer, 300);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === "EVENTS_SNAPSHOT") {
            setEvents(data.payload || []);
          } else if (data.type === "BOT_EVENT") {
            eventBufferRef.current.unshift(data.payload);
          } else if (data.type === "ERROR") {
            setError(data.payload?.message || "Error desconocido");
          }
        } catch (e) {
          console.error("[WS] Error parseando mensaje:", e);
        }
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        
        setStatus("disconnected");
        wsRef.current = null;

        if (flushIntervalRef.current) {
          clearInterval(flushIntervalRef.current);
          flushIntervalRef.current = null;
        }

        if (event.code !== 4001 && event.code !== 1000) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;
          setStatus("reconnecting");
          
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) connectWs();
          }, delay);
        }
      };

      ws.onerror = () => {
        if (mountedRef.current) {
          setError("Error de conexión WebSocket");
        }
      };
    } catch (e) {
      setError("No se pudo establecer conexión WebSocket");
      setStatus("disconnected");
    }
  };

  const disconnectWs = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, "User disconnect");
      wsRef.current = null;
    }
    setStatus("disconnected");
  };

  const clearEvents = useCallback(() => {
    setEvents([]);
    eventBufferRef.current = [];
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    
    if (autoConnect) {
      connectWs();
    }
    
    return () => {
      mountedRef.current = false;
      disconnectWs();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = useCallback(() => connectWs(), []);
  const disconnect = useCallback(() => disconnectWs(), []);

  return {
    events,
    status,
    error,
    connect,
    disconnect,
    clearEvents,
    isConnected: status === "connected",
  };
}
