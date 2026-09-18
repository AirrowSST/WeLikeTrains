# Wayce

A **mobile-only Singapore commuter companion**: a useful decision before you leave, not another transport dashboard.

**Open on your phone:** https://weliketrains-191711317812.asia-southeast1.run.app

Rachel’s Tampines → Raffles Place commute is the primary end-to-end journey. Arjun and Mdm Lim are selectable in the profile button. Every viewport uses the same one-column interface, bottom navigation and 480px maximum app width. This is an installable web app, not a native app-store build.

## Try it

The app opens in clearly labelled **Demo experience** mode with an injected EWL signalling disruption. The places and OSM routes are real; demo incidents, crowd levels and delays are synthetic, not a claim about current service. No account or API key is required to judge this path.

1. Read Rachel’s recommendation at the top. Change the demo scenario to compare normal service, disruption, crowds, rain, closure or lift maintenance.
2. Compare the original and revised route on the OSM map. Swipe route cards for time, crowd and walking trade-offs. Open **Full details** for directions and limitations.
3. Tap **Use simulated location** to preview the labelled demo position, then start the step-by-step journey. In Live mode, **Use my location** requests browser permission and the active journey can show foreground location until it is closed. Progress remains manual; there is no background tracking.
4. Open the companion, consent to sending route context, ask why this route or describe your preferences. Review changes before applying them. Tap the speaker to listen.
5. **Data & sources → Live feeds** switches to LTA and NEA conditions while map display, place search and routing stay on the bundled OSM snapshot. Each feed reports its own freshness or failure; live failures never silently inject demo data.

## Run from a clean machine

Requires Node.js **22.12+** and npm. The OSM map, station index and routing graph are committed; no third-party map, geocoding or routing service is contacted at runtime.

```sh
git clone https://github.com/AirrowSST/WeLikeTrains.git
cd WeLikeTrains
npm ci
npm run build
npm start
```

Open http://localhost:8080. For development, `npm run dev` serves the UI at http://localhost:5173 and the API at port 8080. On a phone, use the deployed HTTPS URL: service workers and background push require a secure origin, unlike an ordinary LAN HTTP address.

Optional: copy `.env.example` to `.env` and fill credentials. Never commit `.env`. The deployed app can use an LTA credential for live conditions and an attached Google service account for AI and speech—no downloadable service-account key is needed. Map display, place search and route computation require no provider credentials.

## Verification

```sh
npx playwright install chromium
npm run verify
npm run evaluate
```

`npm run verify` builds fresh client and server assets before running the unit and browser suites. `npm ci` also configures the repository's pre-push hook to run the same verification locally. Unit tests cover OSM routing, rerouting, closures, lift avoidance, parser nesting, canonical line codes, crowd sources, preferences and input validation. Browser checks cover the mobile-only layout at phone and wide viewports, main interactions, offline reload and automated WCAG A/AA rules. These are **not a substitute for a real-phone field test**; see [demo and phone checklist](docs/DEMO.md).

`npm run evaluate` is a no-cost, reproducible synthetic evaluation. [Recorded local results](docs/evaluation-local.json) include per-case checks and timings. They are not a forecast-accuracy benchmark. To evaluate the team-hosted AI using its credits, run `node --import tsx scripts/evaluate.ts --url=https://weliketrains-191711317812.asia-southeast1.run.app`; without the flag, the local companion is tested.

## Deploy to Google Cloud

See [GCP setup and operations](docs/GCP.md). The provisioned project is `qwiklabs-gcp-02-7df98c2d8335`, Cloud Run region `asia-southeast1`.

Deployments are deliberately manual. GitHub Actions workflows have been removed, so no remote workflow verifies or deploys a push or merge. The configured local pre-push hook still runs verification, but it never deploys. When a deployment is explicitly requested, run the guarded local code-deployment script from a clean `main` checkout on the authenticated development device:

```powershell
pwsh -File scripts/deploy-code.ps1
```

The script runs the complete local verification suite, checks the Cloud Build upload set for protected files, deploys the source with the existing service identities, and verifies the resulting `/api/health` endpoint. It does not reimport or rotate secrets.

On the original development device, the personal Codex skill `$weliketrains-deploy` wraps this documented workflow for chat-requested deployments. It is a local convenience, not a repository or clean-clone requirement; `scripts/deploy-code.ps1` and `docs/GCP.md` remain authoritative.

The script below is only for first-time infrastructure setup:

```powershell
gcloud auth login
pwsh -File scripts/deploy-gcp.ps1 -ProjectId YOUR_PROJECT_ID -EnableReminders
```

This enables APIs, creates scoped service accounts, imports nonempty `.env` credentials into Secret Manager, deploys Cloud Run, and configures Firestore TTL plus an authenticated five-minute reminder job. It creates billable resources using the project’s credits. Cloud Run scales to zero and is capped at two instances; these settings are **not a spending cap**. Qwiklabs projects can expire; migrate before the lab ends if the URL must remain available.

## What is real, estimated, and experimental

- OSM geometry, local station search, graph search, first/last walking legs and the live official condition-feed adapters are implemented. The map and routes are served with the application; travel times are estimates, not official timetables.
- Gemini on Vertex AI explains and selects among computed routes and interviews preferences; Cloud Text-to-Speech reads replies. Bounded function calls turn chat input into validated preference proposals or supplied-route recommendations. Routes are computed outside the model, returned IDs are checked, and preference changes require confirmation. A labelled local guide remains available if AI fails.
- The disruption **risk index is rule-based**, not a trained AI predictor or calibrated probability. No historical accuracy claim is made. A lack of signals does not mean disruption is impossible.
- Step-free mode excludes mapped stairs and known station lift outages, but station access, unmapped obstacles and shelter are **not fully verified**. Do not treat this prototype as certified accessible navigation. Rachel is the primary validated persona.
- The bundled transit extract covers rail and selected bus routes, not every bus or address in Singapore. Place search covers the curated landmarks and named stops in that extract. Planned road-work notices are informational without verified route geometry. Unstructured advisories are shown verbatim, not automatically turned into closures.
- Background alerts require opt-in browser permission and compatible installed-web-app support. Saved routines repeat daily and expire after 30 days. Delivery is not guaranteed when a device or platform restricts push.
- Foreground browser location is opt-in. Demo mode uses a labelled deterministic position without requesting device permission; live failures remain visible and never become simulated data. Live tracking stops when the active journey closes.

## Engineering notes

- [Requirement-by-requirement implementation map](docs/REQUIREMENTS.md)
- [End-to-end demo and real-phone acceptance checklist](docs/DEMO.md)
- [Data sources, licences and attribution](docs/DATA-SOURCES.md)
- [Google Cloud deployment and operations](docs/GCP.md)

The organiser's submission instructions are available to the team at `C:\Users\Yaw Tia\Downloads\README.md`. **Do not prepare the submission write-up or submit this project yet:** the user has explicitly deferred that work pending human polishing. See [agent handoff](AGENTS.md). The referenced supplementary station polygons were not supplied or used; their CRS was not guessed. A physical-phone field test remains to be completed by the team.

OSM-derived data: **© OpenStreetMap contributors**, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution remains visible on the map and in route details. No public OSM tiles or runtime Overpass queries are used.
