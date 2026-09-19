import { describe, expect, it } from "vitest";
import { requestOriginAllowed } from "../server/origin-policy";

describe("API request origin policy", () => {
  it.each([
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:43127",
  ])("allows loopback development origins on any port: %s", (origin) => {
    expect(
      requestOriginAllowed(origin, {
        publicUrl: undefined,
        requestOrigin: "http://localhost:8080",
      }),
    ).toBe(true);
  });

  it("keeps the production allowlist restricted", () => {
    const context = {
      publicUrl: "https://wayce.example",
      requestOrigin: "https://wayce.example",
    };

    expect(requestOriginAllowed("https://wayce.example", context)).toBe(true);
    expect(requestOriginAllowed("http://localhost:5174", context)).toBe(false);
    expect(requestOriginAllowed("https://attacker.example", context)).toBe(
      false,
    );
  });
});
