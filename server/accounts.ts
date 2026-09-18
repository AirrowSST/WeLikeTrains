import { Firestore, Timestamp } from "@google-cloud/firestore";
import { OAuth2Client } from "google-auth-library";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { AccountState, AccountUser, SavedCommute } from "../shared/types";
import { accountStateSchema } from "./validation";

const SESSION_COOKIE = "wayce_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
let database: Firestore | undefined;
const db = () => (database ??= new Firestore());
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const encode = (value: string) => Buffer.from(value).toString("base64url");
const sessionSecret = () => process.env.SESSION_SECRET ?? "";

interface SessionIdentity extends AccountUser {
  subject: string;
  expiresAt: number;
}

function commuteMap(commutes: SavedCommute[]) {
  return new Map(commutes.map((commute) => [commute.id, commute]));
}

function hasMeaningfulGuestState(state: AccountState) {
  return (
    state.commutes.length > 0 ||
    Object.keys(state.hardPreferences).length > 0 ||
    state.largeText
  );
}

export function mergeAccountStates(
  stored: AccountState | undefined,
  incoming: AccountState,
): AccountState {
  if (!stored) return accountStateSchema.parse(incoming);
  const commutes = commuteMap(stored.commutes);
  for (const commute of incoming.commutes) {
    const previous = commutes.get(commute.id);
    if (
      !previous ||
      Date.parse(commute.savedAt) >= Date.parse(previous.savedAt)
    ) {
      commutes.set(commute.id, commute);
    }
  }
  const incomingIsNewer =
    hasMeaningfulGuestState(incoming) &&
    Date.parse(incoming.updatedAt) >= Date.parse(stored.updatedAt);
  const profile = incomingIsNewer ? incoming : stored;
  return accountStateSchema.parse({
    preferences: profile.preferences,
    hardPreferences: profile.hardPreferences,
    largeText: profile.largeText,
    commutes: [...commutes.values()]
      .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
      .slice(0, 10),
    updatedAt: new Date(
      Math.max(Date.parse(stored.updatedAt), Date.parse(incoming.updatedAt)),
    ).toISOString(),
  });
}

export function createSessionToken(
  user: Omit<SessionIdentity, "expiresAt">,
  secret = sessionSecret(),
  now = Date.now(),
) {
  if (secret.length < 32)
    throw new Error("Account sessions are not configured");
  const payload = encode(
    JSON.stringify({
      ...user,
      expiresAt: now + SESSION_MAX_AGE_SECONDS * 1000,
    } satisfies SessionIdentity),
  );
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function readSessionToken(
  token: string | undefined,
  secret = sessionSecret(),
  now = Date.now(),
): SessionIdentity | null {
  if (!token || secret.length < 32) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const receivedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    receivedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    return null;
  }
  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as SessionIdentity;
    if (
      !value.subject ||
      !value.email ||
      !value.name ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= now
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function cookieValue(req: Request, name: string) {
  const pair = req.headers.cookie
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : undefined;
}

export function accountSession(req: Request) {
  return readSessionToken(cookieValue(req, SESSION_COOKIE));
}

export function accountsConfigured() {
  return (
    process.env.FIRESTORE_ENABLED === "true" &&
    !!process.env.GOOGLE_CLIENT_ID &&
    sessionSecret().length >= 32
  );
}

export function setAccountSession(res: Response, identity: SessionIdentity) {
  const token = createSessionToken({
    subject: identity.subject,
    name: identity.name,
    email: identity.email,
    picture: identity.picture,
  });
  const secure =
    process.env.NODE_ENV === "production" ||
    process.env.PUBLIC_URL?.startsWith("https://");
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`,
  );
}

export function clearAccountSession(res: Response) {
  const secure =
    process.env.NODE_ENV === "production" ||
    process.env.PUBLIC_URL?.startsWith("https://");
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
  );
}

async function verifiedGoogleIdentity(credential: string) {
  if (!process.env.GOOGLE_CLIENT_ID)
    throw new Error("Google account sign-in is not configured");
  const ticket = await new OAuth2Client().verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new Error("Google account identity could not be verified");
  }
  return {
    subject: payload.sub,
    email: payload.email,
    name: payload.name?.trim() || payload.email.split("@")[0],
    picture: payload.picture,
    expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  } satisfies SessionIdentity;
}

function publicUser(identity: SessionIdentity): AccountUser {
  return {
    name: identity.name,
    email: identity.email,
    picture: identity.picture,
  };
}

async function storedState(subject: string) {
  const snapshot = await db().collection("accounts").doc(hash(subject)).get();
  if (!snapshot.exists) return undefined;
  const parsed = accountStateSchema.safeParse(snapshot.data()?.state);
  return parsed.success ? parsed.data : undefined;
}

export async function signInWithGoogle(
  credential: string,
  guestState: AccountState,
) {
  if (!accountsConfigured())
    throw new Error("Google account sign-in is not configured");
  const identity = await verifiedGoogleIdentity(credential);
  const state = mergeAccountStates(
    await storedState(identity.subject),
    accountStateSchema.parse(guestState),
  );
  state.updatedAt = new Date().toISOString();
  await db()
    .collection("accounts")
    .doc(hash(identity.subject))
    .set(
      {
        user: publicUser(identity),
        state,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  return { identity, user: publicUser(identity), state };
}

export async function getAccount(identity: SessionIdentity) {
  return {
    user: publicUser(identity),
    state: await storedState(identity.subject),
  };
}

export async function saveAccount(
  identity: SessionIdentity,
  rawState: AccountState,
) {
  const state = accountStateSchema.parse(rawState);
  state.updatedAt = new Date().toISOString();
  await db()
    .collection("accounts")
    .doc(hash(identity.subject))
    .set(
      {
        user: publicUser(identity),
        state,
        updatedAt: Timestamp.now(),
      },
      { merge: true },
    );
  return state;
}

export async function deleteAccount(identity: SessionIdentity) {
  await db().collection("accounts").doc(hash(identity.subject)).delete();
}
