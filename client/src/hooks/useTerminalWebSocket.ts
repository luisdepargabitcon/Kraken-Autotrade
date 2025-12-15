import { useState, useEffect, useCallback, useRef } from "react";

export interface LogLine {
  id: number;
  timestamp: Date;
  line: string;
  sourceId: string;
  isError?: boolean;
}

export interface LogSource {
  id: string;
  name: string;
  type: "docker_compose" | "docker_container" | "file";
}

type WsStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

interface UseTerminalWebSocketOptions {
  maxLines?: number;
  autoConnect?: boolean;
}

export function useTerminalWebSocket(options: UseTerminalWebSocketOptions = {}) {
  const { maxLines = 500, autoConnect = true } = options;
  
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<LogSource[]>([]);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [dockerEnabled, setDockerEnabled] = useState(false);
  const [lineCount, setLineCount] = useState(0);
  const [lastLineTime, setLastLineTime] = useState<Date | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const lineIdRef = useRef(0);

  const getWsUrl = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = localStorage.getItem("TERMINAL_TOKEN") || "";
    return `${protocol}//${window.location.host}/ws/logs${token ? `?token=${token}` : ""}`;
  }, []);

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
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          switch (data.type) {
            case "WS_STATUS":
              setSources(data.payload.availableSources || []);
              setDockerEnabled(data.payload.dockerEnabled);
              break;
            case "LOG_LINE":
              lineIdRef.current++;
              const newLine: LogLine = {
                id: lineIdRef.current,
                timestamp: new Date(),
                line: data.payload.line,
                sourceId: data.payload.sourceId,
                isError: data.payload.isError,
              };
              setLines((prev) => [...prev, newLine].slice(-maxLines));
              setLineCount((c) => c + 1);
              setLastLineTime(new Date());
              break;
            case "SOURCE_CHANGED":
              setActiveSource(data.payload.sourceId);
              setLines([]);
              setLineCount(0);
              break;
            case "SOURCE_STOPPED":
              setActiveSource(null);
              break;
            case "ERROR":
              setError(data.payload?.message || "Error desconocido");
              break;
          }
        } catch (e) {
          console.error("[WS-LOGS] Error parseando mensaje:", e);
        }
      };

      ws.onclose = (event) => {
        setStatus("disconnected");
        wsRef.current = null;
        setActiveSource(null);

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
  }, [getWsUrl, maxLines]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, "User disconnect");
      wsRef.current = null;
    }
    setStatus("disconnected");
    setActiveSource(null);
  }, []);

  const startSource = useCallback((sourceId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "START_SOURCE", sourceId }));
    }
  }, []);

  const stopSource = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "STOP_SOURCE" }));
    }
  }, []);

  const clearLines = useCallback(() => {
    setLines([]);
    setLineCount(0);
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
    lines,
    status,
    error,
    sources,
    activeSource,
    dockerEnabled,
    lineCount,
    lastLineTime,
    connect,
    disconnect,
    startSource,
    stopSource,
    clearLines,
    isConnected: status === "connected",
  };
}
