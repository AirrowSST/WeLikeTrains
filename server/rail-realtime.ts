import Gtfs from "gtfs-realtime-bindings";
import type { Notice, FeedStatus } from "../shared/types";
import { canonicalLine } from "../shared/catalog";
import { downloadLtaFile } from "./lta-download";
import { ltaConnection } from "./lta-client";

export interface TrainUpdate {
  tripId: string;
  startDate?: string;
  cancelled: boolean;
  delay?: number;
  stops: {
    code?: string;
    sequence?: number;
    skipped: boolean;
    noData: boolean;
    arrival?: { time?: number; delay?: number };
    departure?: { time?: number; delay?: number };
  }[];
}
export function decodeRealtime(bytes: Uint8Array, now = Date.now()) {
  const feed = Gtfs.transit_realtime.FeedMessage.toObject(
    Gtfs.transit_realtime.FeedMessage.decode(bytes),
    { longs: Number },
  );
  const timestamp = Number(feed.header?.timestamp) * 1000;
  if (
    !Number.isFinite(timestamp) ||
    timestamp > now + 60000 ||
    now - timestamp > 600000
  )
    throw new Error("Train realtime timestamp unavailable or stale");
  if (feed.header?.incrementality === 1)
    throw new Error("Differential train feed is unsupported");
  const updates: TrainUpdate[] = [];
  const notices: Notice[] = [];
  const text = (v: any) =>
    v?.translation?.find((t: any) => t.language === "en")?.text ??
    v?.translation?.[0]?.text ??
    "";
  for (const entity of feed.entity ?? []) {
    if (entity.isDeleted) continue;
    const u = entity.tripUpdate;
    if (
      u?.trip?.tripId &&
      (!u.timestamp || now - Number(u.timestamp) * 1000 <= 600000)
    ) {
      const relationship = u.trip.scheduleRelationship ?? 0;
      if (relationship !== 0 && relationship !== 3) continue;
      updates.push({
        tripId: u.trip.tripId,
        startDate: u.trip.startDate,
        cancelled: relationship === 3,
        delay: u.delay,
        stops: (u.stopTimeUpdate ?? []).map((s: any) => ({
          code: s.stopId?.match(/^[A-Z]{1,3}\d{1,3}[A-Z]?/)?.[0],
          sequence: s.stopSequence,
          skipped: s.scheduleRelationship === 1,
          noData: s.scheduleRelationship === 2,
          arrival: s.arrival,
          departure: s.departure,
        })),
      });
    }
    const alert = entity.alert;
    if (!alert) continue;
    for (const [i, selector] of (alert.informedEntity ?? []).entries()) {
      const line = selector.routeId
        ? canonicalLine(selector.routeId)
        : undefined;
      const station = selector.stopId?.match(/^[A-Z]{1,3}\d{1,3}[A-Z]?/)?.[0];
      // Trip-only or agency-wide selectors cannot safely become line closures.
      const scoped =
        !selector.trip &&
        (!!line || !!station) &&
        selector.directionId === undefined;
      for (const [j, period] of (alert.activePeriod?.length
        ? alert.activePeriod
        : [{}]
      ).entries()) {
        notices.push({
          id: `gtfs-alert-${entity.id}-${i}-${j}`,
          title: text(alert.headerText) || "Official train advisory",
          description: text(alert.descriptionText),
          line: scoped ? line : undefined,
          stations: scoped && station ? [station] : [],
          startsAt: new Date(
            (period.start ?? timestamp / 1000) * 1000,
          ).toISOString(),
          endsAt: period.end
            ? new Date(period.end * 1000).toISOString()
            : undefined,
          severity: alert.effect === 1 ? "critical" : "info",
          kind: scoped && alert.effect === 1 ? "planned" : "advisory",
          delayMinutes: 0,
          source: "LTA GTFS Realtime train service alerts",
        });
      }
    }
  }
  return { updates, notices, timestamp };
}

const cache = new Map<
  string,
  { at: number; result: ReturnType<typeof decodeRealtime> }
>();
const pending = new Map<string, Promise<ReturnType<typeof decodeRealtime>>>();
export async function trainRealtime(
  endpoint: "GTFSRealtimeTrainTripUpdates" | "GTFSRealTimeTrainServiceAlerts",
) {
  const connection = ltaConnection();
  const name = endpoint.includes("Trip")
    ? "Train realtime trip updates"
    : "Train realtime service alerts";
  const key = `${connection.base}/${endpoint}`;
  const prior = cache.get(key);
  try {
    let result =
      prior &&
      Date.now() - prior.at < 60000 &&
      Date.now() - prior.result.timestamp < 600000
        ? prior.result
        : undefined;
    if (!result) {
      let task = pending.get(key);
      if (!task) {
        task = downloadLtaFile(endpoint, 8_000_000).then((bytes) =>
          decodeRealtime(bytes),
        );
        pending.set(key, task);
      }
      try {
        result = await task;
        cache.set(key, { at: Date.now(), result });
      } finally {
        pending.delete(key);
      }
    }
    return {
      ...result,
      feed: {
        name,
        status: connection.simulated ? "demo" : "live",
        updatedAt: new Date(result.timestamp).toISOString(),
        detail:
          "Official train predictions; empty updates do not confirm normal service",
      } as FeedStatus,
    };
  } catch {
    return {
      updates: [] as TrainUpdate[],
      notices: [] as Notice[],
      feed: {
        name,
        status: "unavailable",
        detail:
          "Realtime unavailable; planned train timetable remains labelled",
      } as FeedStatus,
    };
  }
}

export function predictedStopTime(
  update: TrainUpdate | undefined,
  codes: string[],
  index: number,
  scheduled: number,
  departure: boolean,
  scheduledDepartures?: number[],
) {
  if (!update) return scheduled;
  let delay = update.delay ?? 0;
  for (let i = 0; i <= index; i++) {
    const stop = update.stops.find((s) => s.code === codes[i]);
    if (!stop) continue;
    if (stop.noData) {
      delay = 0;
      continue;
    }
    const event =
      i === index && !departure
        ? (stop.arrival ?? stop.departure)
        : (stop.departure ?? stop.arrival);
    if (event?.delay !== undefined) delay = event.delay;
    if (event?.time !== undefined && scheduledDepartures?.[i] !== undefined)
      delay = (Number(event.time) * 1000 - scheduledDepartures[i]) / 1000;
    if (i === index && event?.time !== undefined)
      return Number(event.time) * 1000;
  }
  return scheduled + delay * 1000;
}
