import "dotenv/config";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import path from "node:path";
import { existsSync } from "node:fs";
import { planJourney } from "./planner";
import { getBusArrivals } from "./feeds";
import { listTransitStops } from "./network";
import { chat, searchPlaces, speech } from "./providers";
import { places, profiles, scenarios } from "../shared/catalog";
import { accountStateSchema, planSchema } from "./validation";
import {
  accountSession,
  accountsConfigured,
  clearAccountSession,
  deleteAccount,
  getAccount,
  saveAccount,
  setAccountSession,
  signInWithGoogle,
} from "./accounts";
import {
  deleteRoutine,
  pushConfigured,
  saveRoutine,
  schedulerAuthorized,
  sendReminders,
} from "./notifications";

export const app = express();
const skipTestRateLimit = () => process.env.DISABLE_RATE_LIMITS === "true";
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(compression());
app.use(
  helmet({
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    referrerPolicy: {
      policy:
        process.env.NODE_ENV === "production"
          ? "strict-origin-when-cross-origin"
          : "no-referrer-when-downgrade",
    },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://accounts.google.com/gsi/client"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://accounts.google.com/gsi/style",
        ],
        imgSrc: ["'self'", "data:", "blob:", "https://www.onemap.gov.sg"],
        connectSrc: ["'self'", "https://accounts.google.com/gsi/"],
        frameSrc: ["https://accounts.google.com/gsi/"],
        fontSrc: ["'self'"],
        mediaSrc: ["'self'", "blob:"],
        workerSrc: ["'self'"],
        upgradeInsecureRequests:
          process.env.NODE_ENV === "production" ? [] : null,
      },
    },
  }),
);
app.use(express.json({ limit: "48kb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 60000,
    limit: 90,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: skipTestRateLimit,
  }),
);
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const origin = req.headers.origin;
  if (origin) {
    const allowed = new Set([
      process.env.PUBLIC_URL,
      "http://localhost:5173",
      "http://localhost:8080",
    ]);
    if (
      !allowed.has(origin) &&
      origin !== `${req.protocol}://${req.get("host")}`
    ) {
      res.status(403).json({ error: "Request origin is not allowed" });
      return;
    }
  }
  next();
});
app.get("/api/health", (_req, res) =>
  res.json({ status: "ok", service: "Wayce", version: "1.0.0" }),
);
app.get("/api/config", (_req, res) =>
  res.json({
    places,
    profiles,
    scenarios,
    dataMode: process.env.DATA_MODE === "live" ? "live" : "demo",
    integrations: {
      lta: !!process.env.LTA_ACCOUNT_KEY,
      vertex:
        !!process.env.VERTEX_API_KEY ||
        !!process.env.K_SERVICE ||
        !!process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        process.env.ENABLE_VERTEX_LOCAL === "true",
      tts: process.env.ENABLE_CLOUD_TTS === "true",
      push: pushConfigured(),
      googleAccounts: accountsConfigured(),
    },
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    googleClientId: accountsConfigured() ? process.env.GOOGLE_CLIENT_ID : null,
  }),
);
app.get("/api/auth/session", async (req, res) => {
  const identity = accountSession(req);
  if (!accountsConfigured() || !identity) {
    res.json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, ...(await getAccount(identity)) });
});
app.post(
  "/api/auth/google",
  rateLimit({ windowMs: 60000, limit: 10, skip: skipTestRateLimit }),
  async (req, res) => {
    const body = z
      .object({
        credential: z.string().min(100).max(5000),
        guestState: accountStateSchema,
      })
      .parse(req.body);
    const result = await signInWithGoogle(body.credential, body.guestState);
    setAccountSession(res, result.identity);
    res.json({ authenticated: true, user: result.user, state: result.state });
  },
);
app.post("/api/auth/logout", (_req, res) => {
  clearAccountSession(res);
  res.json({ authenticated: false });
});
app.put("/api/account", async (req, res) => {
  const identity = accountSession(req);
  if (!identity) {
    res.status(401).json({ error: "Sign in before saving account data" });
    return;
  }
  res.json({ state: await saveAccount(identity, req.body) });
});
app.delete("/api/account", async (req, res) => {
  const identity = accountSession(req);
  if (!identity) {
    res.status(401).json({ error: "Sign in before deleting account data" });
    return;
  }
  await deleteAccount(identity);
  clearAccountSession(res);
  res.json({ deleted: true });
});
app.get("/api/places", async (req, res) =>
  res.json(await searchPlaces(z.string().min(1).max(100).parse(req.query.q))),
);
app.get("/api/transit-stops", (_req, res) => {
  res.set("Cache-Control", "public, max-age=86400");
  res.json(listTransitStops());
});
app.post("/api/plan", async (req, res) => {
  const request = planSchema.parse(req.body);
  res.json(await planJourney(request));
});
app.get("/api/buses/:stop", async (req, res) =>
  res.json(
    await getBusArrivals(
      z
        .string()
        .regex(/^\d{5}$/)
        .parse(req.params.stop),
    ),
  ),
);
app.post(
  "/api/chat",
  rateLimit({ windowMs: 60000, limit: 12, skip: skipTestRateLimit }),
  async (req, res) => {
    const body = z
      .object({
        message: z.string().min(1).max(1500),
        request: planSchema.optional(),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              text: z.string().min(1).max(1800),
            }),
          )
          .max(8)
          .default([]),
        cloudConsent: z.boolean().default(false),
      })
      .parse(req.body);
    // The UI explicitly asks for cloud-AI consent before sending commute context.
    if (!body.cloudConsent) {
      res.status(400).json({
        error:
          "Consent is required before sending this message to the companion.",
      });
      return;
    }
    const plan = body.request ? await planJourney(body.request) : undefined;
    res.json(await chat(body.message, plan, body.history));
  },
);
app.post(
  "/api/speech",
  rateLimit({ windowMs: 60000, limit: 12, skip: skipTestRateLimit }),
  async (req, res) => {
    const body = z
      .object({ text: z.string().min(1).max(1800) })
      .parse(req.body);
    const audio = await speech(body.text);
    if (!audio) {
      res
        .status(503)
        .json({ error: "Cloud speech is not configured. Use device speech." });
      return;
    }
    res.type("audio/mpeg").send(audio);
  },
);
const deviceToken = (req: express.Request) =>
  z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(req.headers["x-device-token"]);
