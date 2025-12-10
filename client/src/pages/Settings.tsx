import { useState, useEffect } from "react";
import { Nav } from "@/components/dashboard/Nav";
import generatedImage from '@assets/generated_images/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HardDrive, Bot, MessageSquare, Server, Save, Check, X, Send, Plus, Trash2, Users } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface TelegramChat {
  id: number;
  name: string;
  chatId: string;
  alertTrades: boolean;
  alertErrors: boolean;
  alertSystem: boolean;
  alertBalance: boolean;
  isActive: boolean;
}

export default function Settings() {
  const queryClient = useQueryClient();
  const [krakenApiKey, setKrakenApiKey] = useState("");
  const [krakenSecret, setKrakenSecret] = useState("");
  const [krakenConnected, setKrakenConnected] = useState(false);
  
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [customMessage, setCustomMessage] = useState("");

  const [newChatName, setNewChatName] = useState("");
  const [newChatId, setNewChatId] = useState("");
  const [newAlertTrades, setNewAlertTrades] = useState(true);
  const [newAlertErrors, setNewAlertErrors] = useState(true);
  const [newAlertSystem, setNewAlertSystem] = useState(true);
  const [newAlertBalance, setNewAlertBalance] = useState(false);

  const { data: apiConfig } = useQuery({
    queryKey: ["apiConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config/api");
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
  });

  const { data: telegramChats = [] } = useQuery<TelegramChat[]>({
    queryKey: ["telegramChats"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/chats");
      if (!res.ok) throw new Error("Failed to fetch chats");
      return res.json();
    },
  });

  useEffect(() => {
    if (apiConfig) {
      setKrakenConnected(apiConfig.krakenConnected);
      setTelegramConnected(apiConfig.telegramConnected);
    }
  }, [apiConfig]);

  const krakenMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/config/kraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: krakenApiKey, apiSecret: krakenSecret }),
      });
      if (!res.ok) throw new Error("Failed to connect");
      return res.json();
    },
    onSuccess: () => {
      setKrakenConnected(true);
      toast.success("Kraken conectado correctamente");
    },
    onError: () => {
      toast.error("Error al conectar con Kraken");
    },
  });

  const telegramMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/config/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: telegramToken, chatId: telegramChatId }),
      });
      if (!res.ok) throw new Error("Failed to connect");
      return res.json();
    },
    onSuccess: () => {
      setTelegramConnected(true);
      toast.success("Telegram conectado correctamente");
    },
    onError: () => {
      toast.error("Error al conectar con Telegram");
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/telegram/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: customMessage }),
      });
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Mensaje enviado a Telegram");
      setCustomMessage("");
    },
    onError: () => {
      toast.error("Error al enviar mensaje");
    },
  });

  const createChatMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/telegram/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newChatName,
          chatId: newChatId,
          alertTrades: newAlertTrades,
          alertErrors: newAlertErrors,
          alertSystem: newAlertSystem,
          alertBalance: newAlertBalance,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create chat");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Chat añadido correctamente");
      setNewChatName("");
      setNewChatId("");
      setNewAlertTrades(true);
      setNewAlertErrors(true);
      setNewAlertSystem(true);
      setNewAlertBalance(false);
      queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteChatMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/telegram/chats/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Chat eliminado");
      queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
    },
    onError: () => {
      toast.error("Error al eliminar chat");
    },
  });

  const updateChatMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<TelegramChat>) => {
      const res = await fetch(`/api/telegram/chats/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["telegramChats"] });
    },
    onError: () => {
      toast.error("Error al actualizar chat");
    },
  });

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      <div 
        className="fixed inset-0 z-0 opacity-20 pointer-events-none" 
        style={{ 
          backgroundImage: `url(${generatedImage})`, 
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          mixBlendMode: 'overlay'
        }} 
      />
      
      <div className="relative z-10 flex flex-col min-h-screen">
        <Nav />
        
        <main className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold font-sans tracking-tight">Configuración del Sistema</h1>
              <p className="text-muted-foreground mt-1">Administra despliegue, notificaciones e IA.</p>
            </div>
          </div>

          <div className="grid gap-6">
            {/* Kraken API */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-500/20 rounded-lg">
                    <Server className="h-6 w-6 text-orange-400" />
                  </div>
                  <div className="flex-1">
                    <CardTitle>API de Kraken</CardTitle>
                    <CardDescription>Conecta tu cuenta para trading real.</CardDescription>
                  </div>
                  {krakenConnected && (
                    <div className="flex items-center gap-2 text-green-500">
                      <Check className="h-5 w-5" />
                      <span className="text-sm font-mono">CONECTADO</span>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label>API Key</Label>
                  <Input 
                    type="password" 
                    placeholder="Tu Kraken API Key" 
                    className="font-mono bg-background/50"
                    value={krakenApiKey}
                    onChange={(e) => setKrakenApiKey(e.target.value)}
                    data-testid="input-kraken-api-key"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>API Secret</Label>
                  <Input 
                    type="password" 
                    placeholder="Tu Kraken API Secret" 
                    className="font-mono bg-background/50"
                    value={krakenSecret}
                    onChange={(e) => setKrakenSecret(e.target.value)}
                    data-testid="input-kraken-secret"
                  />
                </div>
                <Button 
                  className="w-full" 
                  onClick={() => krakenMutation.mutate()}
                  disabled={!krakenApiKey || !krakenSecret || krakenMutation.isPending}
                  data-testid="button-connect-kraken"
                >
                  {krakenMutation.isPending ? "Conectando..." : "Conectar a Kraken"}
                </Button>
              </CardContent>
            </Card>

            {/* Telegram Notifications */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <MessageSquare className="h-6 w-6 text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <CardTitle>Notificaciones Telegram</CardTitle>
                    <CardDescription>Recibe alertas de operaciones y estado del bot en tiempo real.</CardDescription>
                  </div>
                  {telegramConnected && (
                    <div className="flex items-center gap-2 text-green-500">
                      <Check className="h-5 w-5" />
                      <span className="text-sm font-mono">CONECTADO</span>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label>Bot Token (BotFather)</Label>
                  <Input 
                    type="password" 
                    placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz" 
                    className="font-mono bg-background/50"
                    value={telegramToken}
                    onChange={(e) => setTelegramToken(e.target.value)}
                    data-testid="input-telegram-token"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Chat ID</Label>
                  <Input 
                    placeholder="-1001234567890" 
                    className="font-mono bg-background/50"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    data-testid="input-telegram-chatid"
                  />
                </div>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => telegramMutation.mutate()}
                  disabled={!telegramToken || !telegramChatId || telegramMutation.isPending}
                  data-testid="button-connect-telegram"
                >
                  {telegramMutation.isPending ? "Probando..." : "Probar Conexión"}
                </Button>
                
                {telegramConnected && (
                  <div className="pt-4 border-t border-border/50 space-y-3">
                    <Label>Enviar mensaje personalizado</Label>
                    <Textarea
                      placeholder="Escribe un mensaje para enviar a Telegram..."
                      className="bg-background/50 min-h-[80px]"
                      value={customMessage}
                      onChange={(e) => setCustomMessage(e.target.value)}
                      data-testid="input-custom-message"
                    />
                    <Button 
                      className="w-full"
                      onClick={() => sendMessageMutation.mutate()}
                      disabled={!customMessage.trim() || sendMessageMutation.isPending}
                      data-testid="button-send-message"
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {sendMessageMutation.isPending ? "Enviando..." : "Enviar Mensaje"}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Comandos disponibles: /estado, /pausar, /reanudar, /ultimas, /ayuda
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Multi-Chat Telegram */}
            {telegramConnected && (
              <Card className="glass-panel border-border/50">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-500/20 rounded-lg">
                      <Users className="h-6 w-6 text-purple-400" />
                    </div>
                    <div className="flex-1">
                      <CardTitle>Multi-Chat Telegram</CardTitle>
                      <CardDescription>Envía alertas a múltiples chats con diferentes configuraciones.</CardDescription>
                    </div>
                    <span className="text-sm text-muted-foreground">{telegramChats.length} chat(s)</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {telegramChats.length > 0 && (
                    <div className="space-y-3">
                      {telegramChats.map((chat) => (
                        <div key={chat.id} className="p-4 border border-border rounded-lg bg-card/30 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`h-2 w-2 rounded-full ${chat.isActive ? 'bg-green-500' : 'bg-gray-500'}`}></span>
                              <span className="font-medium">{chat.name}</span>
                              <span className="text-xs text-muted-foreground font-mono">({chat.chatId})</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch 
                                checked={chat.isActive}
                                onCheckedChange={(checked) => updateChatMutation.mutate({ id: chat.id, isActive: checked })}
                              />
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => deleteChatMutation.mutate(chat.id)}
                                data-testid={`button-delete-chat-${chat.id}`}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button 
                              variant={chat.alertTrades ? "default" : "outline"} 
                              size="sm"
                              onClick={() => updateChatMutation.mutate({ id: chat.id, alertTrades: !chat.alertTrades })}
                            >
                              Trades
                            </Button>
                            <Button 
                              variant={chat.alertErrors ? "default" : "outline"} 
                              size="sm"
                              onClick={() => updateChatMutation.mutate({ id: chat.id, alertErrors: !chat.alertErrors })}
                            >
                              Errores
                            </Button>
                            <Button 
                              variant={chat.alertSystem ? "default" : "outline"} 
                              size="sm"
                              onClick={() => updateChatMutation.mutate({ id: chat.id, alertSystem: !chat.alertSystem })}
                            >
                              Sistema
                            </Button>
                            <Button 
                              variant={chat.alertBalance ? "default" : "outline"} 
                              size="sm"
                              onClick={() => updateChatMutation.mutate({ id: chat.id, alertBalance: !chat.alertBalance })}
                            >
                              Balance
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="pt-4 border-t border-border/50 space-y-3">
                    <Label className="flex items-center gap-2">
                      <Plus className="h-4 w-4" /> Añadir nuevo chat
                    </Label>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid gap-2">
                        <Label className="text-xs">Nombre</Label>
                        <Input 
                          placeholder="Mi grupo" 
                          className="bg-background/50"
                          value={newChatName}
                          onChange={(e) => setNewChatName(e.target.value)}
                          data-testid="input-new-chat-name"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label className="text-xs">Chat ID</Label>
                        <Input 
                          placeholder="-1001234567890" 
                          className="font-mono bg-background/50"
                          value={newChatId}
                          onChange={(e) => setNewChatId(e.target.value)}
                          data-testid="input-new-chat-id"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <Switch checked={newAlertTrades} onCheckedChange={setNewAlertTrades} />
                        <Label className="text-sm">Trades</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={newAlertErrors} onCheckedChange={setNewAlertErrors} />
                        <Label className="text-sm">Errores</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={newAlertSystem} onCheckedChange={setNewAlertSystem} />
                        <Label className="text-sm">Sistema</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={newAlertBalance} onCheckedChange={setNewAlertBalance} />
                        <Label className="text-sm">Balance</Label>
                      </div>
                    </div>
                    <Button 
                      className="w-full"
                      onClick={() => createChatMutation.mutate()}
                      disabled={!newChatName.trim() || !newChatId.trim() || createChatMutation.isPending}
                      data-testid="button-add-chat"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      {createChatMutation.isPending ? "Añadiendo..." : "Añadir Chat"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* AI Integration */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/20 rounded-lg">
                    <Bot className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <CardTitle>Integración de Inteligencia Artificial</CardTitle>
                    <CardDescription>Configura el motor de predicción neuronal.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Modelo Predictivo</Label>
                    <Select defaultValue="lstm">
                      <SelectTrigger className="bg-background/50">
                        <SelectValue placeholder="Seleccionar modelo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lstm">Deep LSTM V4 (Recomendado)</SelectItem>
                        <SelectItem value="transformer">Transformer Market-BERT</SelectItem>
                        <SelectItem value="xgboost">XGBoost Ensemble</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Intervalo de Re-entrenamiento</Label>
                    <Select defaultValue="24h">
                      <SelectTrigger className="bg-background/50">
                        <SelectValue placeholder="Seleccionar intervalo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1h">Cada 1 Hora</SelectItem>
                        <SelectItem value="6h">Cada 6 Horas</SelectItem>
                        <SelectItem value="24h">Cada 24 Horas</SelectItem>
                        <SelectItem value="weekly">Semanal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="p-4 border border-border rounded-lg bg-card/30 flex items-center justify-between">
                   <div className="space-y-1">
                     <div className="flex items-center gap-2">
                       <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                       <span className="font-mono text-sm">Estado del Modelo: CONVERGENTE</span>
                     </div>
                     <p className="text-xs text-muted-foreground">Última precisión: 94.2% en backtesting</p>
                   </div>
                   <Button size="sm" variant="secondary">Re-entrenar Ahora</Button>
                </div>
              </CardContent>
            </Card>

            {/* NAS Deployment */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-500/20 rounded-lg">
                    <HardDrive className="h-6 w-6 text-orange-400" />
                  </div>
                  <div>
                    <CardTitle>Despliegue QNAP NAS</CardTitle>
                    <CardDescription>Configuración para Container Station y Docker.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label>Dirección IP del NAS</Label>
                  <Input placeholder="192.168.1.100" className="font-mono bg-background/50" />
                </div>
                <div className="grid gap-2">
                  <Label>Puerto Container Station</Label>
                  <Input placeholder="3000" defaultValue="3000" className="font-mono bg-background/50" />
                </div>
                <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/30">
                  <div className="space-y-0.5">
                    <Label>Auto-Reinicio en Fallo</Label>
                    <p className="text-sm text-muted-foreground">Política de reinicio de Docker (--restart unless-stopped)</p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex gap-4">
                  <Button className="flex-1 bg-orange-600 hover:bg-orange-700 text-white" onClick={() => {
                    const link = document.createElement('a');
                    link.href = '/docker-compose.yml';
                    link.download = 'docker-compose.yml';
                    link.click();
                  }}>
                    <Server className="mr-2 h-4 w-4" /> Descargar docker-compose.yml
                  </Button>
                </div>
              </CardContent>
            </Card>

          </div>
        </main>
      </div>
    </div>
  );
}
