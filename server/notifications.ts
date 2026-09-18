import { Firestore, Timestamp } from "@google-cloud/firestore";
import webpush from "web-push";
import { createHash } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import type { Request } from "express";
import { meetsDelayAlertThreshold } from "../shared/alerts";
import type { PlanRequest } from "../shared/types";
import { planJourney, noticeActive, segmentAffected } from "./planner";
let database: Firestore | undefined;
const db = () => (database ??= new Firestore());
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function pushConfigured() {
  return (
    process.env.FIRESTORE_ENABLED === "true" &&
    !!process.env.VAPID_PUBLIC_KEY &&
    !!process.env.VAPID_PRIVATE_KEY
  );
}
export async function saveRoutine(
  token: string,
  request: PlanRequest,
  subscription: webpush.PushSubscription,
  timeSensitive: string,
) {
  if (!pushConfigured())
    throw new Error("Background reminders are not configured on this server.");
  await db()
    .collection("routines")
    .doc(hash(token))
    .set({
      request,
      subscription,
      timeSensitive,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 30 * 86400000),
      lastFingerprint: "",
      lastSent: 0,
    });
}
export async function deleteRoutine(token: string) {
  if (process.env.FIRESTORE_ENABLED === "true")
    await db().collection("routines").doc(hash(token)).delete();
}
export async function schedulerAuthorized(req: Request) {
  const auth = req.headers.authorization;
  if (
    !auth?.startsWith("Bearer ") ||
    !process.env.SCHEDULER_AUDIENCE ||
    !process.env.SCHEDULER_SERVICE_ACCOUNT
  )
    return false;
  try {
    const ticket = await new OAuth2Client().verifyIdToken({
      idToken: auth.slice(7),
      audience: process.env.SCHEDULER_AUDIENCE,
    });
    const payload = ticket.getPayload();
    return (
      payload?.email === process.env.SCHEDULER_SERVICE_ACCOUNT &&
      payload.email_verified === true
    );
  } catch {
    return false;
  }
}
export async function sendReminders() {
  if (!pushConfigured())
    return { processed: 0, sent: 0, reason: "Push is not configured" };
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  const routines = await db()
    .collection("routines")
    .where("expiresAt", ">", Timestamp.now())
    .limit(100)
    .get();
  let sent = 0;
  for (const doc of routines.docs) {
    const item = doc.data();
    const saved = item.request as PlanRequest;
    const original = new Date(saved.departure);
    const sg = new Date(Date.now() + 8 * 3600000);
    const hour = (original.getUTCHours() + 8) % 24;
    const day = `${sg.getUTCFullYear()}-${String(sg.getUTCMonth() + 1).padStart(2, "0")}-${String(sg.getUTCDate()).padStart(2, "0")}`;
    let departure = new Date(
      `${day}T${String(hour).padStart(2, "0")}:${String(original.getUTCMinutes()).padStart(2, "0")}:00+08:00`,
    );
    if (departure.getTime() < Date.now())
      departure = new Date(departure.getTime() + 86400000);
    const until = (departure.getTime() - Date.now()) / 60000;
    const beforeDeparture = until <= 45;
    const dayBefore = until >= 12 * 60 && until <= 26 * 60;
    if (!beforeDeparture && !dayBefore) continue;
    if (Date.now() - (item.lastSent ?? 0) < 30 * 60000) continue;
    try {
      const delta = departure.getTime() - original.getTime();
      const request = {
        ...saved,
        departure: departure.toISOString(),
        arriveBy: saved.arriveBy
          ? new Date(Date.parse(saved.arriveBy) + delta).toISOString()
          : undefined,
      };
      const plan = await planJourney(request);
      const disruptionDelay = Math.max(
        0,
        plan.original.duration - plan.original.baselineDuration,
      );
      const planned = plan.conditions.notices.filter(
        (n) =>
          (n.kind === "planned" || n.kind === "lift") &&
          noticeActive(n, request.departure) &&
          plan.original.segments.some((s) => segmentAffected(n, s)),
      );
      const delayThresholdMet = meetsDelayAlertThreshold(
        disruptionDelay,
        saved.preferences.alertThreshold,
      );
      const timeSensitiveDelay = !!item.timeSensitive && delayThresholdMet;
      const delayBody = timeSensitiveDelay
        ? `Your ${item.timeSensitive} common route is delayed by ${disruptionDelay} min. `
        : "";
      const matters =
        (beforeDeparture &&
          (delayThresholdMet ||
            plan.original.blocked ||
            plan.recommended.blocked)) ||
        (dayBefore && planned.length > 0);
      if (!matters) continue;
      const fingerprint = hash(
        `${departure.toISOString().slice(0, 10)}:${plan.recommended.id}:${planned.map((n) => n.id).join(",")}:${plan.original.duration}`,
      );
      if (item.lastFingerprint === fingerprint) continue;
      await webpush.sendNotification(
        item.subscription,
        JSON.stringify({
          title: dayBefore
            ? "A heads-up for tomorrow"
            : timeSensitiveDelay
              ? "Leave earlier or change route"
              : "Your commute needs a small change",
          body: `${saved.dataMode === "demo" ? "DEMO: " : ""}${delayBody}${plan.advice}`,
          url: "/",
        }),
      );
      await doc.ref.update({
        lastFingerprint: fingerprint,
        lastSent: Date.now(),
      });
      sent++;
    } catch (error: any) {
      if (error?.statusCode === 410 || error?.statusCode === 404)
        await doc.ref.delete();
    }
  }
  return { processed: routines.size, sent };
}
