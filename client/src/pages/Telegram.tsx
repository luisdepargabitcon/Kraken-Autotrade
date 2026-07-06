/**
 * Telegram.tsx — Página principal unificada de Telegram (FASE UX: reorganizada)
 *
 * 6 grupos lógicos:
 *  1. General   (Ajustes: kill switch, token, silent mode, severidad, dedupe, rate-limit, quiet hours)
 *  2. Tokens    (Multi-bot: añadir, editar, activar/inactivar, probar, eliminar)
 *  3. Canales   (CRUD completo de canales con token, modos, alertas)
 *  4. Alertas por modo (subpestañas: SPOT, SPOT Dry Run, IDCA, Grid/Hybrid, Smart Exit, Fiscalidad, Sistema, IA)
 *  5. Comandos  (catálogo + logs)
 *  6. Auditoría (enviados/bloqueados/fallidos + diagnóstico telegram:audit)
 */

import { useState } from "react";
import { Nav } from "@/components/dashboard/Nav";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Settings, Users, Terminal, TrendingUp, FlaskConical,
  CircleDollarSign, Brain, Bell, FileText, AlertTriangle,
  Sparkles, History, MessageSquare, Layers, Key
} from "lucide-react";

import TelegramSettingsTab from "@/components/telegram/TelegramSettingsTab";
import TelegramChannelsTab from "@/components/telegram/TelegramChannelsTab";
import TelegramTokensTab from "@/components/telegram/TelegramTokensTab";
import TelegramCommandsTab from "@/components/telegram/TelegramCommandsTab";
import TelegramSpotTab from "@/components/telegram/TelegramSpotTab";
import TelegramSpotDryRunTab from "@/components/telegram/TelegramSpotDryRunTab";
import TelegramIdcaTab from "@/components/telegram/TelegramIdcaTab";
import TelegramIdcaHybridTab from "@/components/telegram/TelegramIdcaHybridTab";
import TelegramSmartExitTab from "@/components/telegram/TelegramSmartExitTab";
import TelegramFiscoTab from "@/components/telegram/TelegramFiscoTab";
import TelegramSystemTab from "@/components/telegram/TelegramSystemTab";
import TelegramAiTab from "@/components/telegram/TelegramAiTab";
import TelegramAuditTab from "@/components/telegram/TelegramAuditTab";

const ALERT_MODE_SECTIONS = [
  { value: "spot", icon: TrendingUp, label: "SPOT Real", component: TelegramSpotTab },
  { value: "spot-dryrun", icon: FlaskConical, label: "SPOT Dry Run", component: TelegramSpotDryRunTab },
  { value: "idca", icon: CircleDollarSign, label: "IDCA", component: TelegramIdcaTab },
  { value: "idca-hybrid", icon: Brain, label: "IDCA Hybrid / Grid", component: TelegramIdcaHybridTab },
  { value: "smart-exit", icon: Bell, label: "Smart Exit", component: TelegramSmartExitTab },
  { value: "fisco", icon: FileText, label: "Fiscalidad", component: TelegramFiscoTab },
  { value: "system", icon: AlertTriangle, label: "Sistema", component: TelegramSystemTab },
  { value: "ai", icon: Sparkles, label: "IA / Shadow Mode", component: TelegramAiTab },
];

export default function Telegram() {
  const [activeGroup, setActiveGroup] = useState("general");
  const [activeAlertMode, setActiveAlertMode] = useState("spot");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <div className="flex-1 p-4 md:p-6 max-w-[1400px] mx-auto w-full space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <MessageSquare className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Telegram</h1>
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                Centro unificado de alertas, canales y comandos
              </p>
            </div>
          </div>
        </div>

        <Tabs value={activeGroup} onValueChange={setActiveGroup}>
          <TabsList className="grid grid-cols-6 gap-1 h-auto p-1">
            <TabsTrigger value="general" className="text-xs gap-1.5"><Settings className="h-3.5 w-3.5" /> General</TabsTrigger>
            <TabsTrigger value="tokens" className="text-xs gap-1.5"><Key className="h-3.5 w-3.5" /> Tokens</TabsTrigger>
            <TabsTrigger value="channels" className="text-xs gap-1.5"><Users className="h-3.5 w-3.5" /> Canales</TabsTrigger>
            <TabsTrigger value="alerts" className="text-xs gap-1.5"><Layers className="h-3.5 w-3.5" /> Alertas por modo</TabsTrigger>
            <TabsTrigger value="commands" className="text-xs gap-1.5"><Terminal className="h-3.5 w-3.5" /> Comandos</TabsTrigger>
            <TabsTrigger value="audit" className="text-xs gap-1.5"><History className="h-3.5 w-3.5" /> Auditoría</TabsTrigger>
          </TabsList>

          <TabsContent value="general"><TelegramSettingsTab /></TabsContent>
          <TabsContent value="tokens"><TelegramTokensTab /></TabsContent>
          <TabsContent value="channels"><TelegramChannelsTab /></TabsContent>

          <TabsContent value="alerts">
            <Tabs value={activeAlertMode} onValueChange={setActiveAlertMode}>
              <TabsList className="grid grid-cols-4 md:grid-cols-8 gap-1 h-auto p-1 mb-4">
                {ALERT_MODE_SECTIONS.map(({ value, icon: Icon, label }) => (
                  <TabsTrigger key={value} value={value} className="text-[10px] gap-1 h-8">
                    <Icon className="h-3 w-3" /> {label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {ALERT_MODE_SECTIONS.map(({ value, component: Component }) => (
                <TabsContent key={value} value={value}>
                  <Component />
                </TabsContent>
              ))}
            </Tabs>
          </TabsContent>

          <TabsContent value="commands"><TelegramCommandsTab /></TabsContent>
          <TabsContent value="audit"><TelegramAuditTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
