import { ReactNode } from "react";
import { useEventsWebSocket } from "@/hooks/useEventsWebSocket";

interface EventsWebSocketProviderProps {
  children: ReactNode;
}

export function EventsWebSocketProvider({ children }: EventsWebSocketProviderProps) {
  return <>{children}</>;
}

export function useEventsFeed() {
  return useEventsWebSocket();
}
