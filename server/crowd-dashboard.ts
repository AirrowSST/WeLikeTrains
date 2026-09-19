import { getRailCrowding } from "./feeds";
import { listTransitStops } from "./network";
import {
  stationsForCrowdLine,
  type DashboardCrowdLine,
} from "../shared/crowd-dashboard";

export async function railCrowdDashboard(line: DashboardCrowdLine) {
  const [{ crowd, feeds }, stations] = await Promise.all([
    getRailCrowding([line]),
    Promise.resolve(stationsForCrowdLine(listTransitStops(), line)),
  ]);
  const stationCodes = new Set(stations.flatMap((station) => station.codes));
  return {
    line,
    stations,
    // CGL/CEL are requested separately by DataMall but canonicalise to their
    // parent public line in shared route data. Match the selected branch by
    // station identity so those legitimate readings are not discarded.
    readings: crowd.filter((reading) => stationCodes.has(reading.station)),
    feeds,
  };
}
