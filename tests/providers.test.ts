import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPlaces } from "../server/providers";

afterEach(() => vi.unstubAllGlobals());

describe("place search", () => {
  it("uses public OneMap search without requiring configured credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              POSTAL: "738099",
              LATITUDE: "1.4360",
              LONGITUDE: "103.7865",
              BUILDING: "WOODLANDS MRT STATION",
              SEARCHVAL: "WOODLANDS MRT STATION",
              ADDRESS: "30 WOODLANDS AVENUE 2 SINGAPORE 738343",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchPlaces("Woodlands");

    expect(results[0]).toMatchObject({
      name: "WOODLANDS MRT STATION",
      lat: 1.436,
      lon: 103.7865,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("searchVal=Woodlands"),
      expect.not.objectContaining({ headers: expect.anything() }),
    );
  });
});
