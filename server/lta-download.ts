import { ltaConnection, pacedDataMallFetch } from "./lta-client";

/** Never forward AccountKey to a download host or expose signed URLs in errors. */
export async function downloadLtaFile(endpoint: string, maxBytes = 80_000_000) {
  const connection = ltaConnection();
  if (!connection.key) throw new Error("LTA credential unavailable");
  const metadata = await pacedDataMallFetch(
    `${connection.base}/${endpoint}`,
    {
      headers: { AccountKey: connection.key, Accept: "application/json" },
      redirect: "error",
    },
    15000,
  );
  if (!metadata.ok) throw new Error(`LTA metadata HTTP ${metadata.status}`);
  const body = await metadata.json();
  const link = body?.value?.[0]?.Link ?? body?.value?.Link ?? body?.Link;
  if (typeof link !== "string") throw new Error("LTA download unavailable");
  const url = new URL(link);
  const allowed = connection.simulated
    ? url.origin === new URL(connection.base).origin
    : url.protocol === "https:" &&
      [
        "dmprod-datasets.s3.ap-southeast-1.amazonaws.com",
        "dmgeospatial.s3.ap-southeast-1.amazonaws.com",
      ].includes(url.hostname);
  if (!allowed || url.username || url.password)
    throw new Error("Unsupported LTA download host");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`LTA download HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > maxBytes)
    throw new Error("LTA file exceeds size limit");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty LTA download");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error("LTA file exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
