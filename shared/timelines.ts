import { profiles } from "./catalog";
import type { Persona } from "./types";

export const timelineIds = [
  "rachel-control",
  "rachel-eventful",
  "arjun-control",
  "arjun-eventful",
  "lim-control",
  "lim-eventful",
] as const;
export type TimelineId = (typeof timelineIds)[number];
export interface TimelineSelection {
  id: TimelineId;
  minute: number;
}
export const timelineDuration = 60;
export function timelineDefinition(id: TimelineId) {
  const persona = id.split("-")[0] as Persona;
  const profile = profiles.find((p) => p.id === persona)!;
  const eventful = id.endsWith("eventful");
  return {
    id,
    persona,
    profile,
    eventful,
    label: eventful ? "Eventful" : "Control · no events",
    start: `2026-09-21T${profile.departure}:00+08:00`,
    events: eventful
      ? [
          {
            minute: 0,
            label:
              persona === "lim"
                ? "Outram Park lift unavailable; heavy rain begins"
                : `${persona === "rachel" ? "EWL" : "NEL"} disruption and heavy rain begin`,
          },
          { minute: 25, label: "Rain clears; transport event continues" },
          { minute: 40, label: "Service and lifts restored" },
        ]
      : [{ minute: 0, label: "Clear weather and normal service throughout" }],
  };
}
export function timelineTime(selection: TimelineSelection) {
  return new Date(
    Date.parse(timelineDefinition(selection.id).start) +
      selection.minute * 60000,
  ).toISOString();
}

// Authored API payloads shared by the HTTP simulator and isolated in-app demos.
// No wall clock, cache or mutable global scenario participates in playback.
export function timelineInputs(selection: TimelineSelection) {
  const definition = timelineDefinition(selection.id);
  const at = timelineTime(selection);
  const disrupted = definition.eventful && selection.minute < 40;
  const rain = definition.eventful && selection.minute < 25;
  const line = definition.persona === "arjun" ? "NEL" : "EWL";
  // DataMall disruption sectors are authored as endpoint pairs. The planner
  // expands these across the committed rail graph before matching/highlighting.
  const stations = line === "NEL" ? "NE12,NE17" : "EW2,EW14";
  const eventStart = new Date(Date.parse(definition.start)).toISOString();
  const eventEnd = new Date(
    Date.parse(definition.start) + 40 * 60000,
  ).toISOString();
  return {
    at,
    line,
    alerts: {
      value: {
        Status: disrupted ? 2 : 1,
        AffectedSegments:
          disrupted && definition.persona !== "lim"
            ? [{ Line: line, Stations: stations }]
            : [],
        Message:
          disrupted && definition.persona !== "lim"
            ? [
                {
                  Content: "SIMULATED service disruption",
                  CreatedDate: eventStart,
                },
              ]
            : [],
      },
    },
    maintenance: {
      value:
        disrupted && definition.persona === "lim"
          ? [
              {
                StationCode: "EW16",
                StationName: "Outram Park",
                StartDate: eventStart,
                EndDate: eventEnd,
                LiftDesc: "SIMULATED lift outage",
              },
            ]
          : [],
    },
    crowd: {
      value: stations.split(",").map((Station) => ({
        Station,
        CrowdLevel: disrupted ? "h" : "l",
        StartTime: at,
        EndTime: new Date(Date.parse(at) + 120 * 60000).toISOString(),
      })),
    },
    weather: {
      data: {
        items: [
          {
            valid_period: {
              start: at,
              end: new Date(Date.parse(at) + 120 * 60000).toISOString(),
            },
            forecasts: [
              {
                area: "Singapore",
                forecast: rain ? "Heavy Thundery Showers" : "Fair",
              },
            ],
          },
        ],
      },
    },
    bus(stop: string, services: string[]) {
      return {
        BusStopCode: stop,
        Services: services.map((ServiceNo) => {
          const offset = disrupted ? 6 : 3;
          const nextMinute =
            offset +
            Math.max(0, Math.ceil((selection.minute - offset) / 7)) * 7;
          const vehicle = (index: number) => ({
            EstimatedArrival: new Date(
              Date.parse(definition.start) + (nextMinute + index * 7) * 60000,
            ).toISOString(),
            Load: disrupted ? "LSD" : "SEA",
            Feature: "WAB",
            Type: "SD",
            Monitored: 1,
          });
          return {
            ServiceNo,
            NextBus: vehicle(0),
            NextBus2: vehicle(1),
            NextBus3: vehicle(2),
          };
        }),
      };
    },
  };
}
