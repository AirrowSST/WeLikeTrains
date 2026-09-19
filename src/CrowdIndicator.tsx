import { CircleHelp, UserRound } from "lucide-react";
import type { Crowd } from "../shared/types";

export default function CrowdIndicator({ level }: { level: Crowd }) {
  const count = { low: 1, moderate: 2, high: 3, unknown: 0 }[level];
  const label = {
    low: "Low",
    moderate: "Moderate",
    high: "High",
    unknown: "Unavailable",
  }[level];
  return (
    <span
      className={`station-crowd-indicator ${level}`}
      role="img"
      aria-label={`${label} crowdedness`}
    >
      <span className="station-crowd-people" aria-hidden="true">
        {level === "unknown" ? (
          <CircleHelp size={24} />
        ) : (
          [1, 2, 3].map((n) => (
            <UserRound
              key={n}
              size={22}
              className={n <= count ? "filled" : "empty"}
            />
          ))
        )}
      </span>
      <strong aria-hidden="true">{label}</strong>
    </span>
  );
}
