import { createContext, useContext, ReactNode } from "react";
import { useEventsWebSocket, BotEvent } from "@/hooks/useEventsWebSocket";

type WsStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

interface EventsWebSocketContextValue {
  events: BotEvent[];
  status: WsStatus;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  clearEvents: () => void;
  isConnected: boolean;
}

const EventsWebSocketContext = createContext<EventsWebSocketContextValue | null>(null);

interface EventsWebSocketProviderProps {
  children: ReactNode;
  maxEvents?: number;
}

export function EventsWebSocketProvider({ children, maxEvents = 500 }: EventsWebSocketProviderProps) {
  const wsState = useEventsWebSocket({ maxEvents, autoConnect: true });

  return (
    <EventsWebSocketContext.Provider value={wsState}>
      {children}
    </EventsWebSocketContext.Provider>
  );
}

export function useEventsFeed() {
  const context = useContext(EventsWebSocketContext);
  if (!context) {
    throw new Error("useEventsFeed must be used within EventsWebSocketProvider");
  }
  return context;
}
