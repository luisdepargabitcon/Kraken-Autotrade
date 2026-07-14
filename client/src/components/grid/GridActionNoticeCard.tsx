import { useState } from "react";
import { AlertTriangle, AlertCircle, Info, CheckCircle2, Zap, ChevronRight, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import type { GridActionNotice, NoticeSeverity } from "@/lib/gridActionNotices";

const SEVERITY_STYLES: Record<NoticeSeverity, {
  bg: string;
  border: string;
  icon: typeof Info;
  iconColor: string;
  badgeBg: string;
}> = {
  info: {
    bg: "bg-blue-500/5",
    border: "border-blue-500/20",
    icon: Info,
    iconColor: "text-blue-400",
    badgeBg: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  warning: {
    bg: "bg-amber-500/5",
    border: "border-amber-500/20",
    icon: AlertTriangle,
    iconColor: "text-amber-400",
    badgeBg: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  error: {
    bg: "bg-red-500/5",
    border: "border-red-500/20",
    icon: AlertCircle,
    iconColor: "text-red-400",
    badgeBg: "bg-red-500/10 text-red-400 border-red-500/20",
  },
  success: {
    bg: "bg-green-500/5",
    border: "border-green-500/20",
    icon: CheckCircle2,
    iconColor: "text-green-400",
    badgeBg: "bg-green-500/10 text-green-400 border-green-500/20",
  },
  shadow: {
    bg: "bg-purple-500/5",
    border: "border-purple-500/20",
    icon: Zap,
    iconColor: "text-purple-400",
    badgeBg: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  },
};

interface GridActionNoticeCardProps {
  notice: GridActionNotice;
  onCtaClick?: (notice: GridActionNotice) => void;
  onSecondaryCtaClick?: (notice: GridActionNotice) => void;
  onDismiss?: (id: string) => void;
  compact?: boolean;
}

export function GridActionNoticeCard({
  notice,
  onCtaClick,
  onSecondaryCtaClick,
  onDismiss,
  compact = false,
}: GridActionNoticeCardProps) {
  const [expanded, setExpanded] = useState(false);
  const styles = SEVERITY_STYLES[notice.severity];
  const Icon = styles.icon;

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${styles.bg} ${styles.border}`}>
      <div className="flex items-start gap-2">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${styles.iconColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate">{notice.title}</span>
            {!compact && (
              <Badge variant="outline" className={`text-[10px] ${styles.badgeBg}`}>
                {notice.severity}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{notice.shortText}</p>

          {!compact && (
            <button
              className="mt-1 text-xs text-blue-400 hover:underline flex items-center gap-0.5"
              onClick={() => setExpanded(true)}
            >
              Ver explicación <ChevronRight className="h-3 w-3" />
            </button>
          )}

          {(onCtaClick || onSecondaryCtaClick) && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {notice.ctaLabel && onCtaClick && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  onClick={() => onCtaClick(notice)}
                >
                  {notice.ctaLabel}
                </Button>
              )}
              {notice.secondaryCtaLabel && onSecondaryCtaClick && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => onSecondaryCtaClick(notice)}
                >
                  {notice.secondaryCtaLabel}
                </Button>
              )}
            </div>
          )}
        </div>
        {onDismiss && (
          <button
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            onClick={() => onDismiss(notice.id)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Icon className={`h-5 w-5 ${styles.iconColor}`} />
              {notice.title}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <p className="font-semibold text-foreground mb-1">¿Qué significa esto?</p>
              <p className="text-muted-foreground">{notice.explanation}</p>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-1">Impacto</p>
              <p className="text-muted-foreground">{notice.impact}</p>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-1">Qué puedes hacer</p>
              <p className="text-muted-foreground">{notice.recommendedAction}</p>
            </div>
            <div className="rounded-md bg-muted/20 px-3 py-2 text-xs font-mono text-muted-foreground">
              <span className="font-semibold">Razón técnica: </span>{notice.technicalReason}
            </div>
          </div>
          <DialogFooter className="gap-2 flex-wrap">
            {notice.ctaLabel && onCtaClick && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { onCtaClick(notice); setExpanded(false); }}
              >
                {notice.ctaLabel}
              </Button>
            )}
            {notice.secondaryCtaLabel && onSecondaryCtaClick && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { onSecondaryCtaClick(notice); setExpanded(false); }}
              >
                {notice.secondaryCtaLabel}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface GridActionNoticesListProps {
  notices: GridActionNotice[];
  onCtaClick?: (notice: GridActionNotice) => void;
  onSecondaryCtaClick?: (notice: GridActionNotice) => void;
  onDismiss?: (id: string) => void;
  compact?: boolean;
  maxVisible?: number;
}

export function GridActionNoticesList({
  notices,
  onCtaClick,
  onSecondaryCtaClick,
  onDismiss,
  compact = false,
  maxVisible = 5,
}: GridActionNoticesListProps) {
  const [showAll, setShowAll] = useState(false);
  if (notices.length === 0) return null;

  const visible = showAll ? notices : notices.slice(0, maxVisible);
  const hidden = notices.length - maxVisible;

  return (
    <div className="space-y-2">
      {visible.map(n => (
        <GridActionNoticeCard
          key={n.id}
          notice={n}
          onCtaClick={onCtaClick}
          onSecondaryCtaClick={onSecondaryCtaClick}
          onDismiss={onDismiss}
          compact={compact}
        />
      ))}
      {!showAll && hidden > 0 && (
        <button
          className="text-xs text-muted-foreground hover:text-foreground underline"
          onClick={() => setShowAll(true)}
        >
          Mostrar {hidden} aviso{hidden > 1 ? "s" : ""} más
        </button>
      )}
    </div>
  );
}
