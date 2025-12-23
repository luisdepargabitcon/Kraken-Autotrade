import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { spawn, ChildProcess } from "child_process";
import { log } from "../index";

const WS_PATH = "/ws/logs";
const MAX_LOG_HISTORY = 200;
const HEARTBEAT_INTERVAL = 30000;

interface WsClient extends WebSocket {
  isAlive: boolean;
  connectedAt: Date;
  activeSource: string | null;
  activeProcess: ChildProcess | null;
}

interface WsMessage {
  type: "LOG_LINE" | "LOG_HISTORY" | "WS_STATUS" | "ERROR" | "SOURCE_CHANGED" | "SOURCE_STOPPED";
  payload: any;
}

interface LogSource {
  id: string;
  name: string;
  type: "docker_compose" | "docker_container" | "file";
  command?: string[];
  containerName?: string;
  filePath?: string;
}

const PREDEFINED_SOURCES: LogSource[] = [
  {
    id: "docker_compose",
    name: "Docker Compose (todos)",
    type: "docker_compose",
    command: ["docker", "compose", "logs", "-f", "--tail=200"],
  },
  {
    id: "krakenbot_container",
    name: "KrakenBot Container",
    type: "docker_container",
    containerName: "kraken-bot-app",
  },
  {
    id: "postgres_container",
    name: "PostgreSQL Container",
    type: "docker_container",
    containerName: "kraken-bot-db",
  },
  {
    id: "app_log",
    name: "App Log File",
    type: "file",
    filePath: "/var/log/krakenbot/app.log",
  },
];

class TerminalWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WsClient> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private dockerEnabled: boolean = false;

  initialize(server: Server): void {
    this.dockerEnabled = process.env.ENABLE_DOCKER_LOGS_STREAM === "true";

    this.wss = new WebSocketServer({ 
      noServer: true,
      perMessageDeflate: false,
    });

    this.wss.on("connection", async (ws: WebSocket, req) => {
      const client = ws as WsClient;
      const clientIp = req.socket.remoteAddress || "unknown";
      const origin = req.headers.origin || "no-origin";
      
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const queryToken = url.searchParams.get("token");
      const authHeader = req.headers.authorization;
      const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      const token = queryToken || headerToken;
      const tokenSource = queryToken ? "query" : (headerToken ? "header" : "none");
      
      const expectedToken = process.env.TERMINAL_TOKEN;

      if (!expectedToken) {
        log(`[WS-LOGS] TERMINAL_TOKEN no configurado - conexión rechazada (ip: ${clientIp})`, "websocket");
        this.sendMessage(client, { type: "ERROR", payload: { message: "TERMINAL_TOKEN no configurado", reason: "TOKEN_NOT_CONFIGURED" } });
        client.close(4001, "Unauthorized");
        return;
      }

      if (!token) {
        log(`[WS-LOGS] Conexión rechazada - token ausente (source: ${tokenSource}, origin: ${origin}, ip: ${clientIp})`, "websocket");
        this.sendMessage(client, { type: "ERROR", payload: { message: "Token ausente", reason: "MISSING_TOKEN" } });
        client.close(4001, "Unauthorized - Missing Token");
        return;
      }

      if (token !== expectedToken) {
        log(`[WS-LOGS] Conexión rechazada - token incorrecto (source: ${tokenSource}, origin: ${origin}, ip: ${clientIp})`, "websocket");
        this.sendMessage(client, { type: "ERROR", payload: { message: "Token incorrecto", reason: "INVALID_TOKEN" } });
        client.close(4001, "Unauthorized - Invalid Token");
        return;
      }
      
      log(`[WS-LOGS] Token válido (source: ${tokenSource}, ip: ${clientIp})`, "websocket");

      client.isAlive = true;
      client.connectedAt = new Date();
      client.activeSource = null;
      client.activeProcess = null;
      this.clients.add(client);

      log(`[WS-LOGS] Cliente conectado. Total: ${this.clients.size}`, "websocket");

      const availableSources = this.getAvailableSources();
      this.sendMessage(client, {
        type: "WS_STATUS",
        payload: {
          connectedAt: client.connectedAt.toISOString(),
          serverTime: new Date().toISOString(),
          dockerEnabled: this.dockerEnabled,
          availableSources: availableSources.map(s => ({ id: s.id, name: s.name, type: s.type })),
        },
      });

      client.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(client, message);
        } catch (e) {
          log(`[WS-LOGS] Error parseando mensaje: ${e}`, "websocket");
        }
      });

      client.on("pong", () => {
        client.isAlive = true;
      });

      client.on("close", () => {
        this.stopClientProcess(client);
        this.clients.delete(client);
        log(`[WS-LOGS] Cliente desconectado. Total: ${this.clients.size}`, "websocket");
      });

      client.on("error", (error) => {
        log(`[WS-LOGS] Error en cliente: ${error.message}`, "websocket");
        this.stopClientProcess(client);
        this.clients.delete(client);
      });
    });

    this.startHeartbeat();
    log(`[WS-LOGS] Terminal WebSocket inicializado en ${WS_PATH} (docker: ${this.dockerEnabled})`, "websocket");
  }

  private getAvailableSources(): LogSource[] {
    return PREDEFINED_SOURCES.filter(source => {
      if (source.type === "docker_compose" || source.type === "docker_container") {
        return this.dockerEnabled;
      }
      return true;
    });
  }

  private handleClientMessage(client: WsClient, message: any): void {
    switch (message.type) {
      case "START_SOURCE":
        this.startLogSource(client, message.sourceId);
        break;
      case "STOP_SOURCE":
        this.stopClientProcess(client);
        this.sendMessage(client, { type: "SOURCE_STOPPED", payload: { sourceId: client.activeSource } });
        client.activeSource = null;
        break;
      default:
        log(`[WS-LOGS] Mensaje desconocido: ${message.type}`, "websocket");
    }
  }

  private startLogSource(client: WsClient, sourceId: string): void {
    const source = this.getAvailableSources().find(s => s.id === sourceId);
    
    if (!source) {
      this.sendMessage(client, { 
        type: "ERROR", 
        payload: { message: `Fuente no disponible: ${sourceId}` } 
      });
      return;
    }

    this.stopClientProcess(client);

    let command: string[];
    
    switch (source.type) {
      case "docker_compose":
        command = source.command || ["docker", "compose", "logs", "-f", "--tail=200"];
        break;
      case "docker_container":
        command = ["docker", "logs", "-f", "--tail=200", source.containerName || ""];
        break;
      case "file":
        command = ["tail", "-f", "-n", "200", source.filePath || ""];
        break;
      default:
        this.sendMessage(client, { type: "ERROR", payload: { message: "Tipo de fuente no soportado" } });
        return;
    }

    try {
      const proc = spawn(command[0], command.slice(1), {
        stdio: ["ignore", "pipe", "pipe"],
      });

      client.activeProcess = proc;
      client.activeSource = sourceId;

      log(`[WS-LOGS] Iniciando fuente ${sourceId}: ${command.join(" ")}`, "websocket");

      this.sendMessage(client, { 
        type: "SOURCE_CHANGED", 
        payload: { sourceId, sourceName: source.name } 
      });

      proc.stdout?.on("data", (data) => {
        const lines = data.toString().split("\n").filter((l: string) => l.trim());
        lines.forEach((line: string) => {
          this.sendMessage(client, { type: "LOG_LINE", payload: { line, sourceId } });
        });
      });

      proc.stderr?.on("data", (data) => {
        const lines = data.toString().split("\n").filter((l: string) => l.trim());
        lines.forEach((line: string) => {
          this.sendMessage(client, { type: "LOG_LINE", payload: { line, sourceId, isError: true } });
        });
      });

      proc.on("close", (code) => {
        log(`[WS-LOGS] Proceso terminado (${sourceId}): código ${code}`, "websocket");
        if (client.activeSource === sourceId) {
          this.sendMessage(client, { 
            type: "SOURCE_STOPPED", 
            payload: { sourceId, exitCode: code } 
          });
          client.activeSource = null;
          client.activeProcess = null;
        }
      });

      proc.on("error", (err) => {
        log(`[WS-LOGS] Error en proceso (${sourceId}): ${err.message}`, "websocket");
        this.sendMessage(client, { 
          type: "ERROR", 
          payload: { message: `Error al iniciar fuente: ${err.message}` } 
        });
        client.activeSource = null;
        client.activeProcess = null;
      });

    } catch (error: any) {
      log(`[WS-LOGS] Error spawning proceso: ${error.message}`, "websocket");
      this.sendMessage(client, { 
        type: "ERROR", 
        payload: { message: `Error al ejecutar comando: ${error.message}` } 
      });
    }
  }

  private stopClientProcess(client: WsClient): void {
    if (client.activeProcess) {
      try {
        client.activeProcess.kill("SIGTERM");
      } catch (e) {
        // Process may already be dead
      }
      client.activeProcess = null;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client) => {
        if (!client.isAlive) {
          log(`[WS-LOGS] Cliente muerto detectado, cerrando conexión`, "websocket");
          this.stopClientProcess(client);
          client.terminate();
          this.clients.delete(client);
          return;
        }
        client.isAlive = false;
        client.ping();
      });
    }, HEARTBEAT_INTERVAL);
  }

  private sendMessage(client: WsClient, message: WsMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        log(`[WS-LOGS] Error enviando mensaje: ${error}`, "websocket");
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  handleUpgrade(req: any, socket: any, head: any): void {
    if (!this.wss) return;
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss!.emit("connection", ws, req);
    });
  }

  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.clients.forEach((client) => {
      this.stopClientProcess(client);
      client.close(1001, "Server shutting down");
    });
    if (this.wss) {
      this.wss.close();
    }
  }
}

export const terminalWsServer = new TerminalWebSocketServer();
