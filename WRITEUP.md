# Wayce submission write-up

## Persona and problem

Wayce is built primarily for **Rachel**, a regular peak-hour commuter travelling from Tampines Central to Raffles Place. She plans to leave at 07:40 and be at her desk by 08:45. A status board can tell Rachel that something is wrong; Wayce instead answers the decision she has to make: keep the usual route, leave differently, or take a specific alternative, with the cost of that choice visible before she starts.

The app also includes two isolated developer-demo personas. Arjun exercises comfort and cycling preferences. Mdm Lim exercises slower walking and step-free routing. These broaden the design tests without changing Rachel as the primary end-to-end story.

## What we built

Wayce is a mobile-only web app that:

- plans door-to-door walk, bus, rail and supported cycling journeys, including access and egress legs;
- keeps the original route visible beside condition-aware alternatives;
- explains time, delay, crowd, walking, mapped shelter and accessibility trade-offs;
- distinguishes current, forecast, scheduled, estimated, stale, unavailable and synthetic information;
- turns a selected route into a map-first, step-by-step journey with manual progress;
- works without paid services using committed routing data and deterministic demo timelines;
- retains the current journey and bundled map fallback when the network is unavailable after a completed first load.

Rachel’s eventful timeline begins with heavy rain and a synthetic EWL disruption at minute 0. This is deliberately injected and visibly labelled, so judges can reproduce the affected-route and recovery paths without waiting for a real incident. It is not presented as a historical or live event.

## Architecture

| Layer | Implementation and responsibility |
| --- | --- |
| Mobile client | React, TypeScript, Vite, Leaflet and a service worker. `src/App.tsx` owns the journey, guest/account/demo, consent and companion flows; `src/Map.tsx` owns basemaps and route/transit overlays. |
| API | Express and Zod validate requests, enforce same/approved-origin access and expose planning, feeds, account, reminder and companion endpoints. |
| Routing | A local A* graph in `server/network.ts` uses committed OSM walking/rail data and official DataMall bus stop sequences. `server/planner.ts` applies conditions and preferences, ranks candidates and preserves the original comparison. |
| Data | Committed OSM, DataMall bus-reference, LTA geospatial and train GTFS-derived snapshots make the default run deterministic. Optional LTA/NEA adapters add current conditions with freshness and failure labels. |
| Map/search | Official OneMap tiles are display-only. The committed OSM vector extract is the offline fallback. Indexed search is local; configured Google Place Autocomplete adds attributed Singapore address discovery but never calculates routes. |
| AI | Gemini may explain and order only server-supplied, unblocked route IDs and may propose validated preferences. It does not invent route geometry or live facts, and preference changes require confirmation. A deterministic local guide is the no-cost fallback. |
| Persistence | Guest settings, commutes and reward prototypes are device-local. Optional verified Google sign-in syncs preferences and commutes through Firestore. Developer-demo state never syncs. |

The complete source map is in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md), and provider/data provenance is in [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

## Design decisions

**Action before information.** The home screen asks where the commuter is going and shows a recommended decision, not an operator dashboard. Detailed sources and limitations remain available without occupying the first glance.

**Comparison instead of blind trust.** The original route stays visible when conditions change. Route cards and map treatments let the commuter compare arrival time, crowding and walking rather than accepting a black-box reroute.

**Mobile-only interaction.** The interface remains one column and at most 480 px wide even on a desktop. The active journey is a full-phone map with a draggable, keyboard-resizable bottom sheet. States use labels, icons, patterns and line treatments rather than colour alone.

**Deterministic decisions, bounded AI.** Geometry, transport connectivity, timing selection, conditions and reward rules remain ordinary validated code. The optional model explains computed facts; it does not create the facts.

**Visible degradation.** Unknown crowding is not treated as low. Stale feeds keep their age and label. A live-provider failure never silently becomes demo data. Scheduled trains are never called live tracking, and schematic bus connections are not described as exact roads travelled.

## Data and privacy

OpenStreetMap is the geospatial base and remains attributed in the interface. Official LTA DataMall supplies the bundled bus reference and train schedule plus optional condition feeds. LTA station exits, covered links and cycling layers supplement mapped access. NEA/data.gov.sg supplies optional weather. OneMap supplies online visual tiles. Google place discovery, account sync, Vertex AI, text-to-speech and push are optional.

Wayce has no advertising or analytics layer. It does not perform background location tracking. Normal mode requests one foreground location fix; continuous foreground tracking is limited to the open active-journey view. Companion route context is sent to cloud AI only after consent. Browser voice recognition is user initiated, may use the browser vendor’s online service, and leaves an editable transcript that is sent only when the user confirms.

Credential names and setup are documented in [.env.example](.env.example). Real credentials, local caches and service-account material are ignored and must not be committed.

## Assumptions and limitations

- Walking, access, transfer and bus running times are estimates. Train departures come from the bundled official schedule unless a separately labelled realtime adapter is available.
- The rule-based disruption risk index is not a trained prediction and is not a calibrated probability.
- Step-free routing avoids mapped stairs and known lift outages, but unmapped barriers, entrance availability and all shelter segments are not physically verified. This is not certified accessible navigation.
- DataMall stop sequences establish bus connectivity and distance. Where verified road geometry is missing, the app shows labelled served stops/schematic context and does not use that section for road-specific traffic or flood claims.
- The reward wallet is a local prototype. Completion is manually reported, points have no cash value, and the app does not independently verify travel or emissions.
- Live providers can be quiet, stale, unavailable or quota-limited. The deterministic timelines exist to demonstrate logic, not to impersonate live conditions.
- The current Cloud Run project is temporary. The clean-clone local path is the durable reproduction method.
- Physical-phone, screen-reader, lock-screen notification and walked-route checks require human sign-off; automated Chromium and axe checks do not replace them.

## Reproducible evidence

The default build, tests and evaluation require no paid provider:

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:e2e
npm run evaluate
```

`npm run build` includes whole-project TypeScript validation plus production client/server bundles. `npm test` exercises routing, timing, feed parsing, validation, privacy boundaries and deterministic scenarios. `npm run test:e2e` runs the phone and wide-screen phone-shell projects, including core journey, offline and accessibility flows. `npm run evaluate` runs local synthetic journey/preference contract cases and writes exact results to `docs/evaluation-local.json`; it is a structural evaluation, not a forecast-accuracy claim.

Every exact network/schedule count in project documentation has a committed provenance file or a deterministic test path. No claimed result requires a judge to buy an API subscription.

## Known submission follow-up

Before final submission, add the externally hosted phone-sized demo recording to the root README and complete the unchecked physical-phone items in [docs/DEMO.md](docs/DEMO.md). Do not convert automated browser results into a claim that those human checks occurred.
