# Wayce

A **mobile-only Singapore commuter companion**: a useful decision before you leave, not another transport dashboard.

**Existing hosted build:** <https://weliketrains-191711317812.asia-southeast1.run.app> — the clean-clone path below is authoritative until the latest source is explicitly deployed.

Wayce plans door-to-door walk, bus, rail and cycling journeys on a committed OpenStreetMap/LTA graph, then compares the original route with condition-aware alternatives. It makes delay, crowding, weather, shelter and accessibility trade-offs visible on a one-column map interface capped at 480px. Rachel’s Tampines → Raffles Place commute is the primary demonstration; Arjun and Mdm Lim cover cycling/comfort and step-free needs.

| Hackathon requirement | Where to verify it |
| --- | --- |
| Route planning | Enter endpoints in **Journey**, or run Rachel’s deterministic control/eventful timelines. Walking legs are included at both ends. |
| OpenStreetMap GIS | Route computation and the offline map use committed OSM-derived data with visible attribution; OneMap supplies online display tiles only. |
| Mobile visualisation | The map distinguishes original, affected and selected routes; cards compare time, crowd and walking; route and crowd states use text/icons as well as colour. |

The default clean-clone experience needs no API key and makes no paid request. Optional provider configuration adds live LTA/NEA conditions, Google place discovery, account sync and cloud companion features without replacing the local routing engine. See the [submission write-up](WRITEUP.md) for architecture, assumptions and limitations.

## Five-minute judge path

Use the hosted URL above or start the app locally using the next section. The app opens as a local guest. To reproduce a disruption without relying on judging-day conditions:

1. Open **Account → Developer mode → Open demo presets**.
2. Select **Rachel**, choose **Control · no events**, and tap **Start demo**. Note the 21 September 2026 simulated clock and the normal Tampines Central → Raffles Place plan.
3. Change the timeline to **Eventful**. Heavy rain and the synthetic EWL disruption are active from minute 0, so the revised recommendation can be compared immediately. The places, OSM geometry and scheduled train data are real; the incident, weather and crowd readings are labelled synthetic fixtures.
4. Compare the original and revised route on the map. Swipe route cards for time, crowd and walking trade-offs. Select a route; its named **Start** action appears only after that explicit selection. Open **Full details** for directions, sources and limitations.
5. Start the selected route. The current leg is emphasised on a full-phone map while **One step at a time** directions, arrivals and manual progress controls stay in a draggable bottom sheet. Use the timeline controls to show recovery, or manually confirm the final step to demonstrate the on-device points rule.

Optional follow-ups: open a rail marker for scheduled departures and current/forecast crowd icons; open a bus stop and select a service to map its ordered stops; ask the companion why the alternative changed. The companion falls back to a deterministic local guide when Vertex AI is unavailable.

Normal mode requests a one-shot foreground location and starts with **Where to?** plus **Leave: Now**. Permission failures remain visible and the origin stays editable. Continuous location runs only while an active journey is open; there is no background tracking.

## Demo recording

**Submission blocker:** add the final phone-sized recording URL here before submitting. The recording should follow the Rachel path above end to end, identify the eventful timeline as an injected synthetic scenario, and must not be committed as a large video file. Use the [real-phone and recording checklist](docs/DEMO.md).

## Reproduce from a clean clone

### Prerequisites

- Git.
- Node.js **22.12 or newer** (Node 22 LTS is recommended). `package-lock.json` supplies exact npm dependency versions.
- About 1.5 GB of free disk space for dependencies, build output and the bundled routing/map data.
- Chromium only if running the optional browser suite (`npx playwright install chromium`).

No database, Docker, API key, data download or cloud account is required for the default path. The station index, routing graph, DataMall snapshots, train schedule and offline OSM basemap are committed.

```sh
git clone https://github.com/AirrowSST/WeLikeTrains.git
cd WeLikeTrains
npm ci
npm run build
npm start
```

Open <http://localhost:8080>. Confirm the server separately with <http://localhost:8080/api/health>; it should return `{"status":"ok","service":"Wayce","version":"1.0.0"}`. Stop it with `Ctrl+C`.

For development, run `npm run dev` and open <http://localhost:5173>. Vite may choose the next free loopback port while the API remains on port 8080. On a physical phone, use the hosted HTTPS URL: location, service workers and push features are restricted on ordinary LAN HTTP origins.

### Optional configuration

The zero-configuration app runs in labelled demo mode. To enable optional integrations, copy `.env.example` to `.env`, set only the variables you need, and restart. `.env` is ignored; never commit it.

