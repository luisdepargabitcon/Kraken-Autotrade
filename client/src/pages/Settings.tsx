import { Nav } from "@/components/dashboard/Nav";
import generatedImage from '@assets/generated_images/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HardDrive, Bot, Server, Cog } from "lucide-react";
import { Link } from "wouter";

export default function Settings() {
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
        
        <main className="flex-1 p-4 md:p-6 max-w-4xl mx-auto w-full space-y-6 md:space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl md:text-3xl font-bold font-sans tracking-tight flex items-center gap-2 md:gap-3">
                <Cog className="h-6 w-6 md:h-8 md:w-8 text-primary" />
                Ajustes del Sistema
              </h1>
              <p className="text-sm md:text-base text-muted-foreground mt-1">Configuración del bot, IA y despliegue.</p>
            </div>
          </div>

          <div className="grid gap-6">
            {/* Quick Link to Integrations */}
            <Card className="glass-panel border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Server className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">APIs y Credenciales</p>
                      <p className="text-sm text-muted-foreground">Configura Kraken, Telegram y otras integraciones</p>
                    </div>
                  </div>
                  <Link href="/integrations">
                    <Button variant="outline" data-testid="link-integrations">
                      Ir a Integraciones
                    </Button>
                  </Link>
                </div>
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
                    <CardTitle>Motor de Inteligencia Artificial</CardTitle>
                    <CardDescription>Configura el modelo predictivo y parámetros de trading.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label className="text-sm">Modelo Predictivo</Label>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label className="text-sm">Dirección IP del NAS</Label>
                    <Input placeholder="192.168.1.104" defaultValue="192.168.1.104" className="font-mono bg-background/50" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Puerto</Label>
                    <Input placeholder="3000" defaultValue="3000" className="font-mono bg-background/50" />
                  </div>
                </div>
                <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/30">
                  <div className="space-y-0.5">
                    <Label>Auto-Reinicio en Fallo</Label>
                    <p className="text-sm text-muted-foreground">Política de reinicio de Docker (--restart unless-stopped)</p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card/30">
                  <div className="space-y-0.5">
                    <Label>Auto-Actualización</Label>
                    <p className="text-sm text-muted-foreground">Actualiza automáticamente desde Git cada hora</p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <Button 
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white" 
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = '/docker-compose.yml';
                    link.download = 'docker-compose.yml';
                    link.click();
                  }}
                  data-testid="button-download-docker"
                >
                  <Server className="mr-2 h-4 w-4" /> Descargar docker-compose.yml
                </Button>
              </CardContent>
            </Card>

            {/* System Info */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-cyan-500/20 rounded-lg">
                    <Cog className="h-6 w-6 text-cyan-400" />
                  </div>
                  <div>
                    <CardTitle>Información del Sistema</CardTitle>
                    <CardDescription>Versión y estado del bot.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 md:gap-4 text-xs md:text-sm">
                  <div className="p-2 md:p-3 border border-border rounded-lg bg-card/30">
                    <p className="text-muted-foreground">Versión</p>
                    <p className="font-mono font-medium">1.0.0</p>
                  </div>
                  <div className="p-2 md:p-3 border border-border rounded-lg bg-card/30">
                    <p className="text-muted-foreground">Entorno</p>
                    <p className="font-mono font-medium">Producción</p>
                  </div>
                  <div className="p-2 md:p-3 border border-border rounded-lg bg-card/30">
                    <p className="text-muted-foreground">Base de datos</p>
                    <p className="font-mono font-medium text-green-500">Conectada</p>
                  </div>
                  <div className="p-2 md:p-3 border border-border rounded-lg bg-card/30">
                    <p className="text-muted-foreground">Última actualización</p>
                    <p className="font-mono font-medium">{new Date().toLocaleDateString("es-ES")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>
        </main>
      </div>
    </div>
  );
}
