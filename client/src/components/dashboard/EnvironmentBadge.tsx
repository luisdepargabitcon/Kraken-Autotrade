import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Server, TestTube, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface EnvironmentData {
  env: "REPLIT/DEV" | "NAS/PROD";
  instanceId: string;
  isReplit: boolean;
  isNAS: boolean;
  dryRun: boolean;
  gitCommit?: string;
}

export function EnvironmentBadge({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useQuery<EnvironmentData>({
    queryKey: ["environment"],
    queryFn: async () => {
      const res = await fetch("/api/environment");
      if (!res.ok) throw new Error("Failed to fetch environment");
      return res.json();
    },
    staleTime: 60000,
  });

  if (isLoading || !data) return null;

  const isProduction = data.env === "NAS/PROD";
  const showDryRunWarning = data.dryRun;

  if (compact) {
    return (
      <div className="flex items-center gap-2" data-testid="environment-badge-compact">
        <Badge 
          variant="outline"
          className={cn(
            "font-mono text-xs",
            isProduction 
              ? "bg-green-500/10 text-green-500 border-green-500/30" 
              : "bg-yellow-500/10 text-yellow-500 border-yellow-500/30"
          )}
        >
          {isProduction ? <Server className="w-3 h-3 mr-1" /> : <TestTube className="w-3 h-3 mr-1" />}
          {data.env}
        </Badge>
        {showDryRunWarning && (
          <Badge 
            variant="outline"
            className="font-mono text-xs bg-orange-500/10 text-orange-500 border-orange-500/30"
          >
            <AlertTriangle className="w-3 h-3 mr-1" />
            DRY_RUN
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div 
      className={cn(
        "p-3 rounded-lg border flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4",
        isProduction 
          ? "bg-green-500/5 border-green-500/20" 
          : "bg-yellow-500/5 border-yellow-500/20"
      )}
      data-testid="environment-badge"
    >
      <div className="flex items-center gap-2">
        {isProduction ? (
          <Server className={cn("w-5 h-5", isProduction ? "text-green-500" : "text-yellow-500")} />
        ) : (
          <TestTube className="w-5 h-5 text-yellow-500" />
        )}
        <div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "font-mono font-bold text-sm",
              isProduction ? "text-green-500" : "text-yellow-500"
            )}>
              {data.env}
            </span>
            {showDryRunWarning && (
              <Badge 
                variant="outline"
                className="font-mono text-xs bg-orange-500/10 text-orange-500 border-orange-500/30"
              >
                DRY_RUN
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            ID: {data.instanceId} {data.gitCommit && <span className="opacity-60">· v{data.gitCommit}</span>}
          </p>
        </div>
      </div>
      
      {data.isReplit && (
        <p className="text-xs text-muted-foreground">
          Entorno de desarrollo - No se envían órdenes reales
        </p>
      )}
    </div>
  );
}
