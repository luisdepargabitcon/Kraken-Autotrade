/**
 * Positions WebSocket Service
 * 
 * Broadcasts position events to connected clients:
 * - POSITION_CREATED (PENDING_FILL)
 * - POSITION_UPDATED (OPEN, fill received)
 * - POSITION_DELETED
 * - POSITIONS_SNAPSHOT (initial load)
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "../utils/logger";

const WS_PATH = "/ws/positions";
const HEARTBEAT_INTERVAL = 30000;

interface WsClient extends WebSocket {
  isAlive: boolean;
  connectedAt: Date;
}

export type PositionEventType = 
  | "POSITIONS_SNAPSHOT"
  | "POSITION_CREATED"
  | "POSITION_UPDATED"
  | "POSITION_DELETED"
  | "POSITION_FILL_RECEIVED"
  | "WS_STATUS"
  | "ERROR";

interface WsMessage {
  type: PositionEventType;
  payload: any;
  timestamp?: string;
}

class PositionsWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WsClient> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  initialize(server: Server): void {
    this.wss = new WebSocketServer({ 
      noServer: true,
      perMessageDeflate: false,
    });

    this.wss.on("connection", async (ws: WebSocket, req) => {
      const client = ws as WsClient;
      const clientIp = req.socket.remoteAddress || "unknown";
      
      // Simple auth check (same as eventsWebSocket)
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const token = url.searchParams.get("token") || 
                    req.headers.authorization?.replace("Bearer ", "");
      const expectedToken = process.env.WS_ADMIN_TOKEN;

      if (expectedToken && token !== expectedToken) {
        log(`[WS/positions] Rejected - invalid token from ${clientIp}`, "websocket");
        client.close(4001, "Unauthorized");
        return;
      }

      client.isAlive = true;
      client.connectedAt = new Date();
      this.clients.add(client);

      log(`[WS/positions] Client connected. Total: ${this.clients.size}`, "websocket");

      // Send initial status
      this.sendMessage(client, {
        type: "WS_STATUS",
        payload: {
          connectedAt: client.connectedAt.toISOString(),
          serverTime: new Date().toISOString(),
          path: WS_PATH,
        },
      });

      // Handle pong for heartbeat
      client.on("pong", () => {
        client.isAlive = true;
      });

      // Handle client disconnect
      client.on("close", () => {
        this.clients.delete(client);
        log(`[WS/positions] Client disconnected. Total: ${this.clients.size}`, "websocket");
      });

      client.on("error", (err) => {
        log(`[WS/positions] Client error: ${err.message}`, "websocket");
        this.clients.delete(client);
      });
    });

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client) => {
        if (!client.isAlive) {
          client.terminate();
          this.clients.delete(client);
          return;
        }
        client.isAlive = false;
        client.ping();
      });
    }, HEARTBEAT_INTERVAL);

    log(`[WS/positions] WebSocket server initialized on ${WS_PATH}`, "websocket");
  }

  handleUpgrade(request: any, socket: any, head: any): boolean {
    const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
    
    if (pathname === WS_PATH && this.wss) {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss?.emit("connection", ws, request);
      });
      return true;
    }
    return false;
  }

  private sendMessage(client: WsClient, message: WsMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify({
          ...message,
          timestamp: message.timestamp || new Date().toISOString(),
        }));
      } catch (err: any) {
        log(`[WS/positions] Error sending message: ${err.message}`, "websocket");
      }
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: Omit<WsMessage, "timestamp">): void {
    const fullMessage: WsMessage = {
      ...message,
      timestamp: new Date().toISOString(),
    };

    let sentCount = 0;
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        this.sendMessage(client, fullMessage);
        sentCount++;
      }
    });

    if (sentCount > 0) {
      log(`[WS/positions] Broadcast ${message.type} to ${sentCount} clients`, "websocket");
    }
  }

  /**
   * Emit POSITION_CREATED event (called when PENDING_FILL position is created)
   */
  emitPositionCreated(position: any): void {
    this.broadcast({
      type: "POSITION_CREATED",
      payload: {
        id: position.id,
        lotId: position.lotId,
        exchange: position.exchange,
        pair: position.pair,
        status: position.status || 'PENDING_FILL',
        expectedAmount: position.expectedAmount,
        entryMode: position.entryMode,
        clientOrderId: position.clientOrderId,
        createdAt: position.openedAt || position.createdAt,
      },
    });
  }

  /**
   * Emit POSITION_UPDATED event (called when fill is received)
   */
  emitPositionUpdated(position: any): void {
    this.broadcast({
      type: "POSITION_UPDATED",
      payload: {
        id: position.id,
        lotId: position.lotId,
        exchange: position.exchange,
        pair: position.pair,
        status: position.status || 'OPEN',
        amount: position.amount,
        entryPrice: position.entryPrice,
        averageEntryPrice: position.averageEntryPrice,
        totalCostQuote: position.totalCostQuote,
        totalAmountBase: position.totalAmountBase,
        fillCount: position.fillCount,
        lastFillAt: position.lastFillAt,
        sgBreakEvenActivated: position.sgBreakEvenActivated,
        sgTrailingActivated: position.sgTrailingActivated,
        updatedAt: position.updatedAt,
      },
    });
  }

  /**
   * Emit POSITION_FILL_RECEIVED event (granular fill notification)
   */
  emitFillReceived(clientOrderId: string, fill: {
    fillId: string;
    pair: string;
    price: number;
    amount: number;
    executedAt: Date;
  }, newAveragePrice: number): void {
    this.broadcast({
      type: "POSITION_FILL_RECEIVED",
      payload: {
        clientOrderId,
        fill: {
          fillId: fill.fillId,
          pair: fill.pair,
          price: fill.price,
          amount: fill.amount,
          executedAt: fill.executedAt.toISOString(),
        },
        newAveragePrice,
      },
    });
  }

  /**
   * Emit POSITION_DELETED event
   */
  emitPositionDeleted(positionId: number, pair: string, exchange: string): void {
    this.broadcast({
      type: "POSITION_DELETED",
      payload: {
        id: positionId,
        pair,
        exchange,
      },
    });
  }

  /**
   * Get client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.clients.forEach((client) => {
      client.close(1000, "Server shutdown");
    });
    this.clients.clear();
    log(`[WS/positions] WebSocket server shut down`, "websocket");
  }
}

// Singleton instance
export const positionsWs = new PositionsWebSocketServer();

export default positionsWs;