| Variables | Enables | Required for default run? |
| --- | --- | --- |
| `DATA_MODE=live`, `LTA_ACCOUNT_KEY` | Live LTA conditions and monitored bus arrivals. Obtain a free key from [LTA DataMall](https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html). | No |
| `GOOGLE_MAPS_API_KEY` | Singapore-restricted Google Place Autocomplete in Wayce’s attributed inputs. Restrict the browser key to approved origins, Maps JavaScript API and Places API (New). | No |
| `GOOGLE_CLIENT_ID`, `SESSION_SECRET`, `FIRESTORE_ENABLED=true` | Optional verified Google account sync. | No |
| `GOOGLE_CLOUD_PROJECT` plus local ADC or `VERTEX_API_KEY` | Optional Vertex AI companion; the local guide remains available without it. | No |
| `ENABLE_CLOUD_TTS=true` and Google Cloud auth | Optional spoken companion replies. | No |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional push reminders. | No |

The full variable list and safe blank defaults are in [.env.example](.env.example). Cloud Run uses attached service identities; do not download or commit a service-account key.

## Product details

### Arrivals during a journey

Once a route is started, **One step at a time** shows up to three upcoming services at the current or next boarding stop. Bus times use fresh monitored LTA arrivals for the selected stop and service. Train times are **scheduled departures from the bundled GTFS timetable, not live train tracking**. The panel refreshes every 30 seconds while visible and closes with the journey; stale, unavailable and offline results remain labelled. Developer demos use simulated bus data and a labelled demo clock.

### Points and demo rewards

**Rewards** in the bottom navigation shows your points, earning history and a demo catalogue. **Account → Preferences** contains travel, readability and companion settings. Route cards preview 1 point per 100 metres walked/cycled (10/km, rounded down), plus 20 points when the selected alternative has a lower known crowd level than the original. Confirm the final journey step to collect; selecting, starting or abandoning a route awards nothing. The same planned departure and endpoints can be credited only once. Blocked routes earn nothing and unknown crowds do not qualify for the quieter-route bonus.

Coffee (50 points), smoothie (100) and cycle (200) rewards are fictional examples with no real vouchers, merchant partnerships or cash value. Redemption deducts points and appears under My rewards. Wallets persist on this device separately for guests and each signed-in account; they do not merge or sync with Google/Firestore. Developer-demo wallets are temporary and discarded on exit. Completion is self-reported using planned distances/crowd levels, not verified travel or measured emissions. Clearing saved data also clears local wallets.

## Verification

### Local crowd-flow dashboard draft

The separate Crowd Flow Lab is a local-only exploration UI. Run `npm run dev`
and open <http://localhost:5173/crowd-dashboard.html>. It is deliberately not
linked from the commuter app or included in the production client build.

The rail view requests one selected line at a time through the existing cached,
paced `PCDRealTime` and `PCDForecast` adapters. The bus view loads the committed
DataMall stop sequence for a selected service, then requests occupancy only for
an individually clicked stop or a manually triggered five-stop sample. A clearly
labelled illustrative preview remains available when live data is unconfigured
or has no active reading. Unknown, stale and unavailable values never appear as
low crowding.

The reward panel uses the app's current +20-point quieter-route rule, but its
eligible-journey count and uptake percentage are explicit user assumptions. It
is a deterministic visual sandbox, not a forecast of passenger behaviour or a
claim that DataMall supplies passenger-flow counts. Production access, operator
authentication, aggregate outcome measurement and any real incentive trial
remain future decisions.

### Local DataMall simulator

The in-app developer timelines run without a separate server or credentials.
They share authored API payload generators with the HTTP simulator, pass transport
payloads through the feed parsers, and never fetch real weather for a timeline.
Both timelines for each profile start at that profile's departure time on
21 September 2026 and last 60 simulated minutes. Control remains clear and
normal; eventful starts every adverse condition immediately at minute 0
(heavy rain plus Rachel's EWL disruption, Arjun's NEL disruption or Mdm Lim's
Outram Park lift outage), clears the weather at +25 and restores transport at
+40. These are synthetic exercises, not historical events.
Playback advances one simulated minute per step, waiting for planning to finish.
It replans from the selected origin; journey progress and simulated location
steps remain manually controlled. Exit demo restores the guest/account space.

To inspect matching raw payloads, append
`?timeline=rachel-eventful&minute=12` to a simulator endpoint. IDs are
`rachel-control`, `rachel-eventful`, `arjun-control`, `arjun-eventful`,
`lim-control`, and `lim-eventful`; minute is an integer from 0 to 60.
Timeline endpoints include `TrainServiceAlerts`, `v2/FacilitiesMaintenance`,
`PCDRealTime`/`PCDForecast` (with `TrainLine`), `v3/BusArrival` (with
`BusStopCode`), and the synthetic NEA `two-hr-forecast` fixture. Timeline
queries are request-scoped and do not alter the simulator's failure scenarios.

