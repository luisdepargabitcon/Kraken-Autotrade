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
  type: "docker_compose" | "docker_container" | "file" | "app_stdout";
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
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const lineIdRef = useRef(0);
  const storageListenerRef = useRef(false);
  const lastConnectedTokenRef = useRef<string | null>(null); // Track last successfully connected token

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

    // Get token but don't require it - server may allow unauthenticated connections
    const token = getAuthToken();
    console.log(`[WS-LOGS] connect -> hasToken=${!!token}`);

    setStatus("connecting");
    setError(null);

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        setError(null);
        reconnectAttemptsRef.current = 0;
        // Track the token that successfully connected (for change detection)
        lastConnectedTokenRef.current = getAuthToken();
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
            case "LOG_HISTORY":
              const historyLines: LogLine[] = (data.payload.lines || []).map((line: string, idx: number) => {
                lineIdRef.current++;
                return {
                  id: lineIdRef.current,
                  timestamp: new Date(),
                  line,
                  sourceId: data.payload.sourceId,
                  isError: line.includes("[ERROR]") || line.includes("[WARN"),
                };
              });
              setLines(historyLines.slice(-maxLines));
              setLineCount(historyLines.length);
              if (historyLines.length > 0) {
                setLastLineTime(new Date());
              }
              break;
            case "SOURCE_CHANGED":
              setActiveSource(data.payload.sourceId);
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

        // 4001 = auth error - server requires token but we don't have one or it's invalid
        if (event.code === 4001) {
          console.warn("[WS-LOGS] Conexión rechazada por token inválido/ausente. Configura el token en Ajustes.");
          // Clear any pending reconnect timeout when entering needsAuth state
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          reconnectAttemptsRef.current = 0;
          // Clear lastConnectedToken so same token can be retried after fix
          lastConnectedTokenRef.current = null;
          setStatus("needsAuth");
          setError("Token rechazado por el servidor - configura en Ajustes");
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
      // Only reconnect if: key is our token, there's a new non-empty value, and we need auth
      if (e.key === "TERMINAL_TOKEN" && e.newValue && e.newValue.trim() && status === "needsAuth") {
        // Double-check the token actually exists in localStorage AND is different from last attempt
        const token = getAuthToken();
        if (token && token !== lastConnectedTokenRef.current) {
          console.log("[WS-LOGS] Token nuevo detectado en storage (cross-tab), intentando reconectar...");
          reconnectAttemptsRef.current = 0;
          connect();
        }
      }
    };
    
    const handleTokensUpdated = (e: Event) => {
      try {
        const customEvent = e as CustomEvent<{ wsToken: boolean; terminalToken: boolean }>;
        // Only reconnect if the event says token was saved AND we need auth
        if (customEvent.detail?.terminalToken && status === "needsAuth") {
          // Double-check the token actually exists in localStorage AND is different from last attempt
          const token = getAuthToken();
          if (token && token !== lastConnectedTokenRef.current) {
            console.log("[WS-LOGS] Token nuevo actualizado (same-tab), intentando reconectar...");
            reconnectAttemptsRef.current = 0;
            connect();
          }
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
  }, [status, connect, getAuthToken]);

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
