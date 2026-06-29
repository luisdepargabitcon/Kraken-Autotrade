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
  mainTab: "adaptive" | "config" | "telegram" | "eventos";
  adaptiveTab?: "entradas" | "salidas" | "ejecucion" | "avanzado";
  configSubTab?: "entrada" | "general" | "vwap" | "distancia" | "plus";
  sectionId: string;
  pair?: string;
}

const TARGET_MAP: Record<IdcaConfigTarget, NavigateResult> = {
  // Entradas - Config real está en ConfigTab → Entrada automática
  "entry-patience": {
    mainTab: "config",
    configSubTab: "entrada",
    sectionId: "idca-config-entry",
  },
  "entry-rebound": {
    mainTab: "config",
    configSubTab: "entrada",
    sectionId: "idca-config-entry",
  },
  "entry-quality": {
    mainTab: "config",
    configSubTab: "entrada",
    sectionId: "idca-config-entry",
  },
  "entry-size": {
    mainTab: "config",
    configSubTab: "entrada",
    sectionId: "idca-config-entry",
  },
  "safety-ladder": {
    mainTab: "adaptive",
    adaptiveTab: "entradas",
    sectionId: "idca-config-safety-ladder",
  },
  "next-buy": {
    mainTab: "adaptive",
    adaptiveTab: "entradas",
    sectionId: "idca-config-safety-ladder",
  },

  // Salidas - Config real está en ConfigTab → General (Cuándo vender)
  "take-profit": {
    mainTab: "adaptive",
    adaptiveTab: "salidas",
    sectionId: "idca-config-take-profit",
  },
  "dynamic-tp": {
    mainTab: "adaptive",
    adaptiveTab: "salidas",
    sectionId: "idca-config-take-profit",
  },
  "break-even": {
    mainTab: "config",
    configSubTab: "general",
    sectionId: "idca-config-break-even",
  },
  "trailing-activation": {
    mainTab: "config",
    configSubTab: "general",
    sectionId: "idca-config-trailing-activation",
  },
  "trailing-margin": {
    mainTab: "config",
    configSubTab: "general",
    sectionId: "idca-config-trailing-margin",
  },

  // Ejecución
  "execution-slippage": {
    mainTab: "adaptive",
    adaptiveTab: "ejecucion",
    sectionId: "idca-config-execution-slippage",
  },
  "capital": {
    mainTab: "config",
    configSubTab: "general",
    sectionId: "idca-config-capital",
  },

  // Avanzado
  "cooldown": {
    mainTab: "adaptive",
    adaptiveTab: "avanzado",
    sectionId: "idca-config-cooldown",
  },
  "vwap-anchor": {
    mainTab: "config",
    configSubTab: "vwap",
    sectionId: "idca-config-vwap-anchor",
  },
  "advanced": {
    mainTab: "adaptive",
    adaptiveTab: "avanzado",
    sectionId: "idca-config-advanced",
  },
};

export interface UseIdcaNavigationOptions {
  setMainTab: (tab: string) => void;
  setAdaptiveTab?: (tab: string) => void;
  setConfigSubTab?: (tab: "entrada" | "general" | "vwap" | "distancia" | "plus") => void;
  setSelectedPair?: (pair: string) => void;
}

export function useIdcaNavigation(options: UseIdcaNavigationOptions) {
  const { setMainTab, setAdaptiveTab, setConfigSubTab, setSelectedPair } = options;

  const navigateToConfig = useCallback(
    (target: IdcaConfigTarget, pair?: string) => {
      const result = TARGET_MAP[target];
      if (!result) {
        console.warn(`[IDCA_UI_NAV] target_not_found target=${target}`);
        return;
      }

      // Cambiar pestaña principal
      setMainTab(result.mainTab);

      // Cambiar subpestaña de ConfigTab si aplica
      if (result.configSubTab && setConfigSubTab) {
        setTimeout(() => {
          setConfigSubTab(result.configSubTab!);
        }, 0);
      }

      // Cambiar subpestaña adaptativa si aplica
      if (result.adaptiveTab && setAdaptiveTab) {
        setTimeout(() => {
          setAdaptiveTab(result.adaptiveTab!);
        }, 0);
      }

      // Seleccionar par si se proporciona
      if (pair && setSelectedPair) {
        setTimeout(() => {
          setSelectedPair(pair);
        }, 0);
      }

      // Hacer scroll y resaltar la sección con reintentos
      const scrollAndHighlight = (attempt = 0) => {
        const element = document.getElementById(result.sectionId);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          element.classList.add("idca-config-highlight");
          setTimeout(() => {
            element.classList.remove("idca-config-highlight");
          }, 2500);
        } else if (attempt < 8) {
          setTimeout(() => scrollAndHighlight(attempt + 1), 120);
        } else {
          console.warn(
            `[IDCA_UI_NAV] section_not_found target=${target} sectionId=${result.sectionId} pair=${pair}`
          );
        }
      };

      setTimeout(() => scrollAndHighlight(), 0);
    },
    [setMainTab, setAdaptiveTab, setConfigSubTab, setSelectedPair]
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
