export const OFFICIAL_LTA_BASE =
  "https://datamall2.mytransport.sg/ltaodataservice";

let requestStartQueue = Promise.resolve();
let nextRequestStart = 0;

export async function pacedDataMallFetch(
  url: string,
  init: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  const officialDataMall = url.startsWith(`${OFFICIAL_LTA_BASE}/`);
  if (!officialDataMall || process.env.NODE_ENV === "test") {
    const signal = timeoutMs
      ? init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs)
      : init.signal;
    return fetch(url, { ...init, signal });
  }

  // DataMall reports short burst-quota violations as HTTP 500. Pace all
  // authenticated metadata/API calls through one process-wide queue.
  const turn = requestStartQueue.then(async () => {
    const wait = Math.max(0, nextRequestStart - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    nextRequestStart = Date.now() + 400;
  });
  requestStartQueue = turn.catch(() => undefined);
  await turn;
  // Start the network timeout after queueing. A timeout created by callers
  // before this wait can otherwise expire before the request is sent.
  const signal = timeoutMs
    ? init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs)
    : init.signal;
  return fetch(url, { ...init, signal });
}

/** Local overrides never receive the real AccountKey, including redirects. */
export function ltaConnection() {
  const override = process.env.LTA_BASE_URL;
  if (!override)
    return {
      base: OFFICIAL_LTA_BASE,
      key: process.env.LTA_ACCOUNT_KEY,
      simulated: false,
    };
  if (process.env.NODE_ENV === "production")
    throw new Error("LTA_BASE_URL is development-only");
  const url = new URL(override);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "LTA_BASE_URL must be an HTTP 127.0.0.1 URL without credentials or query parameters",
    );
  return {
    base: url.href.replace(/\/$/, ""),
    key: "local-test-key",
    simulated: true,
  };
}
