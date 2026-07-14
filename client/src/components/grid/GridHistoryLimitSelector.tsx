import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface GridHistoryLimitSelectorProps {
  label: string;
  totalCount: number;
  visibleLimit: number;
  onLimitChange: (limit: number) => void;
  options?: number[];
  archiveCandidates?: number;
  infoText?: string;
}

const DEFAULT_OPTIONS = [10, 25, 50, 100];

export function GridHistoryLimitSelector({
  label,
  totalCount,
  visibleLimit,
  onLimitChange,
  options = DEFAULT_OPTIONS,
  archiveCandidates,
  infoText,
}: GridHistoryLimitSelectorProps) {
  const showingAll = visibleLimit >= totalCount;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/10 border border-border/30 px-3 py-2">
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate">
          {label}:
        </span>
        <Badge variant="outline" className="text-xs font-mono shrink-0">
          {Math.min(visibleLimit, totalCount)} / {totalCount}
        </Badge>
        {archiveCandidates !== undefined && archiveCandidates > 0 && (
          <Badge variant="outline" className="text-xs font-mono text-amber-400 border-amber-500/30 shrink-0">
            {archiveCandidates} en cola de archivo
          </Badge>
        )}
      </div>

      {!showingAll && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Ver:</span>
          {options.map(opt => (
            <Button
              key={opt}
              size="sm"
              variant={visibleLimit === opt ? "default" : "ghost"}
              className="h-6 px-2 text-xs"
              onClick={() => onLimitChange(opt)}
            >
              {opt}
            </Button>
          ))}
          <Button
            size="sm"
            variant={showingAll ? "default" : "ghost"}
            className="h-6 px-2 text-xs"
            onClick={() => onLimitChange(totalCount)}
          >
            Todos
          </Button>
        </div>
      )}

      {infoText && (
        <p className="text-[10px] text-muted-foreground/70 w-full">
          {infoText}
        </p>
      )}
    </div>
  );
}
