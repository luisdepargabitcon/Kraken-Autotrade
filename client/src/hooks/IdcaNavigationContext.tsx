/**
 * Contexto de navegación IDCA
 * Permite navegar desde cualquier componente hijo a la configuración
 */

import React, { createContext, useContext, useCallback } from "react";
import type { IdcaConfigTarget } from "./useIdcaNavigation";

interface IIdcaNavigationContext {
  navigateToConfig: (target: IdcaConfigTarget, pair?: string) => void;
}

const IhcaNavigationContext = createContext<IIdcaNavigationContext | null>(null);

export const IhcaNavigationProvider: React.FC<{
  children: React.ReactNode;
  navigateToConfig: (target: IdcaConfigTarget, pair?: string) => void;
}> = ({ children, navigateToConfig }) => {
  return (
    <IhcaNavigationContext.Provider value={{ navigateToConfig }}>
      {children}
    </IhcaNavigationContext.Provider>
  );
};

export function useIdcaNavigationContext() {
  const context = useContext(IhcaNavigationContext);
  if (!context) {
    throw new Error(
      "useIdcaNavigationContext must be used within IhcaNavigationProvider"
    );
  }
  return context;
}

export function useOptionalIdcaNavigation() {
  return useContext(IhcaNavigationContext);
}
