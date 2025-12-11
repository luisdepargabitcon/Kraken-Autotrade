import { Nav } from "@/components/dashboard/Nav";
import generatedImage from '@assets/generated_images/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { 
  BookOpen, 
  Zap, 
  Settings, 
  AlertTriangle, 
  CheckCircle2, 
  TrendingUp, 
  TrendingDown,
  Activity,
  Target,
  RefreshCw,
  Shield,
  DollarSign,
  Clock,
  BarChart3,
  Plug,
  HelpCircle,
  ListChecks,
  Lightbulb,
  XCircle,
  WifiOff,
  Key,
  Percent
} from "lucide-react";

export default function Guide() {
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
        
        <main className="flex-1 p-4 md:p-6 max-w-5xl mx-auto w-full space-y-6 md:space-y-8">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/20 rounded-lg">
              <BookOpen className="h-6 w-6 md:h-8 md:w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-xl md:text-3xl font-bold font-sans tracking-tight">Guía del Bot</h1>
              <p className="text-sm md:text-base text-muted-foreground">Manual completo de uso y configuración</p>
            </div>
          </div>

          <div className="grid gap-6">
            
            {/* Sección 1: ¿Qué hace este bot? */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-cyan-500/20 rounded-lg">
                    <Zap className="h-6 w-6 text-cyan-400" />
                  </div>
                  <div>
                    <CardTitle className="text-lg md:text-xl">1. ¿Qué hace este bot?</CardTitle>
                    <CardDescription>Resumen general del funcionamiento</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                  KrakenBot.AI es un bot de trading automático que opera en el exchange Kraken. 
                  Analiza el mercado 24/7 usando indicadores técnicos avanzados y ejecuta operaciones 
                  de compra/venta de forma autónoma según la estrategia configurada.
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border border-border rounded-lg bg-card/30">
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <Activity className="h-4 w-4 text-primary" />
                      Estrategias incluidas
                    </h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li className="flex items-center gap-2">
                        <TrendingUp className="h-3 w-3 text-green-500" />
                        <strong>Momentum:</strong> Sigue tendencias fuertes
                      </li>
                      <li className="flex items-center gap-2">
                        <RefreshCw className="h-3 w-3 text-blue-500" />
                        <strong>Reversión a la media:</strong> Opera en extremos
                      </li>
                      <li className="flex items-center gap-2">
                        <Zap className="h-3 w-3 text-yellow-500" />
                        <strong>Scalping:</strong> Operaciones rápidas
                      </li>
                      <li className="flex items-center gap-2">
                        <Target className="h-3 w-3 text-purple-500" />
                        <strong>Grid:</strong> Órdenes escalonadas
                      </li>
                    </ul>
                  </div>
                  
                  <div className="p-4 border border-border rounded-lg bg-card/30">
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-primary" />
                      Pares soportados
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">BTC/USD</Badge>
                      <Badge variant="outline">ETH/USD</Badge>
                      <Badge variant="outline">SOL/USD</Badge>
                      <Badge variant="outline">XRP/USD</Badge>
                      <Badge variant="outline">TON/USD</Badge>
                      <Badge variant="outline">ETH/BTC</Badge>
                    </div>
                  </div>
                </div>

                <div className="p-4 border border-primary/30 rounded-lg bg-primary/5">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    Indicadores técnicos utilizados
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                    <span className="text-muted-foreground">• MACD</span>
                    <span className="text-muted-foreground">• RSI</span>
                    <span className="text-muted-foreground">• Bollinger Bands</span>
                    <span className="text-muted-foreground">• EMAs (9, 21, 50)</span>
                    <span className="text-muted-foreground">• Volumen</span>
                    <span className="text-muted-foreground">• ATR</span>
                    <span className="text-muted-foreground">• Multi-timeframe</span>
                    <span className="text-muted-foreground">• Análisis de tendencia</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Sección 2: Pasos para usar el bot */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-500/20 rounded-lg">
                    <ListChecks className="h-6 w-6 text-green-400" />
                  </div>
                  <div>
                    <CardTitle className="text-lg md:text-xl">2. Pasos para usar el bot</CardTitle>
                    <CardDescription>Flujo básico de configuración</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { step: 1, title: "Configurar API de Kraken", desc: "Ve a Integraciones y añade tu API Key y Secret de Kraken. Asegúrate de que la API tenga permisos de trading.", icon: Key },
                    { step: 2, title: "Configurar Telegram (opcional)", desc: "Añade el token de tu bot de Telegram y tu Chat ID para recibir notificaciones de operaciones.", icon: Plug },
                    { step: 3, title: "Elegir estrategia", desc: "En la página Estrategias, selecciona el algoritmo que mejor se adapte a tu estilo (momentum, scalping, etc.).", icon: Activity },
                    { step: 4, title: "Ajustar parámetros de riesgo", desc: "Configura el nivel de riesgo, Stop Loss y Take Profit según tu tolerancia.", icon: Shield },
                    { step: 5, title: "Activar el bot", desc: "Activa el switch 'Bot Activo' y el bot comenzará a analizar el mercado y operar automáticamente.", icon: Zap },
                  ].map((item) => (
                    <div key={item.step} className="flex gap-4 p-4 border border-border rounded-lg bg-card/30">
                      <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">
                        {item.step}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-semibold flex items-center gap-2">
                          <item.icon className="h-4 w-4 text-primary" />
                          {item.title}
                        </h4>
                        <p className="text-sm text-muted-foreground mt-1">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Sección 3: Parámetros y definiciones */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/20 rounded-lg">
                    <Settings className="h-6 w-6 text-purple-400" />
                  </div>
                  <div>
                    <CardTitle className="text-lg md:text-xl">3. Parámetros y definiciones</CardTitle>
                    <CardDescription>Explicación detallada de cada configuración</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Accordion type="single" collapsible className="w-full">
                  
                  <AccordionItem value="strategy">
                    <AccordionTrigger className="text-left">
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-primary" />
                        Estrategia de Trading
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 text-sm">
                      <p><strong>¿Qué es?</strong> El algoritmo que el bot usa para decidir cuándo comprar o vender.</p>
                      <div className="space-y-2">
                        <div className="p-3 bg-card/50 rounded border border-border">
                          <p className="font-medium text-green-400">Momentum</p>
                          <p className="text-muted-foreground">Sigue tendencias fuertes. Compra cuando el precio sube con fuerza, vende cuando baja. Ideal para mercados con tendencia clara.</p>
                        </div>
                        <div className="p-3 bg-card/50 rounded border border-border">
                          <p className="font-medium text-blue-400">Reversión a la Media</p>
                          <p className="text-muted-foreground">Opera cuando el precio se aleja mucho de su promedio. Compra en caídas extremas, vende en subidas extremas.</p>
                        </div>
                        <div className="p-3 bg-card/50 rounded border border-border">
                          <p className="font-medium text-yellow-400">Scalping</p>
                          <p className="text-muted-foreground">Muchas operaciones pequeñas y rápidas. Busca pequeños beneficios frecuentes. Requiere más comisiones.</p>
                        </div>
                        <div className="p-3 bg-card/50 rounded border border-border">
                          <p className="font-medium text-purple-400">Grid Trading</p>
                          <p className="text-muted-foreground">Coloca órdenes de compra y venta en niveles de precio fijos. Funciona bien en mercados laterales.</p>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="risk">
                    <AccordionTrigger className="text-left">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-primary" />
                        Nivel de Riesgo
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 text-sm">
                      <p><strong>¿Qué es?</strong> Controla el tamaño de las posiciones y la agresividad del bot.</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <div className="p-3 bg-green-500/10 rounded border border-green-500/30">
                          <p className="font-medium text-green-400">Bajo</p>
                          <p className="text-muted-foreground text-xs">Posiciones pequeñas, stops ajustados. Menor ganancia pero menor riesgo.</p>
                        </div>
                        <div className="p-3 bg-yellow-500/10 rounded border border-yellow-500/30">
                          <p className="font-medium text-yellow-400">Medio</p>
                          <p className="text-muted-foreground text-xs">Balance entre riesgo y rendimiento. Recomendado para la mayoría.</p>
                        </div>
                        <div className="p-3 bg-red-500/10 rounded border border-red-500/30">
                          <p className="font-medium text-red-400">Alto</p>
                          <p className="text-muted-foreground text-xs">Posiciones grandes, más volatilidad. Mayor ganancia potencial pero más riesgo.</p>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="stoploss">
                    <AccordionTrigger className="text-left">
                      <div className="flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-red-500" />
                        Stop Loss (%)
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 text-sm">
                      <p><strong>¿Qué es?</strong> Porcentaje máximo de pérdida que el bot tolerará antes de cerrar una posición automáticamente.</p>
                      <div className="p-3 bg-card/50 rounded border border-border">
                        <p><strong>Valores recomendados:</strong> Entre 2% y 5%</p>
                        <p className="text-muted-foreground mt-1">
                          <strong>Muy bajo (1%):</strong> Se cerrarán posiciones muy rápido, posibles pérdidas por volatilidad normal.<br/>
                          <strong>Muy alto (10%+):</strong> Pérdidas grandes si el mercado va en contra.
                        </p>
                      </div>
                      <p className="text-muted-foreground">
                        <strong>Ejemplo:</strong> Si compras BTC a $100,000 con Stop Loss 3%, la posición se cerrará automáticamente si BTC baja a $97,000.
                      </p>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="takeprofit">
                    <AccordionTrigger className="text-left">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-green-500" />
                        Take Profit (%)
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 text-sm">
                      <p><strong>¿Qué es?</strong> Porcentaje de ganancia objetivo. Cuando se alcanza, el bot cierra la posición asegurando beneficios.</p>
                      <div className="p-3 bg-card/50 rounded border border-border">
                        <p><strong>Valores recomendados:</strong> Entre 3% y 10%</p>
                        <p className="text-muted-foreground mt-1">
                          <strong>Muy bajo (1%):</strong> Ganancias pequeñas, las comisiones pueden comerlas.<br/>
                          <strong>Muy alto (20%+):</strong> Difícil de alcanzar, el precio puede revertir antes.
                        </p>
                      </div>
                      <p className="text-muted-foreground">
                        <strong>Ejemplo:</strong> Si compras ETH a $3,000 con Take Profit 5%, la posición se cerrará automáticamente cuando ETH llegue a $3,150.
                      </p>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="trailing">
                    <AccordionTrigger className="text-left">
                      <div className="flex items-center gap-2">
                        <Percent className="h-4 w-4 text-primary" />
                        Trailing Stop
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 text-sm">
                      <p><strong>¿Qué es?</strong> Un stop loss dinámico que sigue al precio cuando este sube, asegurando ganancias progresivamente.</p>
                      <div className="p-3 bg-card/50 rounded border border-border">
                        <p><strong>Cómo funciona:</strong></p>
                        <p className="text-muted-foreground mt-1">
                          Si activas Trailing Stop al 2% y el precio sube un 5%, el stop se mueve automáticamente para asegurar al menos un 3% de ganancia.
                        </p>
                      </div>
                      <p className="text-muted-foreground">
                        <strong>Recomendación:</strong> Actívalo si quieres capturar tendencias largas sin preocuparte por el Take Profit fijo.
                      </p>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="pairs">
                    <AccordionTrigger className="text-left">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-primary" />
                        Pares Activos
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 text-sm">
                      <p><strong>¿Qué es?</strong> Las criptomonedas que el bot analizará y operará.</p>
                      <div className="p-3 bg-card/50 rounded border border-border">
                        <p className="text-muted-foreground">
                          <strong>Pocos pares (1-2):</strong> El bot se concentra en esos mercados, operaciones más frecuentes por par.<br/>
                          <strong>Muchos pares (5+):</strong> Más oportunidades pero el capital se divide, operaciones más pequeñas.
                        </p>
                      </div>
                      <p className="text-muted-foreground">
                        <strong>Recomendación para saldos pequeños:</strong> Activa solo 1-2 pares con mejor liquidez (BTC/USD, ETH/USD).
                      </p>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="timeframes">
                    <AccordionTrigger className="text-left">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-primary" />
                        Multi-Timeframe
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 text-sm">
                      <p><strong>¿Qué es?</strong> El bot analiza múltiples marcos temporales para confirmar señales.</p>
                      <div className="p-3 bg-card/50 rounded border border-border">
                        <p className="text-muted-foreground">
                          <strong>5 minutos:</strong> Señales de entrada rápidas<br/>
                          <strong>1 hora:</strong> Tendencia a corto plazo<br/>
                          <strong>4 horas:</strong> Tendencia general del mercado
                        </p>
                      </div>
                      <p className="text-muted-foreground">
                        El bot no operará contra la tendencia principal. Si los 3 timeframes coinciden en dirección, añade +15% de confianza a la señal.
                      </p>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="indicators">
                    <AccordionTrigger className="text-left">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-primary" />
                        Indicadores Técnicos por Estrategia
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 text-sm">
                      <p><strong>¿Qué son?</strong> Fórmulas matemáticas que analizan el precio y volumen para predecir movimientos.</p>
                      <div className="space-y-2">
                        <div className="p-3 bg-green-500/10 rounded border border-green-500/30">
                          <p className="font-medium text-green-400">Momentum usa:</p>
                          <ul className="text-muted-foreground text-xs mt-1 space-y-1">
                            <li>• <strong>EMAs (9, 21, 50):</strong> Medias móviles exponenciales para detectar tendencia</li>
                            <li>• <strong>MACD:</strong> Señal=12, Línea=26, Histograma para momentum</li>
                            <li>• <strong>RSI (14):</strong> Fuerza relativa, señales cuando &gt;70 o &lt;30</li>
                          </ul>
                        </div>
                        <div className="p-3 bg-blue-500/10 rounded border border-blue-500/30">
                          <p className="font-medium text-blue-400">Reversión a la Media usa:</p>
                          <ul className="text-muted-foreground text-xs mt-1 space-y-1">
                            <li>• <strong>Bollinger Bands (20, 2):</strong> Detecta extremos de precio</li>
                            <li>• <strong>RSI (14):</strong> Sobreventa &lt;30 = compra, sobrecompra &gt;70 = venta</li>
                            <li>• <strong>EMA 50:</strong> Referencia de precio promedio</li>
                          </ul>
                        </div>
                        <div className="p-3 bg-yellow-500/10 rounded border border-yellow-500/30">
                          <p className="font-medium text-yellow-400">Scalping usa:</p>
                          <ul className="text-muted-foreground text-xs mt-1 space-y-1">
                            <li>• <strong>EMAs rápidas (9, 21):</strong> Cruces para entradas rápidas</li>
                            <li>• <strong>Volumen:</strong> Confirma fuerza del movimiento</li>
                            <li>• <strong>ATR:</strong> Volatilidad para ajustar stops dinámicos</li>
                          </ul>
                        </div>
                        <div className="p-3 bg-purple-500/10 rounded border border-purple-500/30">
                          <p className="font-medium text-purple-400">Grid Trading usa:</p>
                          <ul className="text-muted-foreground text-xs mt-1 space-y-1">
                            <li>• <strong>ATR:</strong> Calcula separación entre niveles del grid</li>
                            <li>• <strong>Soporte/Resistencia:</strong> Define límites del grid</li>
                            <li>• <strong>Volumen:</strong> Valida zonas de acumulación</li>
                          </ul>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="position-size">
                    <AccordionTrigger className="text-left">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-primary" />
                        Tamaño de Posición y Riesgo Diario
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 text-sm">
                      <p><strong>¿Qué es?</strong> La cantidad de capital que el bot arriesga en cada operación y el límite diario.</p>
                      <div className="p-3 bg-card/50 rounded border border-border">
                        <p><strong>Cálculo automático por operación:</strong></p>
                        <p className="text-muted-foreground mt-1">
                          El bot calcula el tamaño basándose en:<br/>
                          • Tu saldo disponible<br/>
                          • El nivel de riesgo seleccionado (bajo/medio/alto)<br/>
                          • El Stop Loss configurado<br/>
                          • Los mínimos de orden de Kraken
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <div className="p-2 bg-green-500/10 rounded text-xs">
                          <p className="font-medium text-green-400">Riesgo Bajo</p>
                          <p className="text-muted-foreground">~1-2% por operación</p>
                          <p className="text-muted-foreground">~5% máx. diario</p>
                        </div>
                        <div className="p-2 bg-yellow-500/10 rounded text-xs">
                          <p className="font-medium text-yellow-400">Riesgo Medio</p>
                          <p className="text-muted-foreground">~3-5% por operación</p>
                          <p className="text-muted-foreground">~10% máx. diario</p>
                        </div>
                        <div className="p-2 bg-red-500/10 rounded text-xs">
                          <p className="font-medium text-red-400">Riesgo Alto</p>
                          <p className="text-muted-foreground">~5-10% por operación</p>
                          <p className="text-muted-foreground">~20% máx. diario</p>
                        </div>
                      </div>
                      <div className="p-3 bg-yellow-500/10 rounded border border-yellow-500/30">
                        <p className="font-medium text-yellow-400">Límite de pérdida diaria</p>
                        <p className="text-muted-foreground text-xs mt-1">
                          El bot controla las pérdidas acumuladas del día. Si alcanzas el límite diario, 
                          el bot pausa las operaciones hasta el día siguiente para proteger tu capital.
                          Monitorea tu historial de operaciones para verificar el rendimiento diario.
                        </p>
                      </div>
                      <p className="text-muted-foreground">
                        <strong>Ejemplo:</strong> Con $100 de saldo y riesgo medio, cada operación usará ~$3-5 y el bot parará si pierdes más de $10 en un día.
                      </p>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="filters">
                    <AccordionTrigger className="text-left">
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-primary" />
                        Filtros de Volatilidad y Volumen
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 text-sm">
                      <p><strong>¿Qué son?</strong> Condiciones adicionales que deben cumplirse antes de abrir una operación.</p>
                      <div className="p-3 bg-card/50 rounded border border-border">
                        <p className="font-medium mb-2">Filtro de Volatilidad (ATR)</p>
                        <p className="text-muted-foreground">
                          El bot mide la volatilidad usando ATR (Average True Range). Si la volatilidad es muy baja, 
                          no opera porque los movimientos no cubrirían las comisiones. Si es muy alta, reduce el tamaño de posición.
                        </p>
                      </div>
                      <div className="p-3 bg-card/50 rounded border border-border">
                        <p className="font-medium mb-2">Filtro de Volumen</p>
                        <p className="text-muted-foreground">
                          Compara el volumen actual con el promedio de las últimas 20 velas. Solo opera cuando el volumen 
                          es al menos 50% del promedio, evitando entrar en mercados "muertos" donde el precio puede manipularse fácilmente.
                        </p>
                      </div>
                      <p className="text-muted-foreground">
                        <strong>Beneficio:</strong> Estos filtros reducen operaciones en condiciones desfavorables, mejorando la tasa de acierto.
                      </p>
                    </AccordionContent>
                  </AccordionItem>

                  <AccordionItem value="mode">
                    <AccordionTrigger className="text-left">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-primary" />
                        Modo de Operación
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 text-sm">
                      <p><strong>¿Qué es?</strong> El bot está configurado para operar exclusivamente en modo REAL.</p>
                      <div className="p-3 bg-yellow-500/10 rounded border border-yellow-500/30">
                        <p className="font-medium text-yellow-400">⚠️ Importante</p>
                        <p className="text-muted-foreground mt-1">
                          Este bot ejecuta operaciones reales con dinero real en Kraken. No incluye modo paper/demo.
                          Cada operación afectará tu saldo real.
                        </p>
                      </div>
                      <div className="p-3 bg-card/50 rounded border border-border">
                        <p className="font-medium mb-2">Recomendaciones para empezar:</p>
                        <ul className="text-muted-foreground space-y-1">
                          <li>• Empieza con el mínimo capital posible ($10-50)</li>
                          <li>• Usa nivel de riesgo BAJO al principio</li>
                          <li>• Activa solo 1-2 pares para observar</li>
                          <li>• Revisa el historial de operaciones diariamente</li>
                          <li>• Aumenta capital solo cuando entiendas el comportamiento</li>
                        </ul>
                      </div>
                    </AccordionContent>
                  </AccordionItem>

                </Accordion>
              </CardContent>
            </Card>

            {/* Sección 4: Estados del bot y errores */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-500/20 rounded-lg">
                    <AlertTriangle className="h-6 w-6 text-orange-400" />
                  </div>
                  <div>
                    <CardTitle className="text-lg md:text-xl">4. Estados del bot y errores típicos</CardTitle>
                    <CardDescription>Significado de cada estado y cómo solucionar problemas</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                
                <h4 className="font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Estados normales
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 border border-green-500/30 rounded-lg bg-green-500/5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="h-2 w-2 rounded-full bg-green-500"></span>
                      <span className="font-medium">Bot Activo</span>
                    </div>
                    <p className="text-xs text-muted-foreground">El bot está analizando el mercado y puede ejecutar operaciones.</p>
                  </div>
                  <div className="p-3 border border-yellow-500/30 rounded-lg bg-yellow-500/5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="h-2 w-2 rounded-full bg-yellow-500"></span>
                      <span className="font-medium">Bot Pausado</span>
                    </div>
                    <p className="text-xs text-muted-foreground">El bot no está operando. Actívalo manualmente para que empiece.</p>
                  </div>
                  <div className="p-3 border border-green-500/30 rounded-lg bg-green-500/5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="h-2 w-2 rounded-full bg-green-500"></span>
                      <span className="font-medium">Kraken Conectado</span>
                    </div>
                    <p className="text-xs text-muted-foreground">La API de Kraken está configurada correctamente y funcionando.</p>
                  </div>
                  <div className="p-3 border border-green-500/30 rounded-lg bg-green-500/5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="h-2 w-2 rounded-full bg-green-500"></span>
                      <span className="font-medium">Telegram Conectado</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Las notificaciones de Telegram están activas.</p>
                  </div>
                </div>

                <h4 className="font-semibold flex items-center gap-2 mt-6">
                  <XCircle className="h-4 w-4 text-red-500" />
                  Errores comunes y soluciones
                </h4>
                <div className="space-y-3">
                  <div className="p-4 border border-red-500/30 rounded-lg bg-red-500/5">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                      <span className="font-medium">Error de Nonce (Invalid nonce)</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      Kraken rechaza la petición porque el identificador único de la llamada es inválido.
                    </p>
                    <div className="text-xs p-2 bg-card/50 rounded">
                      <strong>Causas posibles:</strong><br/>
                      • Hay otra instancia del bot usando la misma API Key<br/>
                      • Reinicio muy rápido del bot<br/>
                      <strong>Solución:</strong> Verifica que no tengas el bot corriendo en dos sitios (Replit + NAS). El bot reintenta automáticamente 3 veces.
                    </div>
                  </div>
                  
                  <div className="p-4 border border-red-500/30 rounded-lg bg-red-500/5">
                    <div className="flex items-center gap-2 mb-2">
                      <WifiOff className="h-4 w-4 text-red-500" />
                      <span className="font-medium">Kraken Desconectado</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      El bot no puede comunicarse con Kraken.
                    </p>
                    <div className="text-xs p-2 bg-card/50 rounded">
                      <strong>Causas posibles:</strong><br/>
                      • API Key o Secret incorrectos<br/>
                      • La API no tiene permisos de trading<br/>
                      • Kraken está en mantenimiento<br/>
                      <strong>Solución:</strong> Ve a Integraciones y verifica tus credenciales. Regenera la API Key si es necesario.
                    </div>
                  </div>

                  <div className="p-4 border border-yellow-500/30 rounded-lg bg-yellow-500/5">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="h-4 w-4 text-yellow-500" />
                      <span className="font-medium">Saldo insuficiente (Insufficient funds)</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      No hay suficiente saldo para ejecutar la operación.
                    </p>
                    <div className="text-xs p-2 bg-card/50 rounded">
                      <strong>Causas posibles:</strong><br/>
                      • El saldo disponible es menor que el mínimo de orden de Kraken<br/>
                      • El saldo está bloqueado en órdenes abiertas<br/>
                      • Se alcanzó el límite de pérdida diaria<br/>
                      <strong>Solución:</strong> Deposita más fondos en Kraken, cancela órdenes pendientes, o espera al día siguiente si alcanzaste el límite diario.
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Sección 5: Buenas prácticas */}
            <Card className="glass-panel border-border/50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/20 rounded-lg">
                    <Lightbulb className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg md:text-xl">5. Buenas prácticas y consejos</CardTitle>
                    <CardDescription>Recomendaciones para operar de forma segura</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                
                <div className="p-4 border border-primary/30 rounded-lg bg-primary/5">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    Checklist antes de activar el bot
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    <label className="flex items-center gap-2 text-muted-foreground">
                      <input type="checkbox" className="rounded" disabled /> API de Kraken configurada y verificada
                    </label>
                    <label className="flex items-center gap-2 text-muted-foreground">
                      <input type="checkbox" className="rounded" disabled /> Telegram configurado (opcional)
                    </label>
                    <label className="flex items-center gap-2 text-muted-foreground">
                      <input type="checkbox" className="rounded" disabled /> Saldo suficiente en la cuenta
                    </label>
                    <label className="flex items-center gap-2 text-muted-foreground">
                      <input type="checkbox" className="rounded" disabled /> Estrategia y pares seleccionados
                    </label>
                    <label className="flex items-center gap-2 text-muted-foreground">
                      <input type="checkbox" className="rounded" disabled /> Stop Loss y Take Profit configurados
                    </label>
                    <label className="flex items-center gap-2 text-muted-foreground">
                      <input type="checkbox" className="rounded" disabled /> Nivel de riesgo adecuado a tu capital
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border border-green-500/30 rounded-lg bg-green-500/5">
                    <h4 className="font-semibold mb-2 text-green-400">✅ Hacer</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Empezar con posiciones pequeñas</li>
                      <li>• Revisar el dashboard y balance diariamente</li>
                      <li>• Configurar alertas de Telegram</li>
                      <li>• Usar Stop Loss siempre</li>
                      <li>• Monitorear pérdidas/ganancias diarias en Historial</li>
                      <li>• Verificar saldo antes de activar el bot</li>
                    </ul>
                  </div>
                  <div className="p-4 border border-red-500/30 rounded-lg bg-red-500/5">
                    <h4 className="font-semibold mb-2 text-red-400">❌ Evitar</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Invertir todo tu capital</li>
                      <li>• Desactivar el Stop Loss</li>
                      <li>• Usar riesgo alto sin experiencia</li>
                      <li>• Ignorar las alertas del bot</li>
                      <li>• Ejecutar múltiples instancias</li>
                      <li>• Operar sin revisar el rendimiento semanal</li>
                    </ul>
                  </div>
                </div>

                <div className="p-4 border border-yellow-500/30 rounded-lg bg-yellow-500/5">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    Advertencia importante
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    El trading de criptomonedas conlleva riesgos significativos. Nunca inviertas dinero que no puedas permitirte perder. 
                    Este bot es una herramienta automatizada, pero no garantiza beneficios. Supervisa regularmente su funcionamiento 
                    y ajusta la configuración según las condiciones del mercado.
                  </p>
                </div>

                <div className="p-4 border border-border rounded-lg bg-card/30">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <HelpCircle className="h-4 w-4 text-primary" />
                    ¿Qué revisar en el Dashboard?
                  </h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• <strong>Balances:</strong> Verifica que tu saldo es correcto</li>
                    <li>• <strong>Estado del bot:</strong> Confirma que está activo y conectado</li>
                    <li>• <strong>Últimas operaciones:</strong> Revisa que las operaciones se ejecutan correctamente</li>
                    <li>• <strong>Precios:</strong> Comprueba que los precios se actualizan en tiempo real</li>
                  </ul>
                </div>

              </CardContent>
            </Card>

          </div>
        </main>
      </div>
    </div>
  );
}
