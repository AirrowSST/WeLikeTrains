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

  it("keeps every curated destination in the default picker list", async () => {
    const results = await searchPlaces(" ");

    expect(results).toHaveLength(10);
    expect(results.map((place) => place.name)).toEqual(
      expect.arrayContaining([
        "Tampines Central",
        "Raffles Place",
        "Changi Airport",
        "Orchard",
      ]),
    );
  });

  it("ranks exact stations ahead of loosely matching bus stops", async () => {
    const results = await searchPlaces("Tampines");

    expect(results[0]?.name).toBe("Tampines");
    expect(results.map((place) => place.name)).toContain("Tampines Central");
  });

  it("does not match a query inside the middle of an unrelated word", async () => {
    const results = await searchPlaces("NTU");

    expect(results).toEqual([]);
  });
});