app.post("/api/routine", async (req, res) => {
  const token = deviceToken(req);
  const body = z
    .object({
      request: planSchema,
      consent: z.literal(true),
      timeSensitive: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      subscription: z.object({
        endpoint: z
          .string()
          .url()
          .refine((v) => {
            const u = new URL(v);
            return (
              u.protocol === "https:" &&
              [
                "fcm.googleapis.com",
                "updates.push.services.mozilla.com",
                "web.push.apple.com",
                "wns2-par02p.notify.windows.com",
              ].some(
                (host) =>
                  u.hostname === host || u.hostname.endsWith("." + host),
              )
            );
          }, "Unsupported push provider"),
        expirationTime: z.number().nullable().optional(),
        keys: z.object({
          p256dh: z.string().max(200),
          auth: z.string().max(200),
        }),
      }),
    })
    .parse(req.body);
  await saveRoutine(token, body.request, body.subscription, body.timeSensitive);
  res.json({ saved: true, retentionDays: 30 });
});
app.delete("/api/routine", async (req, res) => {
  await deleteRoutine(deviceToken(req));
  res.json({ deleted: true });
});
app.post("/api/internal/reminders", async (req, res) => {
  if (!(await schedulerAuthorized(req))) {
    res
      .status(401)
      .json({ error: "Verified Cloud Scheduler identity required" });
    return;
  }
  res.json(await sendReminders());
});
const dist = path.resolve("dist");
if (existsSync(dist)) {
  app.use(
    express.static(dist, {
      maxAge: 3600000,
      setHeaders: (res, file) => {
        if (file.endsWith("sw.js") || file.endsWith("index.html"))
          res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(dist, "index.html")),
  );
}
app.use(
  (
    error: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: error.issues.map((i) => i.message).join("; ") });
      return;
    }
    res.status(503).json({
      error: error?.message?.startsWith("No usable route")
        ? error.message
        : "This service is temporarily unavailable. Your saved journey is still available offline.",
    });
  },
);
if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, "0.0.0.0", () =>
    console.log(`Wayce running on http://localhost:${port}`),
  );
}
