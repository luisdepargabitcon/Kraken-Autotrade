import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface WorldCardProps {
  title: string;
  subtitle: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  stats?: { label: string; value: string }[];
  accentColor: string;
  badgeLabel?: string;
}

export function WorldCard({
  title,
  subtitle,
  description,
  href,
  icon,
  stats,
  accentColor,
  badgeLabel,
}: WorldCardProps) {
  return (
    <Link href={href} className="block group">
      <Card className={cn(
        "border-border/50 hover:border-border transition-all duration-200",
        "hover:shadow-lg hover:shadow-black/20 cursor-pointer",
        "h-full"
      )}>
        <CardContent className="p-5 sm:p-6 flex flex-col h-full">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className={cn("p-2.5 rounded-lg", accentColor)}>
                {icon}
              </div>
              <div>
                <h3 className="font-semibold text-sm sm:text-base text-foreground">
                  {title}
                </h3>
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {subtitle}
                </p>
              </div>
            </div>
            {badgeLabel && (
              <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                {badgeLabel}
              </Badge>
            )}
          </div>

          {/* Description */}
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            {description}
          </p>

          {/* Stats */}
          {stats && stats.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-4 mt-auto">
              {stats.map((stat) => (
                <div key={stat.label} className="bg-muted/30 rounded px-2 py-1.5">
                  <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                  <p className="text-xs font-mono font-medium text-foreground">{stat.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* CTA */}
          <div className="flex items-center justify-end mt-auto pt-2">
            <span className="text-xs text-primary group-hover:underline flex items-center gap-1">
              Entrar
              <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
