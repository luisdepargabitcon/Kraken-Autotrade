import { Nav } from "@/components/dashboard/Nav";
import generatedImage from '../assets/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, MessageSquare, ArrowRight, CheckCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

interface ApiConfigLite {
  telegramConnected?: boolean;
}

interface TelegramChatLite {
  id: number;
  isActive: boolean;
}

export default function Notifications() {
  const { data: apiConfig } = useQuery<ApiConfigLite>({
    queryKey: ["apiConfig"],
    queryFn: async () => {
      const res = await fetch("/api/config/api");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: telegramChats = [] } = useQuery<TelegramChatLite[]>({
    queryKey: ["telegramChats"],
    queryFn: async () => {
      const res = await fetch("/api/telegram/chats");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const activeChatsCount = telegramChats.filter(c => c.isActive).length;

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

        <main className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-6 flex flex-col items-center justify-center">
          <div className="text-center space-y-2">
            <Bell className="h-12 w-12 text-primary mx-auto opacity-50" />
            <h1 className="text-2xl font-bold" data-testid="title-notifications">Notificaciones</h1>
          </div>

          <Card className="glass-panel border-border/50 w-full">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <MessageSquare className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <CardTitle className="text-base">La configuración de Telegram se gestiona ahora desde Telegram</CardTitle>
                  <CardDescription>Canales, alertas globales, cooldowns, comandos y auditoría — todo unificado en un solo centro.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 text-sm text-muted-foreground justify-center">
                <div className="flex items-center gap-1.5">
                  <div className={`h-2.5 w-2.5 rounded-full ${apiConfig?.telegramConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                  {apiConfig?.telegramConnected ? 'Conectado' : 'Desconectado'}
                </div>
                <span className="text-border">|</span>
                <span>{activeChatsCount} canal{activeChatsCount !== 1 ? 'es' : ''} activo{activeChatsCount !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex items-center gap-2 justify-center text-xs text-green-400">
                <CheckCircle className="h-4 w-4" /> Esta página es solo informativa. Ningún control aquí edita configuración.
              </div>
              <Link href="/telegram">
                <Button className="w-full" data-testid="button-go-telegram">
                  Ir a Telegram <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
