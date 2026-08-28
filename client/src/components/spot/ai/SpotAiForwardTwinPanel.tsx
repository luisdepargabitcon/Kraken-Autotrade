/**
 * SpotAiForwardTwinPanel — CENTRO DE INTELIGENCIA IA SPOT FORWARD TWIN.
 *
 * Professional console with 9 sub-tabs:
 * Resumen, Datos, Modelos, Observación, Predicciones, Validación, Seguridad, Auditoría, Ayuda.
 *
 * Advisory-only — no trading controls, no order placement, no strategy modification.
 *
 * R14: Separate LOADING / ERROR / SUCCESS states. No infinite "Cargando...".
 * R14: Status timeout 10s. Analytic tabs load independently.
 */

import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Brain, ShieldCheck, Lock, AlertCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SpotAiStatus } from "./spotAiTypes";
import { STATUS_LABELS, STATUS_COLORS } from "./spotAiTypes";
import { fetchJsonWithTimeout, TimeoutError } from "./fetchWithTimeout";
import { ResumenTab } from "./tabs/ResumenTab";
import { DatosTab } from "./tabs/DatosTab";
import { ModelosTab } from "./tabs/ModelosTab";
import { ObservacionTab } from "./tabs/ObservacionTab";
import { PrediccionesTab } from "./tabs/PrediccionesTab";
import { ValidacionTab } from "./tabs/ValidacionTab";
import { SeguridadTab } from "./tabs/SeguridadTab";
import { AuditoriaTab } from "./tabs/AuditoriaTab";
import { AyudaTab } from "./tabs/AyudaTab";
import { ActividadTab } from "./tabs/ActividadTab";

export function SpotAiForwardTwinPanel() {
  const { data: status, isLoading, isError, error, refetch } = useQuery<SpotAiStatus>({
    queryKey: ["/api/spot/ai/status"],
    queryFn: () => fetchJsonWithTimeout<SpotAiStatus>("/api/spot/ai/status", 10000),
    refetchInterval: 15000,
    retry: 1,
  });

  // R14: LOADING state — only while initial load is in progress.
  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin inline mr-2" />
          Cargando Centro de Inteligencia IA Forward Twin...
        </CardContent>
      </Card>
    );
  }

  // R14: ERROR state — show error panel with retry, NOT infinite loading.
  if (isError || !status) {
    const isTimeout = error instanceof TimeoutError;
    const message = isTimeout
      ? "Tiempo de espera agotado. El endpoint IA status no respondió a tiempo."
      : "No se pudo cargar el estado IA Forward Twin.";
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-3">
          <AlertCircle className="h-6 w-6 text-red-400 mx-auto" />
          <p className="text-sm text-red-400">{message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header — Title + Status + Advisory-only badges */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">CENTRO DE INTELIGENCIA — IA SPOT FORWARD TWIN</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={STATUS_COLORS[status.status] ?? STATUS_COLORS["COLLECTING"]}>
            {STATUS_LABELS[status.status] ?? status.status}
          </Badge>
          <Badge variant="outline" className="border-green-500/40 text-green-400">
            <ShieldCheck className="h-3 w-3 mr-1" />
            Solo observación
          </Badge>
          <Badge variant="outline" className="border-amber-500/40 text-amber-400">
            <Lock className="h-3 w-3 mr-1" />
            Sin control de trading
          </Badge>
        </div>
      </div>

      {/* Sub-tabs */}
      <Tabs defaultValue="resumen" className="w-full">
        <TabsList className="grid w-full grid-cols-3 md:grid-cols-10 h-auto">
          <TabsTrigger value="resumen" className="text-xs">Resumen</TabsTrigger>
          <TabsTrigger value="actividad" className="text-xs">Actividad</TabsTrigger>
          <TabsTrigger value="datos" className="text-xs">Datos</TabsTrigger>
          <TabsTrigger value="modelos" className="text-xs">Modelos</TabsTrigger>
          <TabsTrigger value="observacion" className="text-xs">Observación</TabsTrigger>
          <TabsTrigger value="predicciones" className="text-xs">Predicciones</TabsTrigger>
          <TabsTrigger value="validacion" className="text-xs">Validación</TabsTrigger>
          <TabsTrigger value="seguridad" className="text-xs">Seguridad</TabsTrigger>
          <TabsTrigger value="auditoria" className="text-xs">Auditoría</TabsTrigger>
          <TabsTrigger value="ayuda" className="text-xs">Ayuda</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="space-y-3">
          <ResumenTab status={status} />
        </TabsContent>
        <TabsContent value="actividad" className="space-y-3">
          <ActividadTab />
        </TabsContent>
        <TabsContent value="datos" className="space-y-3">
          <DatosTab />
        </TabsContent>
        <TabsContent value="modelos" className="space-y-3">
          <ModelosTab />
        </TabsContent>
        <TabsContent value="observacion" className="space-y-3">
          <ObservacionTab status={status} />
        </TabsContent>
        <TabsContent value="predicciones" className="space-y-3">
          <PrediccionesTab />
        </TabsContent>
        <TabsContent value="validacion" className="space-y-3">
          <ValidacionTab />
        </TabsContent>
        <TabsContent value="seguridad" className="space-y-3">
          <SeguridadTab status={status} />
        </TabsContent>
        <TabsContent value="auditoria" className="space-y-3">
          <AuditoriaTab />
        </TabsContent>
        <TabsContent value="ayuda" className="space-y-3">
          <AyudaTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
