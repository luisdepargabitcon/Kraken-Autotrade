import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Crosshair } from "lucide-react";

interface SpotIntentRow {
  signalId: string;
  pair: string;
  setupTag: string;
  state: string;
  createdAt: number;
  expiresAt: number;
  originPrice: number;
  originRegime: string;
  originDirection: string;
  originMacro: string;
  originAtrPct: number;
  retryCount: number;
  lastBlockReason: string | null;
}

interface SpotIntentsPanelProps {
  intents: SpotIntentRow[];
}

const stateColors: Record<string, string> = {
  CREATED: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  WAITING: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  APPROVED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  EXECUTED: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  EXPIRED: "bg-muted text-muted-foreground border-border",
  INVALIDATED: "bg-red-500/10 text-red-400 border-red-500/30",
  CHASED: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

export function SpotIntentsPanel({ intents }: SpotIntentsPanelProps) {
  const active = intents.filter(
    (i) => i.state === "WAITING" || i.state === "CREATED" || i.state === "CHASED"
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Crosshair className="h-4 w-4 text-primary" />
            Intenciones de Entrada
          </CardTitle>
          <div className="flex gap-2">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {active.length} activos
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {intents.length} total
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {intents.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No hay intenciones de entrada. El motor generará intenciones al detectar señales válidas.
          </div>
        ) : (
          <div className="space-y-2">
            {intents.map((intent) => {
              const now = Date.now();
              const expired = intent.expiresAt < now;
              const stateColor = stateColors[intent.state] ?? stateColors.CREATED;
              return (
                <div
                  key={intent.signalId}
                  className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{intent.pair}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {intent.setupTag.replace("_", " ")}
                      </Badge>
                    </div>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${stateColor}`}>
                      {intent.state}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-[11px]">
                    <MetaItem label="Origen" value={`$${intent.originPrice.toFixed(2)}`} />
                    <MetaItem label="Régimen" value={intent.originRegime} />
                    <MetaItem label="Dirección" value={intent.originDirection} />
                    <MetaItem label="Macro" value={intent.originMacro} />
                    <MetaItem label="ATR%" value={intent.originAtrPct.toFixed(2)} />
                    <MetaItem
                      label="Reintento"
                      value={String(intent.retryCount)}
                    />
                  </div>
                  {intent.lastBlockReason && (
                    <p className="text-[11px] text-yellow-400/80 font-mono">
                      ⚠ {intent.lastBlockReason}
                    </p>
                  )}
                  {expired && intent.state === "WAITING" && (
                    <p className="text-[11px] text-red-400/80 font-mono">
                      Expirado (TTL vencido)
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}
