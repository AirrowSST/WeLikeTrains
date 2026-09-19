# Wayce

A **mobile-only Singapore commuter companion**: a useful decision before you leave, not another transport dashboard.

**Open on your phone:** https://weliketrains-191711317812.asia-southeast1.run.app

The normal app starts in a local guest space with editable preferences and daily commutes. Optional Google sign-in merges that guest data into a verified account for continued syncing. Rachel’s Tampines → Raffles Place commute remains the primary end-to-end demo; Rachel, Arjun and Mdm Lim are isolated faux-account presets under **Account → Developer mode**. Every viewport uses the same one-column interface, bottom navigation and 480px maximum app width. This is an installable web app, not a native app-store build.

## Try it

The app opens as a standard guest using live-mode source labels. No account or API key is required for local routing. To present deterministic scenarios, open **Account**, enable **Developer mode**, then open the demo presets. The places and OSM routes are real; demo incidents, crowd levels, weather and delays are synthetic, not a claim about current service.

1. Open **Account**, enable Developer mode, select Rachel, Arjun or Mdm Lim, and choose **Control · no events** or **Eventful**. Start the demo, then use timeline play/pause, restart, speed and event jumps to compare conditions and recovery.
2. Compare the original and revised route on the detailed OneMap basemap. Swipe route cards for time, crowd and walking trade-offs. Open **Full details** for directions and limitations. When OneMap is unavailable, the map visibly falls back to the bundled OSM extract.
3. In normal Live mode, Wayce requests a one-shot foreground location when it opens, starts with **Where to?**, and defaults departure to **Now**. Permission failures stay visible and the origin remains editable. In a demo, tap **Use simulated location** to preview the labelled position. The active journey can show continuous foreground location until it is closed; progress remains manual and there is no background tracking.
4. Open the companion, consent to sending route context, then type or tap the microphone to dictate a question. Voice input stays as a reviewable draft until you send it; browser speech recognition may use the browser vendor's online service. Review preference changes before applying them, or tap the speaker to hear a reply.
5. **Data & sources → Live feeds** switches to LTA and NEA conditions while place search and routing stay on the bundled OSM snapshot. Each feed reports its own freshness or failure; live failures never silently inject demo data.

## Run from a clean machine

Requires Node.js **22.12+** and npm. The station index, routing graph and offline OSM basemap are committed. When online, the app loads official OneMap Default tiles for detailed map display; search and routing never depend on OneMap or another public provider.

```sh
git clone https://github.com/AirrowSST/WeLikeTrains.git
cd WeLikeTrains
npm ci
npm run build
npm start
```

Open http://localhost:8080. For development, `npm run dev` serves the UI at http://localhost:5173 and the API at port 8080. On a phone, use the deployed HTTPS URL: service workers and background push require a secure origin, unlike an ordinary LAN HTTP address.

Optional: copy `.env.example` to `.env` and fill credentials. Never commit `.env`. Google account sync additionally requires a Google Identity Services web client ID, a server-only session secret and Firestore; live conditions use an LTA credential. The deployed app’s AI/speech use an attached Google service account—no downloadable service-account key is needed. Map display, place search and route computation require no provider credentials.

## Verification

### Local DataMall simulator

The in-app developer timelines run without a separate server or credentials.
They share authored API payload generators with the HTTP simulator, pass transport
payloads through the feed parsers, and never fetch real weather for a timeline.
Both timelines for each profile start at that profile's departure time on
21 September 2026 and last 60 simulated minutes. Control remains clear and
normal; eventful starts a transport event at +5 minutes (Rachel: EWL, Arjun:
NEL, Mdm Lim: Outram Park lift), heavy rain at +12, clear weather at +25 and
transport recovery at +40. These are synthetic exercises, not historical events.
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
For supported OSM bus routes, the live planner advances through the access walk,
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
npm run verify:push
npm run verify
npm run evaluate
```

This is a fast-moving hackathon project: keep checks proportionate and avoid rerunning slow, unaffected suites. `npm run verify:push` runs TypeScript and the unit suite and is the routine pre-push gate installed by `npm ci`. Use targeted browser tests while changing UI behavior. `npm run verify` remains the full gate: it builds fresh client and server assets, then runs the unit and browser suites. Browser runs use process-isolated local ports, avoiding collisions between concurrent or recently stopped Playwright processes.

Unit tests cover OSM routing, rerouting, closures, lift avoidance, parser nesting, canonical line codes, crowd sources, preferences and input validation. Browser checks cover the mobile-only layout at phone and wide viewports, main interactions, offline reload and automated WCAG A/AA rules. These are **not a substitute for a real-phone field test**; see [demo and phone checklist](docs/DEMO.md).

`npm run evaluate` is a no-cost, reproducible synthetic evaluation. [Recorded local results](docs/evaluation-local.json) include per-case checks and timings. They are not a forecast-accuracy benchmark. To evaluate the team-hosted AI using its credits, run `node --import tsx scripts/evaluate.ts --url=https://weliketrains-191711317812.asia-southeast1.run.app`; without the flag, the local companion is tested.

