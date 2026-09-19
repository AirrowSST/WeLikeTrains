import type { BusRouteRecord } from "./bus-network";

/** LTA prohibits releasing these rows before EffectiveDate, even for future trips. */
export function releasedPlannedRows(
  rows: Record<string, unknown>[],
  now: number,
) {
  return rows.filter((row) => {
    const raw = String(row.EffectiveDate ?? "");
    const normalized = raw
      .replace(/^(\d{4})(\d{2})(\d{2})T/, "$1-$2-$3T")
      .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const at = Date.parse(normalized);
    return Number.isFinite(at) && at <= now;
  });
}
export function replacePlannedDirections(
  current: BusRouteRecord[],
  planned: BusRouteRecord[],
) {
  const key = (r: BusRouteRecord) =>
    `${r.serviceNo}|${r.operator}|${r.direction}`;
  const groups = new Map<string, BusRouteRecord[]>();
  for (const row of planned)
    groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  for (const [id, rows] of groups) {
    rows.sort((a, b) => a.stopSequence - b.stopSequence);
    if (rows.length < 2 || rows.some((r, i) => r.stopSequence !== i + 1))
      groups.delete(id);
  }
  return [
    ...current.filter((r) => !groups.has(key(r))),
    ...[...groups.values()].flat(),
  ];
}
