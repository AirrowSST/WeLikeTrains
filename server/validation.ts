import { z } from "zod";
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
  })
  .refine(
    (r) =>
      r.origin.lat !== r.destination.lat || r.origin.lon !== r.destination.lon,
    { message: "Choose a different destination" },
  );
