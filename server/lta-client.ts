export const OFFICIAL_LTA_BASE =
  "https://datamall2.mytransport.sg/ltaodataservice";

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
