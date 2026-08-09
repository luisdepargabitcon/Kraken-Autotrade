import { ENVIRONMENT_LABELS } from "./amaLabels";

interface AmaModeSelectorProps {
  environment: "OFF" | "LAB" | "REAL";
  onSelectEnvironment: (env: "OFF" | "LAB" | "REAL") => void;
}

const ENVIRONMENTS: ("OFF" | "LAB" | "REAL")[] = ["OFF", "LAB", "REAL"];

export function AmaModeSelector({
  environment,
  onSelectEnvironment,
}: AmaModeSelectorProps) {
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex gap-2 min-w-max">
        {ENVIRONMENTS.map((env) => {
          const active = environment === env;
          const colorClass = env === "REAL"
            ? (active ? "bg-orange-500 text-white" : "bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 border border-orange-500/30")
            : (active ? "bg-primary text-primary-foreground" : "bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-border/30");
          return (
            <button
              key={env}
              onClick={() => onSelectEnvironment(env)}
              className={`
                flex items-center justify-center px-4 h-11 rounded-md text-sm font-medium
                transition-all whitespace-nowrap
                ${colorClass}
              `}
            >
              {ENVIRONMENT_LABELS[env]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
