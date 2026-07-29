/**
 * AMA Dataset Manifest — Fase 2K
 *
 * Manifest per dataset: schemaHash, rowCount, timeRangeStart, timeRangeEnd.
 * Integrity validation.
 */

export interface DatasetManifest {
  datasetId: string;
  schemaHash: string;
  rowCount: number;
  timeRangeStart: string;
  timeRangeEnd: string;
  createdAt: string;
}

export function validateManifest(manifest: DatasetManifest): string[] {
  const errors: string[] = [];

  if (!manifest.datasetId) errors.push("MISSING_DATASET_ID");
  if (!manifest.schemaHash) errors.push("MISSING_SCHEMA_HASH");
  if (manifest.rowCount < 0) errors.push("NEGATIVE_ROW_COUNT");
  if (manifest.rowCount === 0) errors.push("ZERO_ROW_COUNT");

  const start = new Date(manifest.timeRangeStart).getTime();
  const end = new Date(manifest.timeRangeEnd).getTime();
  if (isNaN(start)) errors.push("INVALID_TIME_RANGE_START");
  if (isNaN(end)) errors.push("INVALID_TIME_RANGE_END");
  if (!isNaN(start) && !isNaN(end) && start > end) {
    errors.push("TIME_RANGE_START_AFTER_END");
  }

  return errors;
}

export function computeSchemaHash(schema: string): string {
  let hash = 0;
  for (let i = 0; i < schema.length; i++) {
    const char = schema.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `schema_${Math.abs(hash)}`;
}

export function isManifestCoherent(
  manifest: DatasetManifest,
  expectedRowCount: number,
  expectedSchemaHash: string,
): boolean {
  return (
    manifest.rowCount === expectedRowCount &&
    manifest.schemaHash === expectedSchemaHash
  );
}
