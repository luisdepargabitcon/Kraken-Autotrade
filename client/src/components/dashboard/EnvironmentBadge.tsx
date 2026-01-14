import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Server, TestTube, AlertTriangle, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";

interface EnvironmentData {
  env: "REPLIT/DEV" | "VPS/STG" | "NAS/PROD";
  instanceId: string;
  version: string;
  isReplit: boolean;
  isVPS: boolean;
  isNAS: boolean;
  dryRun: boolean;
}

function getEnvColors(env: EnvironmentData["env"]) {
  switch (env) {
    case "NAS/PROD":
      return { bg: "bg-green-500", border: "border-green-500", text: "text-green-500" };
    case "VPS/STG":
      return { bg: "bg-cyan-500", border: "border-cyan-500", text: "text-cyan-500" };
    case "REPLIT/DEV":
    default:
      return { bg: "bg-yellow-500", border: "border-yellow-500", text: "text-yellow-500" };
  }
}

function EnvIcon({ env }: { env: EnvironmentData["env"] }) {
  const colors = getEnvColors(env);
  switch (env) {
    case "NAS/PROD":
      return <Server className={cn("w-5 h-5", colors.text)} />;
    case "VPS/STG":
      return <Cloud className={cn("w-5 h-5", colors.text)} />;
    default:
      return <TestTube className={cn("w-5 h-5", colors.text)} />;
  }
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

  const colors = getEnvColors(data.env);
  const showDryRunWarning = data.dryRun;
  const commitTag = data.version?.split("-").pop() ?? data.version ?? "N/A";

  if (compact) {
    return (
      <div className="flex items-center gap-2" data-testid="environment-badge-compact">
        <Badge 
          variant="outline"
          className={cn("font-mono text-xs", `${colors.bg}/10 ${colors.text} ${colors.border}/30`)}
        >
          <EnvIcon env={data.env} />
          <span className="ml-1">{data.env}</span>
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
        `${colors.bg}/5 ${colors.border}/20`
      )}
      data-testid="environment-badge"
    >
      <div className="flex items-center gap-2">
        <EnvIcon env={data.env} />
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("font-mono font-bold text-sm", colors.text)}>
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
            <Badge 
              variant="outline"
              className="font-mono text-[10px] bg-slate-500/10 text-slate-500 border-slate-500/30"
            >
              Windsurf&nbsp;{commitTag}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            ID: {data.instanceId} · v{data.version}
          </p>
        </div>
      </div>
      
      {(data.isReplit || data.dryRun) && (
        <p className="text-xs text-muted-foreground">
          {data.isReplit ? "Entorno de desarrollo - " : ""}No se envían órdenes reales
        </p>
      )}
    </div>
  );
}
