# WeLikeTrains

A **mobile-only Singapore commuter companion**: a useful decision before you leave, not another transport dashboard.

**Open on your phone:** https://weliketrains-191711317812.asia-southeast1.run.app

Rachel’s Tampines → Raffles Place commute is the primary end-to-end journey. Arjun and Mdm Lim are selectable in the profile button. Every viewport uses the same one-column interface, bottom navigation and 480px maximum app width. This is an installable web app, not a native app-store build.

## Try it

The app opens in clearly labelled **Demo experience** mode with an injected EWL signalling disruption. The places and OSM routes are real; demo incidents, crowd levels and delays are synthetic, not a claim about current service. No account or API key is required to judge this path.

1. Read Rachel’s recommendation at the top. Change the demo scenario to compare normal service, disruption, crowds, rain, closure or lift maintenance.
2. Compare the original and revised route on the OSM map. Swipe route cards for time, crowd and walking trade-offs. Open **Full details** for directions and limitations.
3. Save the commute and start the step-by-step journey. Progress is manual; the app does not track GPS.
4. Open the companion, consent to sending route context, ask why this route or describe your preferences. Review changes before applying them. Tap the speaker to listen.
5. **Data & sources → Live feeds** switches to LTA, OneMap and NEA. Each feed reports its own freshness or failure; live failures never silently inject demo data.

## Run from a clean machine

Requires Node.js **22.12+** and npm. The OSM extract is committed; no map download, Google account or paid service is needed for local demo routing.

```sh
git clone https://github.com/AirrowSST/WeLikeTrains.git
cd WeLikeTrains
npm ci
npm run build
npm start
```

Open http://localhost:8080. For development, `npm run dev` serves the UI at http://localhost:5173 and the API at port 8080. On a phone, use the deployed HTTPS URL: service workers and background push require a secure origin, unlike an ordinary LAN HTTP address.

Optional: copy `.env.example` to `.env` and fill credentials. Never commit `.env`. The deployed app already has the supplied LTA and OneMap credentials in Google Secret Manager and uses an attached Google service account for AI and speech—no downloadable service-account key is needed.

## Verification

```sh
npm test
npm run evaluate
npx playwright install chromium
npm run test:e2e
```

The build type-checks client and server. Unit tests cover OSM routing, rerouting, closures, lift avoidance, parser nesting, canonical line codes, crowd sources, preferences and input validation. Browser checks cover the mobile-only layout at phone and wide viewports, main interactions, offline reload and automated WCAG A/AA rules. These are **not a substitute for a real-phone field test**; see [demo and phone checklist](docs/DEMO.md).

`npm run evaluate` is a no-cost, reproducible synthetic evaluation. [Recorded local results](docs/evaluation-local.json) include per-case checks and timings. They are not a forecast-accuracy benchmark. To evaluate the team-hosted AI using its credits, run `node --import tsx scripts/evaluate.ts --url=https://weliketrains-191711317812.asia-southeast1.run.app`; without the flag, the local companion is tested.

## Deploy to Google Cloud

See [GCP setup and operations](docs/GCP.md). The provisioned project is `qwiklabs-gcp-02-7df98c2d8335`, Cloud Run region `asia-southeast1`.

```powershell
gcloud auth login
pwsh -File scripts/deploy-gcp.ps1 -ProjectId YOUR_PROJECT_ID -EnableReminders
```

This enables APIs, creates scoped service accounts, imports nonempty `.env` credentials into Secret Manager, deploys Cloud Run, and configures Firestore TTL plus an authenticated five-minute reminder job. It creates billable resources using the project’s credits. Cloud Run scales to zero and is capped at two instances; these settings are **not a spending cap**. Qwiklabs projects can expire; migrate before the lab ends if the URL must remain available.

## What is real, estimated, and experimental

- OSM geometry, graph search, first/last walking legs, the live official-feed adapters and the OneMap itinerary integration are implemented. OSM fallback travel times are estimates, not official timetables.
- Gemini on Vertex AI explains and selects among computed routes and interviews preferences; Cloud Text-to-Speech reads replies. Routes are computed outside the model, returned IDs are checked, and preference changes require confirmation. A labelled local guide remains available if AI fails.
- The disruption **risk index is rule-based**, not a trained AI predictor or calibrated probability. No historical accuracy claim is made. A lack of signals does not mean disruption is impossible.
- Step-free mode excludes mapped stairs and known station lift outages, but station access, unmapped obstacles and shelter are **not fully verified**. Do not treat this prototype as certified accessible navigation. Rachel is the primary validated persona.
- The bundled transit extract covers rail and selected bus routes, not every bus in Singapore. OneMap provides broader live coverage. Planned road-work notices are informational without verified route geometry. Unstructured advisories are shown verbatim, not automatically turned into closures.
- Background alerts require opt-in browser permission and compatible installed-web-app support. Saved routines repeat daily and expire after 30 days. Delivery is not guaranteed when a device or platform restricts push.

## Engineering notes

- [Requirement-by-requirement implementation map](docs/REQUIREMENTS.md)
- [End-to-end demo and real-phone acceptance checklist](docs/DEMO.md)
- [Data sources, licences and attribution](docs/DATA-SOURCES.md)
- [Google Cloud deployment and operations](docs/GCP.md)

The organiser's submission instructions are available to the team at `C:\Users\Yaw Tia\Downloads\README.md`. **Do not prepare the submission write-up or submit this project yet:** the user has explicitly deferred that work pending human polishing. See [agent handoff](AGENTS.md). The referenced supplementary station polygons were not supplied or used; their CRS was not guessed. A physical-phone field test remains to be completed by the team.

OSM-derived data: **© OpenStreetMap contributors**, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution remains visible on the map and in route details. No public OSM tiles or runtime Overpass queries are used.
