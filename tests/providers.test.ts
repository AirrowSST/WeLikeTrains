import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPlaces } from "../server/providers";
import { listTransitStops } from "../server/network";

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

    // The national DataMall index includes NTUC stops, a legitimate prefix
    // match. "Century" must still not match a query in the middle of a word.
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every((place) =>
        place.name
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .some((word) => word.startsWith("ntu")),
      ),
    ).toBe(true);
    expect(results.some((place) => /century/i.test(place.name))).toBe(false);
    expect(
      results.every((place) => place.id.startsWith("datamall-stop-")),
    ).toBe(true);
  });

  it("exposes deduplicated rail stations and bus stops for the map", () => {
    const stops = listTransitStops();

    expect(new Set(stops.map((stop) => stop.id)).size).toBe(stops.length);
    expect(stops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mode: "rail",
          name: "Tampines",
          codes: expect.arrayContaining(["EW2"]),
          lines: expect.arrayContaining(["EWL"]),
        }),
      ]),
    );
    expect(
      stops.some(
        (stop) =>
          stop.mode === "bus" &&
          stop.codes.some((code) => /^\d{5}$/.test(code)),
      ),
    ).toBe(true);
  });
});
