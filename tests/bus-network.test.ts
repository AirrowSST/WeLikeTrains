import { afterEach, describe, expect, it } from "vitest";
import { startDatamallSimulator } from "../scripts/datamall-simulator";
import {
  buildBusNetworkSnapshot,
  fetchBusReferenceRows,
  listDataMallBusStops,
} from "../server/bus-network";

const servers: Awaited<ReturnType<typeof startDatamallSimulator>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("DataMall bus network snapshot", () => {
  it("follows every 500-row page and normalizes all three reference tables", async () => {
    const server = await startDatamallSimulator();
    servers.push(server);
    const rows = await fetchBusReferenceRows({
      base: server.base,
      key: "local-test-key",
    });
    const snapshot = buildBusNetworkSnapshot(rows, "2026-09-19T00:00:00.000Z");

    expect(snapshot.stops).toHaveLength(501);
    expect(snapshot.routes).toHaveLength(501);
    expect(snapshot.services).toHaveLength(501);
    expect(snapshot.stops.at(-1)).toMatchObject({
      code: "10500",
      name: "Synthetic stop 500",
    });
    expect(snapshot.routes.at(-1)).toMatchObject({
      serviceNo: "27",
      stopCode: "10500",
      stopSequence: 501,
    });
  });

  it("indexes every service that calls at a stop for clickable map details", () => {
    const snapshot = buildBusNetworkSnapshot(
      {
        BusStops: [
          {
            BusStopCode: "76141",
            RoadName: "Tampines Avenue 4",
            Description: "Tampines Int",
            Latitude: 1.354,
            Longitude: 103.943,
          },
        ],
        BusRoutes: [
          {
            ServiceNo: "27",
            Operator: "SBST",
            Direction: 1,
            StopSequence: 1,
            BusStopCode: "76141",
            Distance: 0,
          },
          {
            ServiceNo: "168",
            Operator: "SBST",
            Direction: 1,
            StopSequence: 1,
            BusStopCode: "76141",
            Distance: 0,
          },
        ],
        BusServices: [
          {
            ServiceNo: "27",
            Operator: "SBST",
            Direction: 1,
            Category: "TRUNK",
            OriginCode: "76141",
            DestinationCode: "64009",
          },
          {
            ServiceNo: "168",
            Operator: "SBST",
            Direction: 1,
            Category: "TRUNK",
            OriginCode: "76141",
            DestinationCode: "46009",
          },
        ],
      },
      "2026-09-18T23:00:00.000Z",
    );

    expect(snapshot.accessedOn).toBe("2026-09-19");
    expect(listDataMallBusStops(snapshot)).toEqual([
      expect.objectContaining({
        id: "lta-bus:76141",
        codes: ["76141"],
        lines: ["27", "168"],
      }),
    ]);
  });

  it("loads the committed complete reference snapshot", () => {
    const stops = listDataMallBusStops();

    expect(stops).toHaveLength(5208);
    expect(stops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lta-bus:76141",
          lines: expect.arrayContaining(["27", "168"]),
        }),
      ]),
    );
  });
});