## Deploy to Google Cloud

See [GCP setup and operations](docs/GCP.md). The provisioned project is `qwiklabs-gcp-02-7df98c2d8335`, Cloud Run region `asia-southeast1`.

Deployments are deliberately manual. GitHub Actions workflows have been removed, so no remote workflow verifies or deploys a push or merge. The configured local pre-push hook runs the fast TypeScript-and-unit gate, but it never deploys. When a deployment is explicitly requested, run the guarded local code-deployment script from a clean `main` checkout on the authenticated development device:

```powershell
pwsh -File scripts/deploy-code.ps1
# Explicit time-critical exception:
pwsh -File scripts/deploy-code.ps1 -VerificationMode Fast
```

The default mode runs the complete local verification suite. Explicit `Fast` mode still performs a production build, TypeScript and all unit tests, while skipping Playwright only for a knowingly accepted time-critical release. Both modes check the Cloud Build upload set for protected files, deploy with the existing service identities, label the service with the verification mode and source commit, and verify the resulting `/api/health` endpoint. The script does not reimport or rotate secrets.

On the original development device, the personal Codex skill `$weliketrains-deploy` wraps this documented workflow for chat-requested deployments. It is a local convenience, not a repository or clean-clone requirement; `scripts/deploy-code.ps1` and `docs/GCP.md` remain authoritative.

The script below is only for first-time infrastructure setup:

```powershell
gcloud auth login
pwsh -File scripts/deploy-gcp.ps1 -ProjectId YOUR_PROJECT_ID -EnableReminders -EnableAccounts
```

This enables APIs, creates scoped service accounts, imports nonempty `.env` credentials into Secret Manager, deploys Cloud Run, and configures Firestore TTL plus an authenticated five-minute reminder job. It creates billable resources using the project’s credits. Cloud Run scales to zero and is capped at two instances; these settings are **not a spending cap**. Qwiklabs projects can expire; migrate before the lab ends if the URL must remain available.

## What is real, estimated, and experimental

- OSM geometry, local station search, graph search, first/last walking legs and the live official condition-feed adapters are implemented. Official OneMap tiles provide the detailed online visual basemap, with committed OSM vectors as the offline fallback. Travel times are estimates, not official timetables.
- Gemini on Vertex AI explains and selects among computed routes and interviews preferences; Cloud Text-to-Speech reads replies. Bounded function calls turn chat input into validated preference proposals or supplied-route recommendations. Routes are computed outside the model, returned IDs are checked, and preference changes require confirmation. A labelled local guide remains available if AI fails.
- The disruption **risk index is rule-based**, not a trained AI predictor or calibrated probability. No historical accuracy claim is made. A lack of signals does not mean disruption is impossible.
- Step-free mode excludes mapped stairs and known station lift outages, but station access, unmapped obstacles and shelter are **not fully verified**. Do not treat this prototype as certified accessible navigation. Rachel is the primary validated persona.
- The map's bundled DataMall reference snapshot covers all bus stops and service/route rows returned by the three official endpoints at its recorded access date. Door-to-door routing geometry still covers rail and selected OSM bus relations, not every bus or address in Singapore; the reference snapshot does not manufacture missing road geometry. Place search covers the curated landmarks and named stops in the routable extract. Planned road-work notices are informational without verified route geometry. Unstructured advisories are shown verbatim, not automatically turned into closures.
- Background alerts require opt-in browser permission and compatible installed-web-app support. Saved routines repeat daily and expire after 30 days. Delivery is not guaranteed when a device or platform restricts push.
- Guest preferences and commutes remain local. Google account sync is optional, uses a server-verified Google identity and persists until the user deletes the account data. Signing out restores the separate guest space. Faux demo accounts never sync or register reminders.
- Foreground browser location is opt-in. Demo mode uses a labelled deterministic position without requesting device permission; live failures remain visible and never become simulated data. Live tracking stops when the active journey closes.

## Engineering notes

- [Requirement-by-requirement implementation map](docs/REQUIREMENTS.md)
- [End-to-end demo and real-phone acceptance checklist](docs/DEMO.md)
- [Data sources, licences and attribution](docs/DATA-SOURCES.md)
- [Google Cloud deployment and operations](docs/GCP.md)

The organiser's submission instructions are available to the team at `C:\Users\Yaw Tia\Downloads\README.md`. **Do not prepare the submission write-up or submit this project yet:** the user has explicitly deferred that work pending human polishing. See [agent handoff](AGENTS.md). The referenced supplementary station polygons were not supplied or used; their CRS was not guessed. A physical-phone field test remains to be completed by the team.

OSM-derived data: **© OpenStreetMap contributors**, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution remains visible on the map and in route details. No public OSM tiles or runtime Overpass queries are used. Online visual tiles are provided by **OneMap © contributors | Singapore Land Authority** with the required in-map attribution.
