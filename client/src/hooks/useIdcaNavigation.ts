/**
 * Hook de navegación IDCA - Navegar desde parámetros del ciclo a su configuración
 * FASE UX IDCA: Hacer clicables los parámetros del ciclo activo
 */

import { useCallback } from "react";

export type IdcaConfigTarget =
  | "entry-patience"
  | "entry-rebound"
  | "entry-quality"
  | "entry-size"
  | "safety-ladder"
  | "next-buy"
  | "take-profit"
  | "dynamic-tp"
  | "break-even"
  | "trailing-activation"
  | "trailing-margin"
  | "capital"
  | "cooldown"
  | "execution-slippage"
  | "vwap-anchor"
  | "advanced";

export interface NavigateResult {
  mainTab: "adaptativo" | "config" | "telegram" | "eventos";
  adaptiveTab?: "entradas" | "salidas" | "ejecucion" | "avanzado";
  sectionId: string;
  pair?: string;
}

const TARGET_MAP: Record<IdcaConfigTarget, NavigateResult> = {
  // Entradas
  "entry-patience": {
    mainTab: "adaptativo",
    adaptiveTab: "entradas",
    sectionId: "idca-config-entry-patience",
  },
  "entry-rebound": {
    mainTab: "adaptativo",
    adaptiveTab: "entradas",
    sectionId: "idca-config-entry-rebound",
  },
  "entry-quality": {
    mainTab: "adaptativo",
    adaptiveTab: "entradas",
    sectionId: "idca-config-entry-quality",
  },
  "entry-size": {
    mainTab: "adaptativo",
    adaptiveTab: "entradas",
    sectionId: "idca-config-entry-size",
  },
  "safety-ladder": {
    mainTab: "adaptativo",
    adaptiveTab: "entradas",
    sectionId: "idca-config-safety-ladder",
  },
  "next-buy": {
    mainTab: "adaptativo",
    adaptiveTab: "entradas",
    sectionId: "idca-config-next-buy",
  },

  // Salidas
  "take-profit": {
    mainTab: "adaptativo",
    adaptiveTab: "salidas",
    sectionId: "idca-config-take-profit",
  },
  "dynamic-tp": {
    mainTab: "adaptativo",
    adaptiveTab: "salidas",
    sectionId: "idca-config-dynamic-tp",
  },
  "break-even": {
    mainTab: "adaptativo",
    adaptiveTab: "salidas",
    sectionId: "idca-config-break-even",
  },
  "trailing-activation": {
    mainTab: "adaptativo",
    adaptiveTab: "salidas",
    sectionId: "idca-config-trailing-activation",
  },
  "trailing-margin": {
    mainTab: "adaptativo",
    adaptiveTab: "salidas",
    sectionId: "idca-config-trailing-margin",
  },

  // Ejecución
  "execution-slippage": {
    mainTab: "adaptativo",
    adaptiveTab: "ejecucion",
    sectionId: "idca-config-execution-slippage",
  },
  "capital": {
    mainTab: "adaptativo",
    adaptiveTab: "ejecucion",
    sectionId: "idca-config-capital",
  },

  // Avanzado
  "cooldown": {
    mainTab: "adaptativo",
    adaptiveTab: "avanzado",
    sectionId: "idca-config-cooldown",
  },
  "vwap-anchor": {
    mainTab: "adaptativo",
    adaptiveTab: "avanzado",
    sectionId: "idca-config-vwap-anchor",
  },
  "advanced": {
    mainTab: "adaptativo",
    adaptiveTab: "avanzado",
    sectionId: "idca-config-advanced",
  },
};

export interface UseIdcaNavigationOptions {
  setMainTab: (tab: string) => void;
  setAdaptiveTab?: (tab: string) => void;
  setSelectedPair?: (pair: string) => void;
}

export function useIdcaNavigation(options: UseIdcaNavigationOptions) {
  const { setMainTab, setAdaptiveTab, setSelectedPair } = options;

  const navigateToConfig = useCallback(
    (target: IdcaConfigTarget, pair?: string) => {
      const result = TARGET_MAP[target];
      if (!result) {
        console.warn(`[IDCA_UI_NAV] target_not_found target=${target}`);
        return;
      }

      // Cambiar pestaña principal
      setMainTab(result.mainTab);

      // Cambiar subpestaña adaptativa si aplica
      if (result.adaptiveTab && setAdaptiveTab) {
        setTimeout(() => {
          setAdaptiveTab(result.adaptiveTab!);
        }, 50);
      }

      // Seleccionar par si se proporciona
      if (pair && setSelectedPair) {
        setTimeout(() => {
          setSelectedPair(pair);
        }, 100);
      }

      // Hacer scroll y resaltar la sección
      setTimeout(() => {
        const element = document.getElementById(result.sectionId);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });

          // Añadir clase de resaltado
          element.classList.add("idca-config-highlight");

          // Mostrar toast opcional
          const targetLabels: Record<IdcaConfigTarget, string> = {
            "entry-patience": "Paciencia de entrada",
            "entry-rebound": "Rebote mínimo",
            "entry-quality": "Calidad de entrada",
            "entry-size": "Tamaño de entrada",
            "safety-ladder": "Ladder de compras",
            "next-buy": "Próxima compra",
            "take-profit": "Take Profit",
            "dynamic-tp": "TP Dinámico",
            "break-even": "Break-Even",
            "trailing-activation": "Activación Trailing",
            "trailing-margin": "Margen Trailing",
            "capital": "Capital",
            "cooldown": "Cooldown",
            "execution-slippage": "Slippage",
            "vwap-anchor": "Ancla VWAP",
            "advanced": "Avanzado",
          };

          // Remover clase después de 3 segundos
          setTimeout(() => {
            element.classList.remove("idca-config-highlight");
          }, 3000);
        } else {
          console.warn(
            `[IDCA_UI_NAV] section_not_found target=${target} sectionId=${result.sectionId}`
          );
        }
      }, 200);
    },
    [setMainTab, setAdaptiveTab, setSelectedPair]
  );

  return { navigateToConfig, TARGET_MAP };
}

// Helper para crear URLs con hash de navegación
export function buildIdcaNavHash(
  target: IdcaConfigTarget,
  pair?: string
): string {
  const result = TARGET_MAP[target];
  if (!result) return "";

  const parts = [result.mainTab, result.adaptiveTab, result.sectionId];
  if (pair) parts.push(pair.replace("/", "-"));

  return `#config:${parts.join(":")}`;
}

// Parser para leer hash de URL
export function parseIdcaNavHash(hash: string): {
  target?: IdcaConfigTarget;
  pair?: string;
} | null {
  if (!hash.startsWith("#config:")) return null;

  const parts = hash.replace("#config:", "").split(":");
  const [mainTab, adaptiveTab, sectionId, pairPart] = parts;

  // Buscar target inverso
  for (const [target, result] of Object.entries(TARGET_MAP)) {
    if (
      result.mainTab === mainTab &&
      result.adaptiveTab === adaptiveTab &&
      result.sectionId === sectionId
    ) {
      return {
        target: target as IdcaConfigTarget,
        pair: pairPart ? pairPart.replace("-", "/") : undefined,
      };
    }
  }

  return null;
}
