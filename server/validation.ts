import { z } from "zod";
import {
  timelineIds,
  timelineTime,
  timelineDuration,
} from "../shared/timelines";
export const preferencesSchema = z.object({
  stepFree: z.boolean(),
  sheltered: z.boolean(),
  avoidCrowds: z.boolean(),
  cycling: z.boolean(),
  walkingSpeed: z.number().min(25).max(120),
  maxWalk: z.number().min(200).max(3500),
  alertThreshold: z.number().int().min(3).max(60),
});
export const placeSchema = z.object({
  id: z.string().max(200),
  name: z.string().min(1).max(200),
  subtitle: z.string().max(300),
  lat: z.number().min(1.2).max(1.48),
  lon: z.number().min(103.6).max(104.1),
});
export const planSchema = z
  .object({
    origin: placeSchema,
    destination: placeSchema,
    departure: z.string().datetime({ offset: true }),
    arriveBy: z.string().datetime({ offset: true }).optional(),
    preferences: preferencesSchema,
    scenario: z.enum([
      "normal",
      "disruption",
      "rain",
      "crowded",
      "maintenance",
      "closure",
    ]),
    dataMode: z.enum(["demo", "live"]),
    timeline: z
      .object({
        id: z.enum(timelineIds),
        minute: z.number().int().min(0).max(timelineDuration),
      })
      .optional(),
    demoWeather: z
      .object({
        kind: z.enum(["clear", "showers", "storm", "heat"]),
        rainfallMm: z.number().min(0).max(100),
        temperature: z.number().min(20).max(40),
      })
      .optional(),
  })
  .superRefine((request, context) => {
    if (
      request.timeline &&
      (request.dataMode !== "demo" ||
        request.demoWeather ||
        request.scenario !== "normal" ||
        Date.parse(request.departure) !==
          Date.parse(timelineTime(request.timeline)))
    ) {
      context.addIssue({
        code: "custom",
        path: ["timeline"],
        message:
          "Timelines require demo mode, matching simulated departure and no separate scenario or weather override",
      });
    }
    if (request.dataMode === "live" && request.demoWeather) {
      context.addIssue({
        code: "custom",
        path: ["demoWeather"],
        message: "Simulated weather is allowed only in demo mode",
      });
    }
  })
  .refine(
    (r) =>
      r.origin.lat !== r.destination.lat || r.origin.lon !== r.destination.lon,
    { message: "Choose a different destination" },
  );

const hardPreferencesSchema = preferencesSchema.partial();
export const savedCommuteSchema = z
  .object({
    id: z.string().min(1).max(240),
    label: z.string().min(1).max(100),
    request: planSchema,
    hardPreferences: hardPreferencesSchema,
    timeSensitive: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    inferred: z.boolean().optional(),
    savedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((commute, context) => {
    if (
      commute.request.dataMode !== "live" ||
      commute.request.scenario !== "normal" ||
      commute.request.timeline ||
      commute.request.demoWeather
    ) {
      context.addIssue({
        code: "custom",
        path: ["request"],
        message: "Account commutes must contain live, non-simulated data",
      });
    }
  });
export const accountStateSchema = z.object({
  preferences: preferencesSchema,
  hardPreferences: hardPreferencesSchema,
  commutes: z.array(savedCommuteSchema).max(10),
  largeText: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }),
});
