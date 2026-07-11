export function renderSafeGridText(value: unknown, fallback = "—"): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return fallback;
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return fallback;
}
