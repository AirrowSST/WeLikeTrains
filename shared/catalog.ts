import type { Place, Profile, Scenario } from "./types";
export const places: Place[] = [
  {
    id: "tampines-home",
    name: "Tampines Central",
    subtitle: "Our Tampines Hub · 1 Tampines Walk",
    lat: 1.35285,
    lon: 103.9405,
  },
  {
    id: "raffles-work",
    name: "Raffles Place",
    subtitle: "One Raffles Place · Office",
    lat: 1.28428,
    lon: 103.85112,
  },
  {
    id: "punggol-home",
    name: "Punggol",
    subtitle: "Waterway Point · 83 Punggol Central",
    lat: 1.4066,
    lon: 103.9021,
  },
  {
    id: "one-north",
    name: "one-north",
    subtitle: "Fusionopolis · 1 Fusionopolis Way",
    lat: 1.2993,
    lon: 103.7878,
  },
  {
    id: "bedok-home",
    name: "Bedok Mall",
    subtitle: "311 New Upper Changi Road",
    lat: 1.324,
    lon: 103.9298,
  },
  {
    id: "sgh",
    name: "Singapore General Hospital",
    subtitle: "Outram Road · Block 3",
    lat: 1.2794,
    lon: 103.8354,
  },
  {
    id: "bugis",
    name: "Bugis",
    subtitle: "Bugis Junction · 200 Victoria Street",
    lat: 1.2999,
    lon: 103.8553,
  },
  {
    id: "city-hall",
    name: "City Hall",
    subtitle: "Raffles City · 252 North Bridge Road",
    lat: 1.294,
    lon: 103.8532,
  },
  {
    id: "changi",
    name: "Changi Airport",
    subtitle: "Jewel · 78 Airport Boulevard",
    lat: 1.3602,
    lon: 103.9898,
  },
  {
    id: "orchard",
    name: "Orchard",
    subtitle: "ION Orchard · 2 Orchard Turn",
    lat: 1.3041,
    lon: 103.8319,
  },
];
export const profiles: Profile[] = [
  {
    id: "rachel",
    name: "Rachel",
    label: "The everyday commuter",
    description:
      "A familiar journey. An 08:45 meeting. Only interrupt me when it matters.",
    origin: "tampines-home",
    destination: "raffles-work",
    departure: "07:40",
    arriveBy: "08:45",
    preferences: {
      stepFree: false,
      sheltered: true,
      avoidCrowds: false,
      cycling: false,
      walkingSpeed: 75,
      maxWalk: 1800,
      alertThreshold: 10,
    },
  },
  {
    id: "arjun",
    name: "Arjun",
    label: "The flexible explorer",
    description:
      "A little less rush. Room to breathe. Happy to cycle or leave a little later.",
    origin: "punggol-home",
    destination: "one-north",
    departure: "08:15",
    arriveBy: "09:45",
    preferences: {
      stepFree: false,
      sheltered: true,
      avoidCrowds: true,
      cycling: true,
      walkingSpeed: 80,
      maxWalk: 2200,
      alertThreshold: 15,
    },
  },
  {
    id: "lim",
    name: "Mdm Lim",
    label: "Every step considered",
    description:
      "My hospital visit, planned ahead. Fewer steps, working lifts and time to spare.",
    origin: "bedok-home",
    destination: "sgh",
    departure: "09:00",
    arriveBy: "10:30",
    preferences: {
      stepFree: true,
      sheltered: true,
      avoidCrowds: true,
      cycling: false,
      walkingSpeed: 40,
      maxWalk: 1200,
      alertThreshold: 5,
    },
  },
];
export const scenarios: { id: Scenario; label: string; description: string }[] =
  [
    {
      id: "normal",
      label: "A regular morning",
      description: "Normal service and typical weekday crowds",
    },
    {
      id: "disruption",
      label: "EWL disruption",
      description: "Simulated signalling fault between Paya Lebar and Bugis",
    },
    {
      id: "rain",
      label: "Heavy rain",
      description: "Simulated thunderstorms with slower, exposed walks",
    },
    {
      id: "crowded",
      label: "Crowded platforms",
      description: "Simulated high EWL crowd forecast",
    },
    {
      id: "maintenance",
      label: "Lift maintenance",
      description: "Simulated Outram Park lift closure, announced a day ahead",
    },
    {
      id: "closure",
      label: "Planned early closure",
      description: "Simulated EWL works affecting the selected travel window",
    },
  ];
export const lineColors: Record<string, string> = {
  EWL: "#009b64",
  DTL: "#176bc3",
  NEL: "#9b47b9",
  NSL: "#d8494f",
  CCL: "#d99216",
  TEL: "#996b4e",
  SLRT: "#70816b",
  PLRT: "#70816b",
  BPL: "#70816b",
  bus: "#397567",
  walk: "#75827c",
  cycle: "#27989a",
};
export const canonicalLine = (value: string) =>
  ({
    SKLRT: "SLRT",
    PGLRT: "PLRT",
    BPLRT: "BPL",
    STL: "SLRT",
    PTL: "PLRT",
    CEL: "CCL",
    CGL: "EWL",
    EW: "EWL",
    DT: "DTL",
    NE: "NEL",
    NS: "NSL",
    CC: "CCL",
    TE: "TEL",
    PE: "PLRT",
    PW: "PLRT",
    SE: "SLRT",
    SW: "SLRT",
    BP: "BPL",
  })[value.toUpperCase()] ?? value.toUpperCase();
export const crowdValue = (value: unknown): import("./types").Crowd =>
  (({
    l: "low",
    m: "moderate",
    h: "high",
    SEA: "low",
    SDA: "moderate",
    LSD: "high",
  })[String(value)] as import("./types").Crowd) ?? "unknown";
export const sgTime = (date: string | Date) =>
  new Intl.DateTimeFormat("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
  }).format(new Date(date));
export function nextDeparture(time: string) {
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  let d = new Date(`${day}T${time}:00+08:00`);
  if (d.getTime() < now.getTime() - 60000) d = new Date(d.getTime() + 86400000);
  return d.toISOString();
}
