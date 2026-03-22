import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ParamDetail {
  label: string;
  value: string;
}

interface MasterSliderProps {
  title: string;
  icon: React.ReactNode;
  value: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  leftLabel: string;
  rightLabel: string;
  accentColor: string;
  legendLine1: string;
  legendLine2: string;
  getDynamicLines: (value: number) => string[];
  getParamDetails: (value: number) => ParamDetail[];
}

const colorMap: Record<string, { slider: string; text: string; border: string; bg: string }> = {
  orange: { slider: "[&>span]:bg-orange-500", text: "text-orange-400", border: "border-orange-500/30", bg: "bg-orange-500/10" },
  blue: { slider: "[&>span]:bg-blue-500", text: "text-blue-400", border: "border-blue-500/30", bg: "bg-blue-500/10" },
  emerald: { slider: "[&>span]:bg-emerald-500", text: "text-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-500/10" },
  red: { slider: "[&>span]:bg-red-500", text: "text-red-400", border: "border-red-500/30", bg: "bg-red-500/10" },
  purple: { slider: "[&>span]:bg-purple-500", text: "text-purple-400", border: "border-purple-500/30", bg: "bg-purple-500/10" },
  cyan: { slider: "[&>span]:bg-cyan-500", text: "text-cyan-400", border: "border-cyan-500/30", bg: "bg-cyan-500/10" },
  amber: { slider: "[&>span]:bg-amber-500", text: "text-amber-400", border: "border-amber-500/30", bg: "bg-amber-500/10" },
};

export function MasterSlider({
  title,
  icon,
  value,
  onChange,
  onCommit,
  leftLabel,
  rightLabel,
  accentColor,
  legendLine1,
  legendLine2,
  getDynamicLines,
  getParamDetails,
}: MasterSliderProps) {
  const [showDetails, setShowDetails] = useState(false);
  const colors = colorMap[accentColor] || colorMap.blue;
  const dynamicLines = getDynamicLines(value);
  const params = getParamDetails(value);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </Label>
        <span className={cn("font-mono text-2xl", colors.text)}>{value}</span>
      </div>

      {/* Slider */}
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        onValueCommit={(v) => onCommit(v[0])}
        min={0}
        max={100}
        step={5}
        className={colors.slider}
      />

      {/* Polarity labels */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>

      {/* Fixed legend */}
      <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
        <p>{legendLine1}</p>
        <p>{legendLine2}</p>
      </div>

      {/* Dynamic yellow block */}
      {dynamicLines.length > 0 && (
        <div className={cn("rounded-lg p-3 border text-xs space-y-1", "border-yellow-500/30 bg-yellow-500/10")}>
          <p className="font-medium text-yellow-400 text-[11px]">Ahora el bot:</p>
          {dynamicLines.map((line, i) => (
            <p key={i} className="text-yellow-300/90">• {line}</p>
          ))}
        </div>
      )}

      {/* Expandable param details */}
      {params.length > 0 && (
        <div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showDetails ? "Ocultar parámetros" : "Ver parámetros reales"}
          </button>
          {showDetails && (
            <div className={cn("mt-2 rounded-lg p-3 border text-xs space-y-1 font-mono", colors.border, colors.bg)}>
              {params.map((p, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{p.label}</span>
                  <span className={colors.text}>{p.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Utility: linear interpolation
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
