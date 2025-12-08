import { Nav } from "@/components/dashboard/Nav";
import generatedImage from '@assets/generated_images/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { HardDrive, Bot, MessageSquare, Server, Save } from "lucide-react";

export default function Settings() {
  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      {/* Background Image Overlay */}
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
            <Button className="font-mono gap-2">
              <Save className="h-4 w-4" /> GUARDAR CAMBIOS
            </Button>
          </div>

          <div className="grid gap-6">
            {/* Telegram Notifications */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg">
                    <MessageSquare className="h-6 w-6 text-blue-400" />
                  </div>
                  <div>
                    <CardTitle>Notificaciones Telegram</CardTitle>
                    <CardDescription>Recibe alertas de operaciones y estado del bot en tiempo real.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/30">
                  <div className="space-y-0.5">
                    <Label>Activar Notificaciones</Label>
                    <p className="text-sm text-muted-foreground">Enviar alertas de compra/venta y errores.</p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="grid gap-2">
                  <Label>Bot Token (BotFather)</Label>
                  <Input type="password" placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz" className="font-mono bg-background/50" />
                </div>
                <div className="grid gap-2">
                  <Label>Chat ID</Label>
                  <Input placeholder="-1001234567890" className="font-mono bg-background/50" />
                </div>
                <Button variant="outline" className="w-full">Probar Conexión</Button>
              </CardContent>
            </Card>

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
                  <Button className="flex-1 bg-orange-600 hover:bg-orange-700 text-white">
                    <Server className="mr-2 h-4 w-4" /> Generar docker-compose.yml
                  </Button>
                  <Button variant="outline" className="flex-1">
                    Descargar Imagen (.tar)
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
