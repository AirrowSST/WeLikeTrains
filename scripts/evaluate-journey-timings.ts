import { readFileSync } from "node:fs";

/** Explicit local observations only. This command makes no network request. */
export function timingMetrics(
  rows: {
    predictedMinutes: number;
    actualMinutes: number;
    lowerMinutes: number;
    upperMinutes: number;
    catchable?: boolean;
  }[],
) {
  if (!rows.length)
    throw new Error(
      "No observations: real accuracy cannot be inferred from synthetic fixtures",
    );
  for (const r of rows)
    if (
      ![
        r.predictedMinutes,
        r.actualMinutes,
        r.lowerMinutes,
        r.upperMinutes,
      ].every((n) => Number.isFinite(n) && n >= 0) ||
      r.lowerMinutes > r.upperMinutes
    )
      throw new Error("Invalid timing observation");
  const errors = rows
    .map((r) => Math.abs(r.predictedMinutes - r.actualMinutes))
    .sort((a, b) => a - b);
  const known = rows.filter((r) => typeof r.catchable === "boolean");
  return {
    observations: rows.length,
    medianAbsoluteErrorMinutes:
      (errors[Math.floor((errors.length - 1) / 2)] +
        errors[Math.ceil((errors.length - 1) / 2)]) /
      2,
    p90AbsoluteErrorMinutes: errors[Math.ceil(errors.length * 0.9) - 1],
    intervalCoverage:
      rows.filter(
        (r) =>
          r.actualMinutes >= r.lowerMinutes &&
          r.actualMinutes <= r.upperMinutes,
      ).length / rows.length,
    catchabilitySample: known.length,
    catchableFraction: known.length
      ? known.filter((r) => r.catchable).length / known.length
      : null,
  };
}
if (
  process.argv[1]
    ?.replaceAll("\\", "/")
    .endsWith("/evaluate-journey-timings.ts")
) {
  const path = process.argv[2];
  if (!path)
    throw new Error(
      "Usage: npm run evaluate:timings -- .local/consented-observations.json",
    );
  const input = JSON.parse(readFileSync(path, "utf8"));
  if (
    input.consent !== true ||
    input.synthetic !== false ||
    !Array.isArray(input.observations)
  )
    throw new Error("Explicit consent and real observations are required");
  console.log(
    JSON.stringify(
      {
        method:
          "Absolute duration error and observed interval coverage; uncalibrated prototype",
        ...timingMetrics(input.observations),
      },
      null,
      2,
    ),
  );
}
