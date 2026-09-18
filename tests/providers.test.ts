import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPlaces } from "../server/providers";

afterEach(() => vi.unstubAllGlobals());

describe("place search", () => {
  it("searches the bundled place and station index without a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchPlaces("Tampines");

    expect(results.some((place) => place.name === "Tampines Central")).toBe(
      true,
    );
    expect(results.some((place) => place.id.startsWith("osm-station-"))).toBe(
      true,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
