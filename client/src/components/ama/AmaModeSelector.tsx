import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { MODE_LABELS } from "./amaLabels";

interface AmaModeSelectorProps {
  currentMode: string;
  onSelectMode: (mode: string) => void;
  realLimitedDisabled?: boolean;
}

const SELECTABLE_MODES = ["OFF", "LAB", "REPLAY", "SHADOW_SCENARIO", "SHADOW_LIVE"];

export function AmaModeSelector({
  currentMode,
  onSelectMode,
  realLimitedDisabled = true,
}: AmaModeSelectorProps) {
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex gap-1 min-w-max md:min-w-0 md:grid md:grid-cols-7 h-11">
        {SELECTABLE_MODES.map((m) => {
          const active = currentMode === m;
          return (
            <button
              key={m}
              onClick={() => onSelectMode(m)}
              className={`
                flex items-center justify-center px-3 h-11 rounded-md text-sm font-medium
                transition-all whitespace-nowrap
                ${active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-border/30"
                }
              `}
            >
              {MODE_LABELS[m]}
            </button>
          );
        })}

        {/* Real limitado — disabled by default */}
        <button
          disabled={realLimitedDisabled}
          onClick={() => !realLimitedDisabled && onSelectMode("REAL_LIMITED")}
          className={`
            flex items-center justify-center px-3 h-11 rounded-md text-sm font-medium
            transition-all whitespace-nowrap cursor-not-allowed
            ${currentMode === "REAL_LIMITED"
              ? "bg-orange-500/20 text-orange-400 border border-orange-500/40"
              : "bg-muted/20 text-muted-foreground/50 border border-border/20"
            }
          `}
          title={realLimitedDisabled ? "Requiere autorización en Operación" : "Real limitado"}
        >
          {MODE_LABELS.REAL_LIMITED}
        </button>

        {/* Real completo — always locked */}
        <button
          disabled
          className="flex items-center justify-center px-3 h-11 rounded-md text-sm font-medium bg-muted/20 text-muted-foreground/40 border border-border/20 cursor-not-allowed whitespace-nowrap"
          title="Bloqueado — reservado para el futuro"
        >
          <Lock className="h-3.5 w-3.5 mr-1.5" />
          Real completo
        </button>
      </div>
    </div>
  );
}
