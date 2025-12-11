import { useQuery } from "@tanstack/react-query";
import { Nav } from "@/components/dashboard/Nav";
import generatedImage from '@assets/generated_images/dark_digital_hex_grid_background.png';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, ArrowDownRight, Clock, DollarSign } from "lucide-react";

interface Trade {
  id: number;
  tradeId: string;
  pair: string;
  type: string;
  price: string;
  amount: string;
  status: string;
  krakenOrderId?: string;
  executedAt?: string;
  createdAt: string;
}

export default function History() {
  const { data: trades, isLoading } = useQuery<Trade[]>({
    queryKey: ["trades"],
    queryFn: async () => {
      const res = await fetch("/api/trades?limit=100");
      if (!res.ok) throw new Error("Failed to fetch trades");
      return res.json();
    },
  });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

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
        
        <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full space-y-4 md:space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl md:text-3xl font-bold font-sans tracking-tight">Historial de Operaciones</h1>
              <p className="text-sm md:text-base text-muted-foreground mt-1">Registro completo de todas las transacciones.</p>
            </div>
          </div>

          <Card className="glass-panel border-border/50">
            <CardHeader>
              <CardTitle className="text-lg font-mono">OPERACIONES RECIENTES</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
                </div>
              ) : trades && trades.length > 0 ? (
                <div className="space-y-3">
                  {trades.map((trade) => (
                    <div 
                      key={trade.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3 md:p-4 bg-card/50 rounded-lg border border-border/30 hover:border-border/50 transition-colors gap-3 sm:gap-4"
                      data-testid={`trade-row-${trade.id}`}
                    >
                      <div className="flex items-center gap-3 md:gap-4">
                        <div className={`p-1.5 md:p-2 rounded-lg ${trade.type === 'buy' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                          {trade.type === 'buy' ? (
                            <ArrowUpRight className="h-4 w-4 md:h-5 md:w-5 text-green-500" />
                          ) : (
                            <ArrowDownRight className="h-4 w-4 md:h-5 md:w-5 text-red-500" />
                          )}
                        </div>
                        <div>
                          <div className="font-mono font-medium text-sm md:text-base">
                            {trade.type.toUpperCase()} {trade.pair}
                          </div>
                          <div className="text-xs md:text-sm text-muted-foreground flex items-center gap-2">
                            <Clock className="h-3 w-3" />
                            {formatDate(trade.createdAt)}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between sm:justify-end gap-4 md:gap-6 ml-9 sm:ml-0">
                        <div className="text-left sm:text-right">
                          <div className="font-mono text-xs text-muted-foreground">Cantidad</div>
                          <div className="font-mono font-medium text-sm">{parseFloat(trade.amount).toFixed(6)}</div>
                        </div>
                        <div className="text-left sm:text-right">
                          <div className="font-mono text-xs text-muted-foreground">Precio</div>
                          <div className="font-mono font-medium text-sm flex items-center gap-1">
                            <DollarSign className="h-3 w-3" />
                            {parseFloat(trade.price).toLocaleString()}
                          </div>
                        </div>
                        <Badge 
                          variant={trade.status === 'filled' ? 'default' : trade.status === 'pending' ? 'secondary' : 'destructive'}
                          className="font-mono text-xs"
                        >
                          {trade.status === 'filled' ? 'OK' : trade.status.toUpperCase()}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Clock className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">No hay operaciones registradas</p>
                  <p className="text-sm text-muted-foreground mt-1">Las operaciones aparecerán aquí cuando el bot comience a operar.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
