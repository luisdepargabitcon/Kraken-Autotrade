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

type WsStatus = "connecting" | "connected" | "disconnected" | "reconnecting" | "needsAuth";

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
  const storageListenerRef = useRef(false);

  const getAuthToken = useCallback((): string | null => {
    try {
      const token = localStorage.getItem("TERMINAL_TOKEN");
      return token && token.trim() ? token.trim() : null;
    } catch (e) {
      console.warn("[WS-LOGS] localStorage no disponible:", e);
      return null;
    }
  }, []);

  const getWsUrl = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = getAuthToken();
    return `${protocol}//${window.location.host}/ws/logs${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  }, [getAuthToken]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Check token BEFORE connecting
    const token = getAuthToken();
    const hasToken = !!token;
    console.log(`[WS-LOGS] connect -> hasToken=${hasToken}`);
    
    if (!hasToken) {
      console.warn("[WS-LOGS] No hay token configurado. Ve a Ajustes para configurar TERMINAL_TOKEN.");
      setStatus("needsAuth");
      setError("Token no configurado - ve a Ajustes");
      return;
    }

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
        wsRef.current = null;
        setActiveSource(null);

        // 4001 = auth error, 1000 = normal close - don't reconnect
        if (event.code === 4001) {
          console.warn("[WS-LOGS] Conexión rechazada por token inválido/ausente. No se reintentará.");
          setStatus("needsAuth");
          setError("Token rechazado por el servidor");
          return;
        }

        if (event.code !== 1000) {
          // Exponential backoff: 1s, 2s, 4s, 8s, 10s max
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
          reconnectAttemptsRef.current++;
          console.log(`[WS-LOGS] Reconectando en ${delay / 1000}s (intento ${reconnectAttemptsRef.current})`);
          setStatus("reconnecting");
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          setStatus("disconnected");
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

  // Listen for storage changes and custom events to auto-reconnect when token is saved
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "TERMINAL_TOKEN" && e.newValue && status === "needsAuth") {
        console.log("[WS-LOGS] Token detectado en storage (cross-tab), intentando reconectar...");
        reconnectAttemptsRef.current = 0;
        connect();
      }
    };
    
    const handleTokensUpdated = (e: Event) => {
      try {
        const customEvent = e as CustomEvent<{ wsToken: boolean; terminalToken: boolean }>;
        if (customEvent.detail?.terminalToken && status === "needsAuth") {
          console.log("[WS-LOGS] Token actualizado (same-tab), intentando reconectar...");
          reconnectAttemptsRef.current = 0;
          connect();
        }
      } catch (err) {
        console.warn("[WS-LOGS] Error en handleTokensUpdated:", err);
      }
    };
    
    if (!storageListenerRef.current) {
      storageListenerRef.current = true;
      window.addEventListener("storage", handleStorageChange);
      window.addEventListener("ws-tokens-updated", handleTokensUpdated);
    }
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("ws-tokens-updated", handleTokensUpdated);
      storageListenerRef.current = false;
    };
  }, [status, connect]);

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
