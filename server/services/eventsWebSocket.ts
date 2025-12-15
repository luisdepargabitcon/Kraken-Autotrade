import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { db } from "../db";
import { botEvents } from "@shared/schema";
import { desc } from "drizzle-orm";
import { log } from "../index";

const WS_PATH = "/ws/events";
const SNAPSHOT_LIMIT = 50;
const HEARTBEAT_INTERVAL = 30000;

interface WsClient extends WebSocket {
  isAlive: boolean;
  connectedAt: Date;
}

interface WsMessage {
  type: "EVENTS_SNAPSHOT" | "BOT_EVENT" | "WS_STATUS" | "ERROR";
  payload: any;
}

class EventsWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WsClient> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  initialize(server: Server): void {
    this.wss = new WebSocketServer({ 
      server,
      path: WS_PATH,
    });

    this.wss.on("connection", async (ws: WebSocket, req) => {
      const client = ws as WsClient;
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const token = url.searchParams.get("token");
      const expectedToken = process.env.WS_ADMIN_TOKEN;

      if (!expectedToken) {
        log(`[WS] WS_ADMIN_TOKEN no configurado - conexión sin autenticación permitida (desarrollo)`, "websocket");
      } else if (token !== expectedToken) {
        log(`[WS] Conexión rechazada - token inválido desde ${req.socket.remoteAddress}`, "websocket");
        this.sendMessage(client, { type: "ERROR", payload: { message: "Token inválido" } });
        client.close(4001, "Unauthorized");
        return;
      }

      client.isAlive = true;
      client.connectedAt = new Date();
      this.clients.add(client);

      log(`[WS] Cliente conectado. Total: ${this.clients.size}`, "websocket");

      setTimeout(async () => {
        if (client.readyState !== WebSocket.OPEN) {
          log(`[WS] Cliente cerrado antes de enviar datos iniciales`, "websocket");
          return;
        }
        
        this.sendMessage(client, {
          type: "WS_STATUS",
          payload: {
            connectedAt: client.connectedAt.toISOString(),
            serverTime: new Date().toISOString(),
            clientsConnected: this.clients.size,
          },
        });
        
        try {
          const snapshot = await this.getEventsSnapshot();
          if (client.readyState === WebSocket.OPEN) {
            this.sendMessage(client, {
              type: "EVENTS_SNAPSHOT",
              payload: snapshot,
            });
          }
        } catch (error) {
          log(`[WS] Error enviando snapshot: ${error}`, "websocket");
        }
      }, 500);

      client.on("pong", () => {
        client.isAlive = true;
      });

      client.on("close", () => {
        this.clients.delete(client);
        log(`[WS] Cliente desconectado. Total: ${this.clients.size}`, "websocket");
      });

      client.on("error", (error) => {
        log(`[WS] Error en cliente: ${error.message}`, "websocket");
        this.clients.delete(client);
      });
    });

    this.startHeartbeat();
    log(`[WS] Servidor WebSocket inicializado en ${WS_PATH}`, "websocket");
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client) => {
        if (!client.isAlive) {
          log(`[WS] Cliente muerto detectado, cerrando conexión`, "websocket");
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
        log(`[WS] Error enviando mensaje: ${error}`, "websocket");
      }
    }
  }

  private async getEventsSnapshot(): Promise<any[]> {
    try {
      const events = await db.select()
        .from(botEvents)
        .orderBy(desc(botEvents.timestamp))
        .limit(SNAPSHOT_LIMIT);

      return events.map(e => ({
        id: e.id,
        timestamp: e.timestamp,
        level: e.level,
        type: e.type,
        message: e.message,
        meta: e.meta ? JSON.parse(e.meta) : null,
      }));
    } catch (error) {
      log(`[WS] Error obteniendo snapshot: ${error}`, "websocket");
      return [];
    }
  }

  broadcast(event: {
    id?: number;
    timestamp: string;
    level: string;
    type: string;
    message: string;
    meta?: any;
  }): void {
    const message: WsMessage = {
      type: "BOT_EVENT",
      payload: event,
    };

    const messageStr = JSON.stringify(message);
    let sentCount = 0;

    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageStr);
          sentCount++;
        } catch (error) {
          log(`[WS] Error en broadcast: ${error}`, "websocket");
        }
      }
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }

  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.clients.forEach((client) => {
      client.close(1001, "Server shutting down");
    });
    this.wss?.close();
  }
}

export const eventsWs = new EventsWebSocketServer();
