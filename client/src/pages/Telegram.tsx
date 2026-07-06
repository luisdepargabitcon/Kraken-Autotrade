/**
 * Telegram.tsx — Página principal unificada de Telegram
 *
 * 12 subpestañas:
 *  1. Ajustes Telegram (global config, token, kill switch)
 *  2. Canales (telegram_chats management)
 *  3. Comandos (command definitions + logs)
 *  4. SPOT / Trading activo
 *  5. SPOT Dry Run
 *  6. IDCA
 *  7. IDCA Hybrid/Grid
 *  8. Smart Exit
 *  9. Fiscalidad
 * 10. Sistema / errores críticos
 * 11. IA / Shadow Mode / Autoafinación
 * 12. Auditoría / Historial
 */

import { useState } from "react";
import { Nav } from "@/components/dashboard/Nav";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Settings, Users, Terminal, TrendingUp, FlaskConical,
  CircleDollarSign, Brain, Bell, FileText, AlertTriangle,
  Sparkles, History, MessageSquare, Send, Power
} from "lucide-react";

import TelegramSettingsTab from "@/components/telegram/TelegramSettingsTab";
import TelegramChannelsTab from "@/components/telegram/TelegramChannelsTab";
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

export default function Telegram() {
  const [activeTab, setActiveTab] = useState("settings");

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

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-1 h-auto p-1">
            <TabsTrigger value="settings" className="text-xs gap-1"><Settings className="h-3 w-3" /> Ajustes</TabsTrigger>
            <TabsTrigger value="channels" className="text-xs gap-1"><Users className="h-3 w-3" /> Canales</TabsTrigger>
            <TabsTrigger value="commands" className="text-xs gap-1"><Terminal className="h-3 w-3" /> Comandos</TabsTrigger>
            <TabsTrigger value="spot" className="text-xs gap-1"><TrendingUp className="h-3 w-3" /> SPOT</TabsTrigger>
            <TabsTrigger value="spot-dryrun" className="text-xs gap-1"><FlaskConical className="h-3 w-3" /> Dry Run</TabsTrigger>
            <TabsTrigger value="idca" className="text-xs gap-1"><CircleDollarSign className="h-3 w-3" /> IDCA</TabsTrigger>
            <TabsTrigger value="idca-hybrid" className="text-xs gap-1"><Brain className="h-3 w-3" /> Hybrid</TabsTrigger>
            <TabsTrigger value="smart-exit" className="text-xs gap-1"><Bell className="h-3 w-3" /> Smart Exit</TabsTrigger>
            <TabsTrigger value="fisco" className="text-xs gap-1"><FileText className="h-3 w-3" /> FISCO</TabsTrigger>
            <TabsTrigger value="system" className="text-xs gap-1"><AlertTriangle className="h-3 w-3" /> Sistema</TabsTrigger>
            <TabsTrigger value="ai" className="text-xs gap-1"><Sparkles className="h-3 w-3" /> IA</TabsTrigger>
            <TabsTrigger value="audit" className="text-xs gap-1"><History className="h-3 w-3" /> Auditoría</TabsTrigger>
          </TabsList>

          <TabsContent value="settings"><TelegramSettingsTab /></TabsContent>
          <TabsContent value="channels"><TelegramChannelsTab /></TabsContent>
          <TabsContent value="commands"><TelegramCommandsTab /></TabsContent>
          <TabsContent value="spot"><TelegramSpotTab /></TabsContent>
          <TabsContent value="spot-dryrun"><TelegramSpotDryRunTab /></TabsContent>
          <TabsContent value="idca"><TelegramIdcaTab /></TabsContent>
          <TabsContent value="idca-hybrid"><TelegramIdcaHybridTab /></TabsContent>
          <TabsContent value="smart-exit"><TelegramSmartExitTab /></TabsContent>
          <TabsContent value="fisco"><TelegramFiscoTab /></TabsContent>
          <TabsContent value="system"><TelegramSystemTab /></TabsContent>
          <TabsContent value="ai"><TelegramAiTab /></TabsContent>
          <TabsContent value="audit"><TelegramAuditTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
