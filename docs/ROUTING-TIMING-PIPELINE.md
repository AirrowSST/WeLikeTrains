# Routing and timing data pipeline

Status: pre-implementation engineering report, 2026-09-19

## Executive summary

Wayce already finds multimodal routes locally over committed OpenStreetMap data and adjusts their ranking for disruptions, crowding, weather and accessibility. Its main timing limitation is that walking, cycling, rail and bus travel currently use distance-derived speeds plus fixed boarding and transfer allowances.

The recommended change is not to replace the local routing engine. It is to add a time-dependent evaluation layer fed by official LTA data:

- Use the new DataMall GTFS Schedule feed for planned train stop times and service calendars.
- Use DataMall BusArrival for the first bus the commuter can actually catch.
- Use BusRoutes, BusServices and BusStops as authoritative bus network and frequency data.
- Use TrafficSpeedBands and traffic incidents as bounded corrections to bus running time.
- Evaluate every candidate chronologically so that walking, station access, waits, transfers and downstream conditions occur at their predicted clock time.
- Retain committed snapshots, local fallbacks and explicit source/freshness labels.

This should improve timing and route decisions without introducing a public routing dependency, background location collection or an opaque AI timing model.

## Current Wayce pipeline

```text
Committed OSM extract
    -> pedestrian/cycle graph + selected rail/bus relations
    -> A* walking/cycling paths and transit graph search
    -> distance-derived segment times
    -> fixed initial wait / transfer allowances

Live or labelled demo conditions
    -> disruptions, crowd, weather, lift status, bus occupancy, traffic
    -> segment penalties, blocking and preference-aware ranking

Candidate journeys
    -> original vs recommended route
    -> duration range, reasons, warnings and map overlays
```

Current base timing in `server/network.ts` and `server/planner.ts` is approximately:

| Component      | Current calculation                                              |
| -------------- | ---------------------------------------------------------------- |
| Walk           | OSM path distance / persona walking speed                        |
| Cycle          | OSM path distance / 220 metres per minute                        |
| Rail           | Distance / 630 metres per minute + 0.65 minutes per station edge |
| Bus            | Distance / 320 metres per minute + 0.45 minutes per stop edge    |
| First boarding | Fixed four minutes                                               |
| Transfer       | Fixed five minutes                                               |
| Uncertainty    | Heuristic percentage and fixed condition allowances              |

The graph and route geometry are useful. The weakness is that elapsed time is mostly static and every live condition is not yet applied at the clock time when the commuter would reach that leg.

BusArrival is already fetched for relevant stops, but currently informs occupancy and wheelchair availability rather than replacing the fixed boarding wait. Traffic feeds are fetched, but the current generic parser does not consume the current TrafficSpeedBands road-segment and speed fields needed for a traffic-aware bus calculation.

## Verified DataMall GTFS finding

The supplied problem brief references DataMall guide version 6.8. The current DataMall guide is version 6.9 and added three train GTFS endpoints on 3 August 2026:

- `GTFSScheduleTrain`
- `GTFSRealTimeTrainServiceAlerts`
- `GTFSRealtimeTrainTripUpdates`

GTFS is a general public-transport standard, but the DataMall GTFS feeds currently published are train-specific. Bus data remains available through the separate DataMall bus APIs.

A read-only authenticated smoke test of `GTFSScheduleTrain` returned the expected GTFS files:

| Item                |     Observed value |
| ------------------- | -----------------: |
| Routes              |                 19 |
| Stops and platforms |              1,211 |
| Trips               |             17,576 |
| Stop-time records   |            333,262 |
| Calendar coverage   | Through 2026-12-31 |

The feed contained platform-specific identifiers such as `EW2_B` and `EW14_B`, weekday/weekend/public-holiday services, calendar exceptions and direct EWL stop times.

For the Rachel fixture on Monday 2026-09-21:

| Value                                       |  Current Wayce |                                  LTA GTFS schedule |
| ------------------------------------------- | -------------: | -------------------------------------------------: |
| Estimated arrival at Tampines routing point |          07:54 |                     07:54 input to schedule lookup |
| Boarding wait                               |     4:00 fixed |                         0:50 to the 07:54:50 train |
| Tampines to Raffles Place ride              |    About 34:24 |                                    36:20 scheduled |
| Wait plus ride                              |    About 38:24 |                                        About 37:10 |
| Door-to-door result                         | 55 min rounded | About 54 min before extra station-access allowance |

The similar total hides offsetting errors in the current model. GTFS improves the components independently, which is more important for transfers and tight deadlines than the one-minute change in this example.

GTFS Schedule is a planned timetable, not proof of actual normal-day train movement. DataMall's realtime train trip updates provide predicted times during disruptions. Station entrance-to-platform time must be included before deciding that a train is catchable.

