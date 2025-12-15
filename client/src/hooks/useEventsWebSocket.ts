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

  const getWsUrl = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = localStorage.getItem("WS_ADMIN_TOKEN") || "";
    return `${protocol}//${window.location.host}/ws/events${token ? `?token=${token}` : ""}`;
  }, []);

  const flushBuffer = useCallback(() => {
    if (eventBufferRef.current.length > 0) {
      setEvents((prev) => {
        const newEvents = [...eventBufferRef.current, ...prev];
        eventBufferRef.current = [];
        return newEvents.slice(0, maxEvents);
      });
    }
  }, [maxEvents]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    setError(null);

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        setError(null);
        reconnectAttemptsRef.current = 0;

        flushIntervalRef.current = setInterval(flushBuffer, 300);
      };

      ws.onmessage = (event) => {
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
        setStatus("disconnected");
        wsRef.current = null;

        if (flushIntervalRef.current) {
          clearInterval(flushIntervalRef.current);
          flushIntervalRef.current = null;
        }

        if (event.code !== 4001 && event.code !== 1000) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
          reconnectAttemptsRef.current++;
          setStatus("reconnecting");
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      ws.onerror = () => {
        setError("Error de conexión WebSocket");
      };
    } catch (e) {
      setError("No se pudo establecer conexión WebSocket");
      setStatus("disconnected");
    }
  }, [getWsUrl, flushBuffer]);

  const disconnect = useCallback(() => {
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
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
    eventBufferRef.current = [];
  }, []);

  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

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
