export type RequestOriginContext = {
  publicUrl?: string;
  requestOrigin: string;
};

function isLoopbackOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function requestOriginAllowed(
  origin: string,
  context: RequestOriginContext,
) {
  return (
    origin === context.requestOrigin ||
    (!!context.publicUrl && origin === context.publicUrl) ||
    (isLoopbackOrigin(origin) && isLoopbackOrigin(context.requestOrigin))
  );
}