Run `npm run dev:datamall missed-first-bus` in one terminal.
In a second PowerShell terminal, launch the app with:

```powershell
$env:LTA_BASE_URL = 'http://127.0.0.1:8090/ltaodataservice'
npm run dev
```

Use the app's normal/live mode to exercise HTTP adapters. LTA feed rows and
notices display **SIMULATED**; the server always sends `local-test-key`, so no
real credential is required. NEA weather, OneMap and optional account/AI services
retain their existing configuration; this simulates LTA only. To return to real
LTA, remove the process override with `Remove-Item Env:LTA_BASE_URL` and restart
the app. No `.env` edits are needed.

Scenarios: `normal`, `missed-first-bus`, `partial-failure`, `stale`, `timeout`,
`rate-limited`, `malformed`. Restart the simulator to change scenarios; restart
the app to clear its cached responses when an immediate change is needed.
`stale` succeeds on the first request per endpoint and then returns 503; leave
the app cache intact and wait for its normal TTL to test stale fallback.
`partial-failure` fails only TrafficSpeedBands. For extra options, call the script
directly: `node --import tsx scripts/dev-datamall.ts --port=8091 --scenario=missed-first-bus --clock=2026-09-21T07:40:00+08:00`.
Without
`--clock`, arrivals are relative to the current time. The missed-bus scenario
returns arrivals at +6/+11/+18 minutes, suitable for an eight-minute access walk.
For supported DataMall bus connections, the live planner advances through the access walk,
ignores arrivals that leave before the commuter reaches the boarding stop, and
replaces the fixed wait with the first fresh monitored arrival. It rechecks later
bus legs after earlier condition delays. Stale, unmonitored or unavailable
arrivals retain a visibly labelled estimated-wait fallback; bus in-vehicle time
is still estimated.

BusArrival, BusStops, BusRoutes, BusServices and GTFS metadata/ZIP downloads are
available, alongside traffic/flood fixtures, a labelled train advisory and empty
crowd/maintenance/road-work feeds. Reference tables contain 501 synthetic rows
to exercise `$skip` pagination (500, 1, then 0 rows); they are contract fixtures,
not a realistic national network. Unknown endpoints return 404.

With the override set, `npm run data:gtfs` exercises the importer using the
authored GTFS ZIP, while `npm run data:buses` exercises complete 500-row
pagination for BusStops, BusRoutes and BusServices. Simulated output is labelled
and restricted to `.cache/` (default `.cache/datamall/`); it cannot replace the
official bundled snapshots.
Download links expire after 15 minutes. Production rejects all base-URL
overrides, and local overrides accept only HTTP `127.0.0.1` addresses.

Run `npx vitest run tests/datamall-simulator.test.ts` for the HTTP and real-planner
regressions, including the fixed-clock Bus 27 missed-first-bus journey.

### Standard checks

```sh
npx playwright install chromium
npm run check
npm test
npm run test:e2e
npm run evaluate
```

Run this full manual gate before submission; no Git hook, push or deployment command runs it automatically. Browser runs use process-isolated local ports, avoiding collisions between concurrent or recently stopped Playwright processes.

Unit tests cover OSM routing, rerouting, closures, lift avoidance, parser nesting, canonical line codes, crowd sources, preferences and input validation. Browser checks cover the mobile-only layout at phone and wide viewports, main interactions, offline reload and automated WCAG A/AA rules. These are **not a substitute for a real-phone field test**; see [demo and phone checklist](docs/DEMO.md).

`npm run evaluate` is a no-cost, reproducible synthetic evaluation. [Recorded local results](docs/evaluation-local.json) include per-case checks and timings. They are not a forecast-accuracy benchmark. To evaluate the team-hosted AI using its credits, run `node --import tsx scripts/evaluate.ts --url=https://weliketrains-191711317812.asia-southeast1.run.app`; without the flag, the local companion is tested.

## Deploy to Google Cloud

See [GCP setup and operations](docs/GCP.md). The provisioned project is `qwiklabs-gcp-02-7df98c2d8335`, Cloud Run region `asia-southeast1`.

Deployments are deliberately manual. GitHub Actions workflows have been removed, so no remote workflow verifies or deploys a push or merge. Pushes and the deployment command do not run tests automatically. When a deployment is explicitly requested, run the guarded local code-deployment script from a clean `main` checkout on the authenticated development device:

```powershell
pwsh -File scripts/deploy-code.ps1
```

