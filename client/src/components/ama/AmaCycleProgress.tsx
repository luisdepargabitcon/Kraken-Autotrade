import { CYCLE_STATE_LABELS } from "./amaLabels";

const CYCLE_STEPS: { state: string; label: string }[] = [
  { state: "OBSERVING", label: "Observando" },
  { state: "CEILING_CANDIDATE", label: "Buscando techo" },
  { state: "VALUE_ZONE", label: "Esperando valor" },
  { state: "PLAN_ELIGIBLE", label: "Plan preparado" },
  { state: "ACCUMULATING", label: "Acumulando" },
  { state: "RECOVERY_MONITORING", label: "Recuperación" },
  { state: "DISTRIBUTING", label: "Distribuyendo" },
  { state: "CLOSED", label: "Cerrado" },
];

interface AmaCycleProgressProps {
  currentState: string | null | undefined;
}

export function AmaCycleProgress({ currentState }: AmaCycleProgressProps) {
  const activeIndex = CYCLE_STEPS.findIndex((s) => s.state === currentState);

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max py-2">
        {CYCLE_STEPS.map((step, i) => {
          const isPast = activeIndex >= 0 && i < activeIndex;
          const isActive = i === activeIndex;
          const isFuture = activeIndex >= 0 && i > activeIndex;
          const isUnknown = activeIndex === -1;

          return (
            <div key={step.state} className="flex items-center">
              {/* Step circle + label */}
              <div className="flex flex-col items-center gap-1 min-w-[80px]">
                <div
                  className={`
                    flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold
                    transition-all
                    ${isActive
                      ? "bg-primary text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-background scale-110"
                      : isPast
                      ? "bg-primary/20 text-primary/70"
                      : isFuture
                      ? "bg-muted/30 text-muted-foreground/40"
                      : "bg-muted/30 text-muted-foreground"
                    }
                  `}
                >
                  {i + 1}
                </div>
                <span
                  className={`text-xs text-center leading-tight ${
                    isActive
                      ? "text-foreground font-medium"
                      : isPast
                      ? "text-muted-foreground"
                      : "text-muted-foreground/40"
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {/* Connector line */}
              {i < CYCLE_STEPS.length - 1 && (
                <div
                  className={`h-0.5 w-6 md:w-10 mx-1 ${
                    isPast ? "bg-primary/40" : "bg-border/30"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
