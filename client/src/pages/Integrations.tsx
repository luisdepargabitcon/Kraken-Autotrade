import { useState, useEffect } from "react";
import { Nav } from "@/components/dashboard/Nav";
import generatedImage from '../assets/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Server, Check, Plug, Eye, EyeOff, ArrowRight, Zap, Crown } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "wouter";

export default function Integrations() {
  const queryClient = useQueryClient();
  
  const [krakenApiKey, setKrakenApiKey] = useState("");
  const [krakenSecret, setKrakenSecret] = useState("");
  const [krakenConnected, setKrakenConnected] = useState(false);
  const [krakenEnabled, setKrakenEnabled] = useState(true);
  const [showKrakenKey, setShowKrakenKey] = useState(false);
  const [showKrakenSecret, setShowKrakenSecret] = useState(false);
  
  const [revolutxApiKey, setRevolutxApiKey] = useState("");
  const [revolutxPrivateKey, setRevolutxPrivateKey] = useState("");
  const [revolutxConnected, setRevolutxConnected] = useState(false);
  const [revolutxEnabled, setRevolutxEnabled] = useState(false);
  const [showRevolutxKey, setShowRevolutxKey] = useState(false);
  const [showRevolutxPrivateKey, setShowRevolutxPrivateKey] = useState(false);
  
  const [activeExchange, setActiveExchange] = useState<"kraken" | "revolutx">("kraken");
  
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [showTelegramToken, setShowTelegramToken] = useState(false);

  const { data: apiConfig } = useQuery({
    queryKey: ["apiConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config/api");
      if (!res.ok) throw new Error("Failed to fetch config");
      return res.json();
    },
  });

  useEffect(() => {
    if (apiConfig) {
      setKrakenConnected(apiConfig.krakenConnected);
      setKrakenEnabled(apiConfig.krakenEnabled ?? true);
      setRevolutxConnected(apiConfig.revolutxConnected ?? false);
      setRevolutxEnabled(apiConfig.revolutxEnabled ?? false);
      setActiveExchange(apiConfig.activeExchange ?? "kraken");
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

  const revolutxMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/config/revolutx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: revolutxApiKey, privateKey: revolutxPrivateKey }),
      });
      if (!res.ok) throw new Error("Failed to connect");
      return res.json();
    },
    onSuccess: () => {
      setRevolutxConnected(true);
      queryClient.invalidateQueries({ queryKey: ["apiConfig"] });
      toast.success("Revolut X conectado correctamente");
    },
    onError: () => {
      toast.error("Error al conectar con Revolut X");
    },
  });

  const activeExchangeMutation = useMutation({
    mutationFn: async (exchange: "kraken" | "revolutx") => {
      const res = await fetch("/api/config/active-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeExchange: exchange }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to change exchange");
      }
      return res.json();
    },
    onSuccess: (_, exchange) => {
      setActiveExchange(exchange);
      queryClient.invalidateQueries({ queryKey: ["apiConfig"] });
      toast.success(`Exchange activo cambiado a ${exchange === "kraken" ? "Kraken" : "Revolut X"}`);
    },
    onError: (error: Error) => {
      toast.error(error.message);
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
              <h1 className="text-3xl font-bold font-sans tracking-tight flex items-center gap-3" data-testid="title-integrations">
                <Plug className="h-8 w-8 text-primary" />
                Integraciones
              </h1>
              <p className="text-muted-foreground mt-1">Configura las credenciales de APIs externas.</p>
            </div>
          </div>

          <div className="grid gap-6">
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-500/20 rounded-lg">
                    <Server className="h-6 w-6 text-orange-400" />
                  </div>
                  <div className="flex-1">
                    <CardTitle>Kraken Exchange</CardTitle>
                    <CardDescription>Conecta tu cuenta de Kraken para trading real.</CardDescription>
                  </div>
                  {krakenConnected ? (
                    <div className="flex items-center gap-2 text-green-500">
                      <Check className="h-5 w-5" />
                      <span className="text-sm font-mono">CONECTADO</span>
                    </div>
                  ) : (
                    <span className="text-sm font-mono text-yellow-500">DESCONECTADO</span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label>API Key</Label>
                  <div className="relative">
                    <Input 
                      type={showKrakenKey ? "text" : "password"}
                      placeholder="Tu Kraken API Key" 
                      className="font-mono bg-background/50 pr-10"
                      value={krakenApiKey}
                      onChange={(e) => setKrakenApiKey(e.target.value)}
                      data-testid="input-kraken-api-key"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => setShowKrakenKey(!showKrakenKey)}
                    >
                      {showKrakenKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>API Secret</Label>
                  <div className="relative">
                    <Input 
                      type={showKrakenSecret ? "text" : "password"}
                      placeholder="Tu Kraken API Secret" 
                      className="font-mono bg-background/50 pr-10"
                      value={krakenSecret}
                      onChange={(e) => setKrakenSecret(e.target.value)}
                      data-testid="input-kraken-secret"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => setShowKrakenSecret(!showKrakenSecret)}
                    >
                      {showKrakenSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <Button 
                  className="w-full bg-orange-600 hover:bg-orange-700" 
                  onClick={() => krakenMutation.mutate()}
                  disabled={!krakenApiKey || !krakenSecret || krakenMutation.isPending}
                  data-testid="button-connect-kraken"
                >
                  {krakenMutation.isPending ? "Conectando..." : krakenConnected ? "Reconectar" : "Conectar a Kraken"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Obtén tus credenciales en <a href="https://www.kraken.com/u/security/api" target="_blank" rel="noopener" className="text-primary hover:underline">kraken.com/u/security/api</a>
                </p>
                
                {krakenConnected && (
                  <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <div className="flex items-center gap-2">
                      {activeExchange === "kraken" && <Crown className="h-4 w-4 text-yellow-500" />}
                      <span className="text-sm">{activeExchange === "kraken" ? "Exchange activo" : "Usar como exchange activo"}</span>
                    </div>
                    <Button
                      variant={activeExchange === "kraken" ? "default" : "outline"}
                      size="sm"
                      onClick={() => activeExchangeMutation.mutate("kraken")}
                      disabled={activeExchange === "kraken" || activeExchangeMutation.isPending}
                      data-testid="button-activate-kraken"
                    >
                      {activeExchange === "kraken" ? "Activo" : "Activar"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/20 rounded-lg">
                    <Zap className="h-6 w-6 text-purple-400" />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      Revolut X Exchange
                      <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">0.09% fees</span>
                    </CardTitle>
                    <CardDescription>Exchange cripto con fees muy bajos (77% menos que Kraken).</CardDescription>
                  </div>
                  {revolutxConnected ? (
                    <div className="flex items-center gap-2 text-green-500">
                      <Check className="h-5 w-5" />
                      <span className="text-sm font-mono">CONECTADO</span>
                    </div>
                  ) : (
                    <span className="text-sm font-mono text-yellow-500">DESCONECTADO</span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label>API Key (64 caracteres)</Label>
                  <div className="relative">
                    <Input 
                      type={showRevolutxKey ? "text" : "password"}
                      placeholder="Tu Revolut X API Key" 
                      className="font-mono bg-background/50 pr-10"
                      value={revolutxApiKey}
                      onChange={(e) => setRevolutxApiKey(e.target.value)}
                      data-testid="input-revolutx-api-key"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => setShowRevolutxKey(!showRevolutxKey)}
                    >
                      {showRevolutxKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Private Key (Ed25519 PEM)</Label>
                  <div className="relative">
                    <Textarea 
                      placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                      className="font-mono bg-background/50 min-h-[80px] text-xs"
                      value={revolutxPrivateKey}
                      onChange={(e) => setRevolutxPrivateKey(e.target.value)}
                      data-testid="input-revolutx-private-key"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-2"
                      onClick={() => setShowRevolutxPrivateKey(!showRevolutxPrivateKey)}
                    >
                      {showRevolutxPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <Button 
                  className="w-full bg-purple-600 hover:bg-purple-700" 
                  onClick={() => revolutxMutation.mutate()}
                  disabled={!revolutxApiKey || !revolutxPrivateKey || revolutxMutation.isPending}
                  data-testid="button-connect-revolutx"
                >
                  {revolutxMutation.isPending ? "Conectando..." : revolutxConnected ? "Reconectar" : "Conectar a Revolut X"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Obtén tus credenciales en <a href="https://developer.revolut.com/docs/x-api/revolut-x-crypto-exchange-rest-api" target="_blank" rel="noopener" className="text-primary hover:underline">developer.revolut.com</a> (Revolut X Crypto Exchange API).
                </p>
                
                {revolutxConnected && (
                  <div className="flex items-center justify-between pt-2 border-t border-border/50">
                    <div className="flex items-center gap-2">
                      {activeExchange === "revolutx" && <Crown className="h-4 w-4 text-yellow-500" />}
                      <span className="text-sm">{activeExchange === "revolutx" ? "Exchange activo" : "Usar como exchange activo"}</span>
                    </div>
                    <Button
                      variant={activeExchange === "revolutx" ? "default" : "outline"}
                      size="sm"
                      onClick={() => activeExchangeMutation.mutate("revolutx")}
                      disabled={activeExchange === "revolutx" || activeExchangeMutation.isPending}
                      data-testid="button-activate-revolutx"
                    >
                      {activeExchange === "revolutx" ? "Activo" : "Activar"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <MessageSquare className="h-6 w-6 text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <CardTitle>Telegram Bot</CardTitle>
                    <CardDescription>Credenciales del bot para recibir alertas.</CardDescription>
                  </div>
                  {telegramConnected ? (
                    <div className="flex items-center gap-2 text-green-500">
                      <Check className="h-5 w-5" />
                      <span className="text-sm font-mono">CONECTADO</span>
                    </div>
                  ) : (
                    <span className="text-sm font-mono text-yellow-500">DESCONECTADO</span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label>Bot Token (de @BotFather)</Label>
                  <div className="relative">
                    <Input 
                      type={showTelegramToken ? "text" : "password"}
                      placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz" 
                      className="font-mono bg-background/50 pr-10"
                      value={telegramToken}
                      onChange={(e) => setTelegramToken(e.target.value)}
                      data-testid="input-telegram-token"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => setShowTelegramToken(!showTelegramToken)}
                    >
                      {showTelegramToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Chat ID principal</Label>
                  <Input 
                    placeholder="-1001234567890" 
                    className="font-mono bg-background/50"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    data-testid="input-telegram-chatid"
                  />
                </div>
                <Button 
                  className="w-full"
                  onClick={() => telegramMutation.mutate()}
                  disabled={!telegramToken || !telegramChatId || telegramMutation.isPending}
                  data-testid="button-connect-telegram"
                >
                  {telegramMutation.isPending ? "Probando..." : telegramConnected ? "Reconectar" : "Conectar Telegram"}
                </Button>
                
                {telegramConnected && (
                  <Link href="/notifications">
                    <Button variant="outline" className="w-full mt-2" data-testid="link-to-notifications">
                      <ArrowRight className="mr-2 h-4 w-4" />
                      Gestionar canales y alertas en Notificaciones
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