## Proposed target pipeline

```text
Explicit maintenance imports
    OSM + LTA GTFS Schedule + BusStops/Routes/Services
    + selected LTA geospatial layers
        -> validated, normalized, timestamped local snapshots
        -> provenance and licence records

Short-lived runtime inputs
    BusArrival + train disruption updates + crowd
    + weather + facilities + traffic + floods/works
        -> independently cached and freshness-labelled conditions

Journey request
    -> local topology search produces several viable route structures
    -> chronological evaluator advances a journey clock through every leg
    -> live/scheduled wait and running time applied at each leg's start time
    -> blocked routes removed; remaining routes ranked for time, reliability,
       crowd, shelter, accessibility and persona preferences
    -> original/recommended comparison with source-labelled timing range
```

Runtime route computation remains local. OneMap remains the online display basemap only, with the committed OSM display fallback.

## Train timing pipeline

1. Normalize GTFS route, platform and station identifiers through the existing canonical line/station table.
2. Select the active service using `calendar.txt` and `calendar_dates.txt` for the Singapore service date.
3. Support GTFS times beyond `24:00:00` instead of parsing them as ordinary wall-clock strings.
4. Advance the journey clock through the access walk and a station access allowance.
5. Select the first scheduled train that remains catchable.
6. Use stop-time differences for the planned ride and transfer time.
7. Apply realtime trip updates and service alerts when present.
8. Fall back visibly to the existing estimate if the snapshot or station mapping is unavailable.

Useful geospatial additions are `TrainStationExit` and, later, authoritative covered-link and cycling layers. Correct station entrances improve both timing and accessibility more than adding false precision to a station-centre route.

## Bus timing pipeline

### Static and future-planning layer

- `BusStops`: stop codes and coordinates.
- `BusRoutes`: service, direction, stop sequence, cumulative distance and first/last service times.
- `BusServices`: peak/off-peak frequency ranges and operating metadata.
- `PlannedBusRoutes`: future network changes, applied only from their effective date.

For trips outside the live arrival horizon, use a time-of-day frequency-based wait and a historical or traffic-neutral running-time baseline. These are estimates and require a wider range.

### Live boarding layer

After the access walk, query BusArrival only for candidate boarding stops and choose the first vehicle whose ETA is after the predicted stop-arrival time:

```text
07:40 leave
07:48 reach stop
07:46 bus is missed
07:51 bus is the first catchable vehicle
```

Prefer location-monitored arrivals over schedule-derived arrivals. Preserve occupancy, wheelchair and vehicle-type fields in the same selected vehicle record. If the feed is stale or unavailable, use the frequency fallback and label it.

### In-vehicle layer

The initial model should remain deterministic and explainable:

```text
running time
  = sum(route-matched road distance / bounded current speed)
  + intermediate-stop dwell allowances
  + known incident or diversion effects
```

`v4/TrafficSpeedBands` describes general road traffic rather than bus speed. It should modify a bus baseline, not replace it. Bus lanes, traffic lights, dwell and boarding behaviour require a calibrated correction and an uncertainty range.

DataMall BusArrival does not expose the same stable bus trip and vehicle identifiers commonly available in GTFS Realtime. Wayce should not invent vehicle identity by loosely matching coordinates. Historical calibration, if added later, should be a controlled aggregate process with documented DataMall terms and rate limits.

## Comparison with existing products

Only publicly documented behaviour is compared below. Google and Citymapper do not publish their complete routing or prediction models.

| Capability                  | Google Maps                                                                                | Citymapper                                                                                | MyTransport.SG                               | Wayce now                                    | Proposed Wayce                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Base transit network        | Agency GTFS and partner data                                                               | Multiple operator/open/proprietary sources                                                | Official LTA network                         | Committed OSM, selected bus relations        | OSM geometry plus normalized LTA train/bus reference snapshots                        |
| Planned train timing        | GTFS Schedule                                                                              | Operator/schedule sources                                                                 | Train timetable information                  | Distance heuristic                           | DataMall GTFS Schedule                                                                |
| Live bus boarding           | Agency GTFS Realtime or equivalent partner feeds                                           | Agency live data and vehicle tracking where available                                     | Official bus arrivals                        | Feed fetched but fixed wait retained         | First catchable DataMall BusArrival                                                   |
| Downstream bus ETA          | Google documents forecasting subsequent stops from a stable realtime vehicle/trip position | Citymapper says it compares current vehicle movement with historical movement and traffic | Implementation is not public                 | Distance and nominal speed                   | Route distance + traffic correction + dwell, later calibrated with observed residuals |
| Disruptions/diversions      | Realtime trip updates and alerts                                                           | Live disruptions, traffic and some mapped diversions                                      | Official service and road alerts             | LTA conditions and labelled demo scenarios   | Same, with time-specific chronological application and corrected adapters             |
| Personalised decision       | General route preferences                                                                  | Routing preferences and accessibility modes                                               | Saved/frequent information and notifications | Persona-aware ranking and proactive routines | Preserve as primary product differentiator                                            |
| Explain original vs revised | Limited product-specific presentation                                                      | Alternative routes and live changes                                                       | General journey planning                     | Explicit original/recommended comparison     | Preserve with better grounded times and source labels                                 |
| Offline behaviour           | Product-dependent                                                                          | Scheduled trip information may be cached                                                  | Not assessed here                            | Cached app and last journey                  | Committed route/schedule fallback plus cached current journey                         |
| Model transparency          | Prediction details are proprietary                                                         | Prediction details are proprietary                                                        | Not public                                   | Deterministic and explainable                | Deterministic first; any learned calibration isolated and measured                    |

