# Routing data implementation — 2026-09-19

This describes local source, not the deployed revision. The source audit led to the following implemented integrations; field accuracy remains unmeasured.

Crowdedness is shown per bus/train leg in directions, active-journey steps and route map popups. Bus occupancy refers to the selected arriving vehicle; rail crowding refers to stations/platforms, not train carriages. Low, Moderate, High and Unknown are text labels, with current/forecast/simulated provenance. Expired cached platform readings are excluded from new plans. Offline views remain saved-plan observations, not live readings.

| Input | Implemented use | Remaining boundary |
| --- | --- | --- |
| OSM snapshot | Local walking/cycling/transit topology and geometry | Regional walking coverage and selected bus shapes; approximate access remains labelled |
| LTA BusStops/BusRoutes/BusServices | Primary bus graph from official ordered stop connections and cumulative distances, peak/offpeak expected waits and boarding operating windows; optional same-service OSM display shapes | 25,682 directed hops across 601 services / 797 directions: 842 OSM-matched, 24,840 explicitly schematic. 343 adjacencies are rejected: 236 sequence gaps, one decreasing distance, and 106 distances shorter than the stop-coordinate straight-line distance even with a 150 m rounding/location allowance. These counts do not certify complete routes. Walking coverage still limits door-to-door journeys. Public-holiday-specific bus calendars are not yet available |
| LTA TrainStationExit | 613 imported points; first/last walking legs can use named exits, with estimated platform access/egress allowances | Exit coordinates do not certify lift access or indoor paths |
| LTA CoveredLinkWay | 7,012 features; enriches aligned OSM pedestrian edges using an 8 m tolerance. Walking results preserve covered/exposed/unknown metre totals and matching subsegment geometry for preference, weather ranking and map display | Does not invent connections across disconnected paths or claim coverage of unmapped access. Required-shelter mode rejects exposed edges and allows at most 15 m of unknown endpoint-coordinate connection |
| LTA CyclingPath | 4,830 features; enriches aligned permitted OSM edges | Existing access restrictions remain; disconnected cycling geometry is not automatically joined |
| LTA GTFS Schedule | Dated catchable rail services; downstream rail is reselected after earlier waits and condition delays | Planned timings; estimated station access and walking |
| LTA GTFS realtime trip updates | Binary decoder, freshness checks, exact trip/service-date matching, delay/absolute-time predictions, cancellations and skipped endpoints | Both official realtime metadata endpoints returned no downloadable payload in this check. Fixture verification does not establish actual live predictions. Undated, sequence-only, added and differential trips are conservatively unsupported |
| LTA GTFS realtime alerts | Active periods and scoped no-service exclusions; unsupported trip/direction selectors remain advisories | No live payload was available to validate actual selectors |
| LTA BusArrival | Fresh monitored first-catchable arrivals, reevaluated after upstream delay | Vehicle identity and downstream running times remain estimates |
| LTA TrafficSpeedBands | Conservative same-direction spatial matching on mapped bus legs only; adds only a bounded slowdown to bus running time, never to waiting time | Disabled for legs containing schematic geometry. First returned page only; incomplete spatial coverage. Road speed is not bus speed; multiplier is uncalibrated |
| LTA PlannedBusRoutes | Explicit paginated maintenance import, rejects future effective dates before saving, replaces complete released directions only | Zero eligible released changes in the actual import. Overlay is tied to the exact base snapshot; reimport after refreshing bus references. New bus connections can use labelled schematic geometry |
| NEA/data.gov.sg | Forecast plus correctly joined nearest station observations; stale observations and present observations for distant future trips are excluded | Area forecasts remain coarse; numerical weather thresholds are app assumptions |
| OneMap | Display tiles only | No public itinerary/geocoding dependency |

## Explicit maintenance

`npm run data:geospatial` downloads the three selected official shapefile archives, requires `.prj` and `.dbf`, transforms the declared CRS to WGS84, bounds-checks Singapore coordinates, and writes a compressed snapshot plus provenance. No bulk import runs on startup or in tests. Download hosts are allowlisted, redirects rejected, credential headers withheld from download requests, and signed URLs are never retained.

`npm run data:planned-buses` downloads current planned rows, discards unpublished rows without logging/storing them, and stores only released rows no older than the base reference date. The public feed's effective-date restriction is enforced by wall clock, not by a user choosing a future journey date.

## Consented field calibration

No automatic journey recording or cloud upload is enabled. A consenting tester can manually create an ignored `.local/consented-observations.json`:

```json
{
  "consent": true,
  "synthetic": false,
  "observations": [
    { "predictedMinutes": 50, "actualMinutes": 54, "lowerMinutes": 47, "upperMinutes": 60, "catchable": true }
  ]
}
```

The numbers above illustrate the format; replace them with measured journeys. Run `npm run evaluate:timings -- .local/consented-observations.json` to report sample size, median/p90 absolute error, observed interval coverage and catchability. It makes no network request and refuses an empty sample. Keep route-choice comparisons and component observations in the tester's own notes until a sufficient consented sample exists. This is a measurement workflow, not a trained or validated calibration model.

## Provider references

- [LTA DataMall API guide v6.9](https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf): dispatch windows, effective-date restrictions, shapefile layers and GTFS download contracts.
- [GTFS Realtime reference](https://gtfs.org/documentation/realtime/reference/): service dates, cancellations, skipped stops and stop-time updates.
- Snapshot licences, counts, projection definitions and hashes are recorded in `data/*PROVENANCE.json`.

The next sources to evaluate are broader maintained OSM bus/road coverage and an official public-holiday calendar. Passenger volumes, school terms and event feeds remain candidates, not integrated predictors. Physical-phone, walked-route, accessibility and real disruption accuracy validation remain human tasks.