The script checks the Cloud Build upload set for protected files, deploys with the existing service identities, labels the service with the source commit, and verifies the resulting `/api/health` endpoint. The container build creates only the required client and server bundles; TypeScript, unit, browser and evaluation checks remain optional local commands. The script does not reimport or rotate secrets.

On the original development device, the personal Codex skill `$weliketrains-deploy` wraps this documented workflow for chat-requested deployments. It is a local convenience, not a repository or clean-clone requirement; `scripts/deploy-code.ps1` and `docs/GCP.md` remain authoritative.

The script below is only for first-time infrastructure setup:

```powershell
gcloud auth login
pwsh -File scripts/deploy-gcp.ps1 -ProjectId YOUR_PROJECT_ID -EnableReminders -EnableAccounts
```

This enables APIs, creates scoped service accounts, imports nonempty `.env` credentials into Secret Manager, deploys Cloud Run, and configures Firestore TTL plus an authenticated five-minute reminder job. It creates billable resources using the project’s credits. Cloud Run scales to zero and is capped at two instances; these settings are **not a spending cap**. Qwiklabs projects can expire; migrate before the lab ends if the URL must remain available.

## What is real, estimated, and experimental

- OSM supplies walking/rail geometry, supplemented by official LTA station exits and covered-linkway/cycling matches. Walking legs retain covered, exposed and unknown distances; those sections are separately visible on the map. Shelter can be preferred or required, while weather temporarily prefers lower exposure without changing the saved setting. DataMall stop sequences and distances drive bus routing; matching OSM bus shapes are optional, while sections without road geometry highlight their served stops without drawing a road path. Rail uses the official planned GTFS timetable; walking, station access and bus running times remain estimates. Fresh bus arrivals and available train realtime updates adjust catchable departures. OneMap supplies display tiles with the bundled OSM fallback. See [current routing data status](docs/ROUTING-DATA-STATUS.md) for exact coverage and limitations.
- Gemini on Vertex AI explains and selects among computed routes and interviews preferences; Cloud Text-to-Speech reads replies. Bounded function calls turn chat input into validated preference proposals or supplied-route recommendations. Routes are computed outside the model, returned IDs are checked, and preference changes require confirmation. A labelled local guide remains available if AI fails.
- The disruption **risk index is rule-based**, not a trained AI predictor or calibrated probability. No historical accuracy claim is made. A lack of signals does not mean disruption is impossible.
- Step-free mode excludes mapped stairs and known station lift outages, but station access, unmapped obstacles and shelter are **not fully verified**. Do not treat this prototype as certified accessible navigation. Rachel is the primary validated persona.
- The bundled DataMall bus graph contains 25,682 accepted stop-to-stop connections across 601 services / 797 directions; 343 gapped or inconsistent-distance adjacencies are rejected. This is not a promise of complete service or islandwide door-to-door coverage: OSM walking access remains limited. Stop sequences without mapped road geometry cannot establish a road-specific traffic effect. Configured normal mode can discover Singapore addresses through Google Place Autocomplete in Wayce's attributed UI; offline/unconfigured mode covers curated landmarks and indexed stops. Road works are out of product scope. Unstructured advisories are shown verbatim, not automatically turned into closures.
- Background alerts require opt-in browser permission and compatible installed-web-app support. Saved routines repeat daily and expire after 30 days. Delivery is not guaranteed when a device or platform restricts push.
- Guest preferences and commutes remain local. Google account sync is optional, uses a server-verified Google identity and persists until the user deletes the account data. Signing out restores the separate guest space. Faux demo accounts never sync or register reminders.
- Foreground browser location is opt-in. Demo mode uses a labelled deterministic position without requesting device permission; live failures remain visible and never become simulated data. Live tracking stops when the active journey closes.

## Engineering notes

- [Submission write-up](WRITEUP.md)
- [Requirement-by-requirement implementation map](docs/REQUIREMENTS.md)
- [End-to-end demo and real-phone acceptance checklist](docs/DEMO.md)
- [Data sources, licences and attribution](docs/DATA-SOURCES.md)
- [Google Cloud deployment and operations](docs/GCP.md)

Submission preparation is active, but no submission or deployment is implied. The root write-up and reproducible setup are present; the external demo recording link and unchecked physical-phone items remain explicit blockers. The referenced supplementary station polygons were not supplied or used; their CRS was not guessed.

OSM-derived data: **© OpenStreetMap contributors**, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution remains visible on the map and in route details. No public OSM tiles or runtime Overpass queries are used. Online visual tiles are provided by **OneMap © contributors | Singapore Land Authority** with the required in-map attribution.