Google's public Transit documentation describes static GTFS combined with realtime trip updates, service alerts and vehicle positions. It states that, when a stable trip and vehicle position are supplied, Google forecasts arrival at subsequent stops. This depends on richer vehicle identity than the current DataMall bus response provides.

Citymapper publicly describes aggregating agency data, live traffic and vehicle movement, comparing current movement with past movement, and evaluating predictions after completed rides. Its published accuracy improvements are Citymapper's own measurements and are not independently reproduced here.

MyTransport.SG provides official multimodal journey planning, live traffic, bus arrival/crowding and notifications. Its internal timing model is not public, so the comparison is feature-level only.

Wayce should not try to out-scale these general mapping products. Its defensible advantage is proactive, explainable advice for a known commute: whether today's conditions justify changing the usual route, departure time or mode, with the original and revised journeys visible together.

## Implementation sequence

### Stage 0 — adapter and fixture audit

Status: completed on 2026-09-19. The three audited endpoints now use their
current paths and schema-specific parsers, with deterministic fixtures for
payload fields, independent partial failure and stale-cache fallback. A
read-only authenticated smoke check returned HTTP 200 for all three paths.
Traffic speed and expressway section time remain informational until the later
route-matching stages, so Stage 0 does not change journey ranking.

- Verify current DataMall paths and response schemas against guide v6.9.
- In particular, audit `v4/TrafficSpeedBands`, `EstTravelTimes` and `PubFloodAlerts`.
- Add deterministic response fixtures before changing routing behaviour.

Exit condition: every configured feed is independently reported as live, stale or unavailable and its parser consumes the current documented fields.

### Stage 1 — GTFS-backed rail timing

Status: implemented locally on 2026-09-19; deterministic and real-snapshot
verification complete, deployment and physical journey validation not performed.

- Add an explicit authenticated maintenance import, not a startup/runtime download.
- Commit a compact derived schedule snapshot and provenance if permitted by the applicable DataMall licence/terms.
- Add calendar, platform normalization and stop-time tests.
- Add the chronological evaluator for rail access, waits, rides and transfers.

Exit condition: Rachel and selected transfer fixtures use the correct dated service, catchable train and scheduled stop-time difference, with a visible fallback test.

#### Stage 1 design critique and resolution

The pre-execution critique found no redistribution blocker. The current LTA
Singapore Open Data Licence v1.0 grants worldwide, perpetual, royalty-free use,
including copying, distribution, modification and derived applications. It
requires conspicuous source attribution and a link to the licence, prohibits an
implication of official endorsement, and does not grant unavailable third-party
or personal-data rights. The API terms separately require credential
confidentiality, compliance with technical and dataset-specific restrictions,
and the current request threshold. The GTFS Schedule listing has no
PlannedBusRoutes-style future effective-date restriction.

The initial design was amended in these ways:

- `npm run data:gtfs` is the only bulk-download path. It reads the AccountKey
  locally, makes one metadata request, follows the 15-minute archive link and
  never writes either value to the snapshot or provenance.
- The derived snapshot is deterministic JSON compressed as
  `data/train-schedule.json.gz`. The 2026-09-19 import is 1.9 MB, with 17,576
  trips and 12 service calendars covering 2026-01-01 through 2026-12-31.
  `data/GTFS-PROVENANCE.json` records source, access time, licence, coverage,
  record counts and a SHA-256 hash.
- `calendar.txt` supplies ordinary weekday service and
  `calendar_dates.txt` takes precedence for additions/removals. The evaluator
  considers both the Singapore calendar date and the previous service date, so
  a `24:10:00` trip remains catchable shortly after midnight.
- Platform IDs are normalized through `stop_code`, `parent_station` and the
  platform `stop_id`, preferring the station-code prefix for the trip's line.
  Unknown mappings fail closed to the labelled distance fallback.
