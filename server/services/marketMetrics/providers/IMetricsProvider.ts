// ============================================================
// IMetricsProvider.ts
// Interfaz que deben implementar todos los proveedores de métricas
// ============================================================

export interface RawMetricRecord {
  source: string;
  metric: string;
  asset: string | null;
  pair: string | null;
  value: number;
  tsProvider: Date | null;
  meta: Record<string, unknown>;
}

export interface ProviderFetchResult {
  records: RawMetricRecord[];
  error?: string;
  unavailable?: boolean;
}

export interface IMetricsProvider {
  readonly name: string;
  readonly enabled: boolean;
  fetch(): Promise<ProviderFetchResult>;
}
