/**
 * TelegramChannelsTab — Manage telegram_chats (active/inactive/deleted)
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Trash2, Check, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface TelegramChat {
  id: number;
  chatId: string;
  name: string;
  isActive: boolean;
  alertTrades: boolean;
  alertErrors: boolean;
  alertSystem: boolean;
  alertBalance: boolean;
  alertHeartbeat: boolean;
  alertPreferences: Record<string, boolean>;
}

export default function TelegramChannelsTab() {
  const queryClient = useQueryClient();
  const [newChatId, setNewChatId] = useState("");
  const [newChatName, setNewChatName] = useState("");

  const { data: chats = [], isLoading } = useQuery<TelegramChat[]>({
    queryKey: ["telegramChats"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/chats");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const addChat = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/telegram/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: newChatId, name: newChatName }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
      setNewChatId(""); setNewChatName("");
      toast.success("Canal añadido");
    },
    onError: () => toast.error("Error al añadir canal"),
  });

  const updateChat = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<TelegramChat> & { id: number }) => {
      const res = await fetch(`/api/telegram/chats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
    },
    onError: () => toast.error("Error al actualizar canal"),
  });

  const deleteChat = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/telegram/chats/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
      toast.success("Canal eliminado");
    },
    onError: () => toast.error("Error al eliminar canal"),
  });

  const activeCount = chats.filter(c => c.isActive).length;
  const inactiveCount = chats.filter(c => !c.isActive).length;

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/20 rounded-lg">
              <Users className="h-5 w-5 text-cyan-400" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-sm">Canales de Telegram</CardTitle>
              <CardDescription className="text-xs">
                {activeCount} activos · {inactiveCount} inactivos · {chats.length} total
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Add new channel */}
          <div className="flex items-end gap-2 p-3 rounded-lg border border-border/50 bg-muted/20">
            <div className="flex-1">
              <Label className="text-xs">Chat ID</Label>
              <Input placeholder="-1001234567890" value={newChatId} onChange={(e) => setNewChatId(e.target.value)}
                className="font-mono text-xs" />
            </div>
            <div className="flex-1">
              <Label className="text-xs">Nombre</Label>
              <Input placeholder="Mi canal" value={newChatName} onChange={(e) => setNewChatName(e.target.value)}
                className="text-xs" />
            </div>
            <Button size="sm" disabled={!newChatId || !newChatName || addChat.isPending}
              onClick={() => addChat.mutate()}>
              <Plus className="h-3 w-3 mr-1" /> Añadir
            </Button>
          </div>

          {/* Channel list */}
          {isLoading ? (
            <div className="text-center py-4 text-muted-foreground text-xs">Cargando...</div>
          ) : chats.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-xs">No hay canales registrados</div>
          ) : (
            <div className="space-y-2">
              {chats.map((chat) => (
                <div key={chat.id} className={`p-3 rounded-lg border ${chat.isActive ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] ${chat.isActive ? "text-green-400 border-green-500/40" : "text-red-400 border-red-500/40"}`}>
                        {chat.isActive ? "ACTIVO" : "INACTIVO"}
                      </Badge>
                      <span className="text-sm font-medium">{chat.name}</span>
                      <span className="text-xs font-mono text-muted-foreground">{chat.chatId}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch checked={chat.isActive}
                        onCheckedChange={(v) => updateChat.mutate({ id: chat.id, isActive: v })} />
                      <Button size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => deleteChat.mutate(chat.id)}>
                        <Trash2 className="h-3 w-3 text-red-400" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: "alertTrades", label: "Trades" },
                      { key: "alertErrors", label: "Errores" },
                      { key: "alertSystem", label: "Sistema" },
                      { key: "alertBalance", label: "Balance" },
                      { key: "alertHeartbeat", label: "Heartbeat" },
                    ].map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-1 px-2 py-1 rounded border border-border/30 text-[10px]">
                        {chat[key as keyof TelegramChat] ? (
                          <Check className="h-3 w-3 text-green-400" />
                        ) : (
                          <X className="h-3 w-3 text-red-400" />
                        )}
                        {label}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
