import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/layouts/AppShell";
import { WorldCard } from "@/components/home/WorldCard";
import { Link } from "wouter";
import { TrendingUp, BarChart3, FileText, Settings, Monitor, Wallet, Bell } from "lucide-react";

interface DashboardData {
  exchangeConnected?: boolean;
  tradingExchange?: string;
  botActive?: boolean;
  activePairs?: string[];
}

interface IdcaSummary {
  activeCyclesCount?: number;
  totalCapitalInvested?: string | number;
  totalUnrealizedPnlUsd?: string | number;
}

export default function NexaHome() {
  const { data: dashboard } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard");
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 30000,
  });

  const { data: idcaSummary } = useQuery<IdcaSummary>({
    queryKey: ["idca", "summary"],
    queryFn: async () => {
      const res = await fetch("/api/institutional-dca/summary");
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 30000,
  });

  const fmtUsd = (v: string | number | null | undefined) => {
    const n = parseFloat(String(v || "0"));
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const dcaStats = [
    { label: "Ciclos activos", value: String(idcaSummary?.activeCyclesCount ?? "—") },
    { label: "Capital invertido", value: idcaSummary?.totalCapitalInvested ? fmtUsd(idcaSummary.totalCapitalInvested) : "—" },
    { label: "PnL no realizado", value: idcaSummary?.totalUnrealizedPnlUsd ? fmtUsd(idcaSummary.totalUnrealizedPnlUsd) : "—" },
  ];

  const tradingStats = [
    { label: "Bot", value: dashboard?.botActive ? "Activo" : "Inactivo" },
    { label: "Pares", value: String(dashboard?.activePairs?.length ?? "—") },
    { label: "Exchange", value: dashboard?.tradingExchange?.toUpperCase() ?? "—" },
  ];

  return (
    <AppShell>
      <div className="max-w-[1200px] mx-auto px-4 py-6 sm:py-10 space-y-8">
        {/* Title */}
        <div className="text-center space-y-1">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground">
            NEXA Crypto Suite
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Plataforma modular de gestión crypto
          </p>
        </div>

        {/* 3 Main Worlds */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          <WorldCard
            title="DCA Inteligente"
            subtitle="IDCA · Gestión avanzada por ciclos"
            description="Estrategia DCA institucional con entradas inteligentes, trailing buy, safety orders y gestión automática de ciclos."
            href="/dca"
            icon={<TrendingUp className="h-5 w-5 text-blue-400" />}
            accentColor="bg-blue-500/10"
            stats={dcaStats}
          />

          <WorldCard
            title="Trading Activo"
            subtitle="SPOT · Señales, estrategias y órdenes"
            description="Bot de trading por señales con Smart Guard, time-stop, gestión de riesgo y filtro AI opcional."
            href="/trading"
            icon={<BarChart3 className="h-5 w-5 text-emerald-400" />}
            accentColor="bg-emerald-500/10"
            stats={tradingStats}
          />

          <WorldCard
            title="Fiscal Crypto"
            subtitle="Fiscal · FIFO, AEAT, importaciones e informes"
            description="Módulo fiscal con método FIFO, cálculo de plusvalías, generación de informes y compatibilidad AEAT."
            href="/fiscal"
            icon={<FileText className="h-5 w-5 text-purple-400" />}
            accentColor="bg-purple-500/10"
          />
        </div>

        {/* System — secondary access */}
        <div className="border-t border-border/40 pt-6">
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-3">
            Sistema y configuración
          </p>
          <div className="flex flex-wrap gap-2">
            <SystemLink href="/settings" icon={<Settings className="h-3.5 w-3.5" />} label="Ajustes" />
            <SystemLink href="/monitor" icon={<Monitor className="h-3.5 w-3.5" />} label="Monitor" />
            <SystemLink href="/wallet" icon={<Wallet className="h-3.5 w-3.5" />} label="Cartera" />
            <SystemLink href="/notifications" icon={<Bell className="h-3.5 w-3.5" />} label="Telegram" />
            <SystemLink href="/integrations" icon={<Settings className="h-3.5 w-3.5" />} label="Integraciones" />
            <SystemLink href="/backups" icon={<Settings className="h-3.5 w-3.5" />} label="Backups" />
          </div>
        </div>

        {/* Legacy access */}
        <div className="text-center pt-4">
          <Link
            href="/dashboard-legacy"
            className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors underline"
          >
            Dashboard legacy
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function SystemLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border/50 bg-muted/20 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
    >
      {icon}
      {label}
    </Link>
  );
}
