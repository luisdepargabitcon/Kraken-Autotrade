/**
 * IdcaExchangeFeePresets — Fee presets per exchange for import position calculations.
 * Used by both backend (validation/snapshot) and shared with frontend via API.
 */

export interface ExchangeFeePreset {
  key: string;
  label: string;
  makerFeePct: number | null;
  takerFeePct: number | null;
  defaultFeePct: number;
  defaultFeeMode: "taker" | "maker" | "custom";
  useConfigurableDefault: boolean;
  description: string;
}

export const EXCHANGE_FEE_PRESETS: Record<string, ExchangeFeePreset> = {
  revolut_x: {
    key: "revolut_x",
    label: "Revolut X",
    makerFeePct: 0.0,
    takerFeePct: 0.09,
    defaultFeePct: 0.09,
    defaultFeeMode: "taker",
    useConfigurableDefault: false,
    description: "Revolut X: maker 0%, taker 0.09%",
  },
  kraken: {
    key: "kraken",
    label: "Kraken",
    makerFeePct: null,
    takerFeePct: null,
    defaultFeePct: 0.25,
    defaultFeeMode: "custom",
    useConfigurableDefault: true,
    description: "Kraken: fee variable según volumen/producto. Editable.",
  },
  other: {
    key: "other",
    label: "Otro",
    makerFeePct: null,
    takerFeePct: null,
    defaultFeePct: 0.10,
    defaultFeeMode: "custom",
    useConfigurableDefault: true,
    description: "Exchange personalizado. Fee estimada editable.",
  },
};

export const EXCHANGE_KEYS = Object.keys(EXCHANGE_FEE_PRESETS);
export const DEFAULT_EXCHANGE = "revolut_x";

export function getExchangeFeePreset(exchangeKey: string): ExchangeFeePreset {
  return EXCHANGE_FEE_PRESETS[exchangeKey] || EXCHANGE_FEE_PRESETS.other;
}

export function computeEstimatedImportFee(
  capitalUsedUsd: number,
  feePct: number
): number {
  return Math.round((capitalUsedUsd * feePct / 100) * 100) / 100;
}
