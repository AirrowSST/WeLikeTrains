import type { Coord } from "../shared/types";

/** Local metre projection is sufficient for matching short Singapore segments. */
export function pointSegmentDistance(p: Coord, a: Coord, b: Coord) {
  const scale = Math.cos((p[0] * Math.PI) / 180);
  const ax = (a[1] - p[1]) * 111320 * scale,
    ay = (a[0] - p[0]) * 111320;
  const bx = (b[1] - p[1]) * 111320 * scale,
    by = (b[0] - p[0]) * 111320;
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(ax + t * dx, ay + t * dy);
}
export function nearbyLine(point: Coord, line: Coord[], tolerance: number) {
  return line.some(
    (p, i) => i > 0 && pointSegmentDistance(point, line[i - 1], p) <= tolerance,
  );
}
export function aligned(
  a: Coord,
  b: Coord,
  c: Coord,
  d: Coord,
  directed = false,
) {
  const x = b[1] - a[1],
    y = b[0] - a[0],
    u = d[1] - c[1],
    v = d[0] - c[0];
  const cosine = (x * u + y * v) / (Math.hypot(x, y) * Math.hypot(u, v) || 1);
  return (directed ? cosine : Math.abs(cosine)) > 0.85;
}

export class LineIndex {
  private grid = new Map<string, [Coord, Coord][]>();
  constructor(lines: Coord[][]) {
    for (const line of lines)
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1],
          b = line[i];
        for (
          let x = Math.floor(Math.min(a[0], b[0]) * 2000);
          x <= Math.floor(Math.max(a[0], b[0]) * 2000);
          x++
        )
          for (
            let y = Math.floor(Math.min(a[1], b[1]) * 2000);
            y <= Math.floor(Math.max(a[1], b[1]) * 2000);
            y++
          ) {
            const key = `${x},${y}`;
            this.grid.set(key, [...(this.grid.get(key) ?? []), [a, b]]);
          }
      }
  }
  matches(a: Coord, b: Coord, tolerance = 8) {
    const mid: Coord = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const x = Math.floor(mid[0] * 2000),
      y = Math.floor(mid[1] * 2000);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const [c, d] of this.grid.get(`${x + dx},${y + dy}`) ?? [])
          if (
            aligned(a, b, c, d) &&
            [a, mid, b].every((p) => pointSegmentDistance(p, c, d) <= tolerance)
          )
            return true;
    return false;
  }
}