- The journey clock advances through each preceding leg. A normal boarding
  uses a labelled two-minute station-access allowance and a direct rail change
  uses three minutes; step-free journeys use four and five minutes. These are
  deliberately coarse estimates, not certified entrance-to-platform times.
- Selection proves catchability: a departure earlier than the post-access
  ready time is rejected even if it is the closest scheduled train. Transfers
  repeat the same decision after the prior scheduled arrival.
- Missing, corrupt, out-of-coverage or unmapped schedule data leaves route
  topology intact and adds an explicit timetable-fallback label. The app does
  not download a replacement at startup or silently substitute demo data.

Remaining limitation: GTFS Schedule is planned service and Stage 1 does not yet
apply the realtime trip-update feed. Timings still include estimated walking and
station access, so no real-world accuracy claim is made before Stage 4 field
observations.

### Stage 2 — live bus wait

- Normalize BusStops, BusRoutes and BusServices for the supported routes first.
- Apply BusArrival after candidate generation and select the first catchable monitored vehicle.
- Re-evaluate transfers chronologically and rerank candidates.

Exit condition: a fixture with a missed first bus selects the second arrival, changes the journey duration and can change the recommended route.

### Stage 3 — traffic-aware bus running time

- Parse and map-match TrafficSpeedBands road segments.
- Apply bounded traffic multipliers, stop dwell and incident effects.
- Preserve a wider range where road coverage is incomplete.

Exit condition: deterministic congestion fixtures change only intersecting bus legs and never claim road speed is measured bus speed.

### Stage 4 — calibration and field validation

- Record explicit, consented test-journey timestamps for access, wait, ride, transfer and egress.
- Compare the old and new pipelines by component and end-to-end.
- Consider aggregate time-of-day calibration only after enough observations exist.

Exit condition: any accuracy claim names the dataset, sample size and measurement method.

## Evaluation plan

The primary metric should be end-to-end arrival error, supported by component metrics:

- Median absolute error in minutes.
- 90th-percentile absolute error.
- Percentage of actual arrivals inside the displayed range.
- Catchable-vehicle accuracy: whether the predicted bus/train could actually be boarded.
- Route-choice regret: how much slower the recommendation was than the best observed viable candidate.
- Feed-degradation behaviour when each provider is unavailable or stale.

Start with Rachel's journey across several weekday peak observations, then add one transfer-heavy trip, one supported bus-led trip, Arjun's mixed-mode journey and Mdm Lim's slower access timings. Automated fixtures verify logic but do not replace the required real journey.

## Product and data boundaries

- OSM remains the required geospatial base and retains attribution.
- Runtime route computation stays local; OneMap remains display-only unless the user makes a new decision.
- Static official data is refreshed explicitly and carries provenance; no repeated bulk download occurs in tests or startup.
- Live failures remain visible and never become synthetic data.
- Demo conditions remain deterministic and labelled.
- No background location tracking or silent travel-history collection is introduced.
- User journey observations require explicit consent and must not sync routinely without a new product decision.
- Gemini may explain or rank supplied valid candidates but does not generate route topology, travel times or live facts.
- Traffic speed is not represented as bus speed, crowding is not represented as delay, and heuristic ranges are not called calibrated confidence intervals.

## Recommendation

Proceed with Stages 0 and 1 as the first implementation slice. The GTFS smoke test established that the official train schedule contains the expected data and can map to the primary Rachel route. Stage 2 should follow because replacing the fixed bus wait with the first catchable DataMall arrival is likely the highest-value bus improvement. Traffic-aware bus running time and historical calibration should remain later, separately measurable increments.

## Sources

- `PS2_README (1).md` — organiser-provided problem brief and recommended data sources; its device-local location is recorded in `AGENTS.md`.
- [LTA DataMall API User Guide, current version](https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf?ref=public_apis) — train GTFS, bus and traffic feed contracts.
- [Google: using static GTFS with realtime feeds](https://support.google.com/transitpartners/answer/10104434?hl=en) — documented static/realtime transit model.
- [Google: realtime VehiclePosition predictions](https://support.google.com/transitpartners/answer/10105813?hl=en) — downstream-stop prediction from vehicle and trip position.
- [Citymapper: live traffic predictions for buses and trams](https://www4.citymapper.com/news/2636/live-traffic-predictions-for-buses-and-trams) — public description of current-versus-historical vehicle movement and self-reported evaluation.
- [Citymapper: making bus rides better](https://citymapper.com/news/2809/making-bus-rides-better) — live locations, traffic-adjusted times and diversions.
- [LTA: MyTransport.SG features](https://www.lta.gov.sg/content/dam/ltagov/Home/PDF/MTM.pdf) — official feature summary.
