# Implementation tracker

Primary journey: Rachel, Tampines to Raffles Place, 07:40 departure / 08:45 deadline. Additional profiles: Arjun (comfort/cycle), Mdm Lim (step-free / low walking speed).

## Scope

- Mobile-only PWA: one column, bottom navigation and 480px maximum app width at every viewport; official OneMap tiles for detailed online display, a committed OSM fallback, and local named-stop search, graph routing and door-to-door legs.
- Explicit foreground browser location can set the trip origin and display a device-position marker. Active live tracking stops with the journey dialog; manual step confirmation remains authoritative. Demo mode uses deterministic, visibly labelled simulated positions and never requests geolocation permission.
- Original vs alternative route map, affected segments, text-labelled crowds, uncertainty.
- Live LTA adapters with canonical lines, independent health/freshness and cached weather; labelled deterministic replay.
- Planned events, lift outages, rain and crowd forecasts affect route ranking.
- Grounded Vertex AI assistant with bounded function calls for preference proposals, supplied-route recommendations and validated in-chat route cards, recent conversational context, speech, transparent disruption-risk estimation and reproducible evaluation.
- Local routine/journey persistence, opt-in background web push with Firestore + Cloud Scheduler.
- Guest-first preferences and multiple daily commutes, with optional server-verified Google sign-in that merges guest state into a Firestore-backed account. Rachel, Arjun and Mdm Lim are isolated faux accounts under Options → Developer mode, with deterministic location, scenario and custom weather state that is discarded on exit.
- Cloud Run, Secret Manager, least-privilege service accounts, first-time infrastructure setup and guarded manual code deployment from the authenticated development device.
- Requirements matrix, assumptions, data licences, demo and clean-machine instructions.

## Constraints discovered

The remote was initially empty. The organiser's referenced PS2/data and PS2/references remain absent. Submission instructions were subsequently supplied at `C:\Users\Yaw Tia\Downloads\README.md` for future context only; the user explicitly deferred write-up/submission pending human polishing. Google Cloud CLI, authenticated access, Secret Manager integrations and Cloud Run deployment are now configured. OSM data is fetched during explicit maintenance and bundled; OneMap is the only runtime public map-tile dependency and the app does not query Overpass at runtime.

## Engineering verification — 2026-09-19

- Online map display uses official OneMap Default tiles across the documented whole-Singapore bounds. The committed OSM vectors remain a visible offline/failure fallback. Place search and route computation use only committed OSM-derived files; OneMap is not used for geocoding, authentication or itineraries. Search coverage is deliberately limited to curated places and named stops in the extract.
- Navigate search now keeps all ten curated destinations in the default list, returns up to twelve ranked matches, prioritises exact rail stations over loosely matching bus stops, and matches word prefixes instead of arbitrary substrings. This prevents supported locations such as Tampines MRT from being hidden and avoids false results such as `NTU` matching the middle of “Century.” Locations outside the curated catalog and committed named-stop index remain unavailable until explicitly added to the local dataset.
- Leave and arrival time controls now open a Wayce-styled, accessible time dialog instead of the browser's visually inconsistent native picker. The dialog provides large hour/minute steppers, an AM/PM toggle, explicit Cancel/Set actions and touch targets sized for the phone interface.
- Pedestrian routing now indexes every substantial connected component in the bundled OSM extract, while matching both ends of a walking leg to the same component. This restores searched western journeys such as NTU to Raffles Place without treating small isolated indoor paths as routable coverage.
- The product name shown in the interface, install metadata, notifications and companion identity is now Wayce. Public Sans is bundled locally as the single interface typeface, including its italic variable font and OFL licence.
- The mobile journey sheet below the map can be dragged between expanded, half-open and collapsed positions from either the grab handle or the full Navigate header, which gives touch users a reliable target. The preferences button remains independently clickable, and the visible handle supports keyboard snapping with Arrow Up/Down and Home/End.
- The Navigate form removes decorative origin, destination, time, location and action icons, uses title-case “Leave” and “Arrive” labels with quieter typography, and omits the redundant origin/destination swap action. Preferences remains available as a labelled text control.
- The mobile journey map now distinguishes walking, bus, rail and cycling geometry with mode icons, labels and a compact legend; selected endpoints and a small set of Singapore landmarks provide orientation. Weather-affected walking areas use clearly labelled, approximate rain highlights rather than claiming radar-level precision.
- When conditions change the recommended route, the map now keeps the full original route as a muted dashed line, marks only the affected original subsection with a distinct dotted treatment and text label, and draws the revised route as the dominant solid path. A targeted browser regression checks all three layers on phone and wide viewports.
- Every primary route card now shows a text-labelled low, moderate, high or unknown crowd state. The main recommendation banner displays the planner's actionable reason and timing advice directly instead of only reporting route count and arrival time.
- Plans now carry an explicit `travelDecision`. If every mapped option is blocked by unsafe heavy weather, Wayce returns `wait`, tells the commuter to wait and re-plan, labels the first card accordingly, and does not append misleading arrival or earlier-departure advice to the blocked route preview.
- The detailed OneMap layer is visibly labelled as online data and carries the required SLA attribution. The compact committed OSM vectors remain underneath it and are visibly labelled when used as the offline fallback.
- Production build and TypeScript pass.
- 33 unit tests pass, including deployment guardrails, real OSM Rachel/Arjun/Mdm Lim routes, DTL crowd-code join, safe heavy-weather decisions, location handling, session tamper/expiry handling, demo/account validation boundaries and server validation of chat tool calls.
- Browser coverage stubs OneMap tiles so tests remain deterministic and no live provider is required. It separately checks the detailed online state and bundled offline fallback alongside local search/routing, account/demo isolation, the resizable one-column layout, chat route cards, foreground/simulated location, 320px no-overflow, axe and offline reload. The previous 20 Chromium checks passed when run as separate projects; a targeted Google sign-in timestamp regression also passed.
- Local evaluation: nine synthetic journeys plus six preference cases pass their structural checks. Rachel/rain and Arjun/rain remain blocked route previews, but now pass because the typed decision is explicitly `wait`, not because the routes were relabelled as usable. Previously recorded cloud evaluation used Vertex AI for all nine journey cases. `docs/evaluation-*.json` contain exact outputs, not a general AI accuracy claim. Model-generated prose still needs human review.
- Hosted Cloud TTS returned MP3 and the real LTA integration was exercised. Scheduler completed successfully; anonymous reminder calls return 401 and invalid plan bodies return 400.
- Local Vertex function calling was exercised with a combined crowd, walking-limit and route-choice request. Preference arguments and route IDs are validated on the server, and changes remain proposals until the user confirms them.
- Chat route-list requests use `display_routes`; the server accepts only supplied, unblocked route IDs and the client renders timing, arrival, legs, walking, transfers and crowd information from its computed plan.
- Physical-phone, spoken-audio listening, lock-screen push delivery and walked-route verification remain human QA tasks. Accessibility route certification, trained disruption probabilities and final submission materials are not claimed.
- Google’s real sign-in popup was exercised locally with an authorised Web OAuth client and a consenting test account. Preference and saved-commute writes reached Firestore, and logout followed by re-login restored the account state while keeping the guest space separate. Cross-device and deployed-production account sync remain unverified.

## Deployment status — 2026-09-19

- The user chose manual-only deployment from the authenticated development device. Both GitHub Actions workflows were removed; pushes and merges no longer start remote checks or deploy production. The local pre-push verification hook remains, and deployment requires a new explicit request in chat.
- Hackathon iteration speed is now an explicit engineering rule. Routine direct-to-`main` pushes run `npm run verify:push` (TypeScript and unit tests) instead of the full browser matrix. Relevant targeted browser tests still accompany UI changes, while `npm run verify` remains required by the deployment path and appropriate for broad integration or milestone checks.
- `scripts/deploy-code.ps1` is the guarded code-update path: clean `main` source by default, full local verification, protected-file upload inspection, Cloud Run source deployment, ready-revision inspection and application health check.
- The device-local `$weliketrains-deploy` Codex skill records the same explicit-request workflow, failure diagnosis and post-deployment checks. It delegates routine mutation to the repository script and is optional personal tooling rather than a clean-clone dependency.
- The container build now skips lifecycle scripts during dependency installation because the package `prepare` hook configures workstation Git hooks and cannot run inside the intentional Git-free build context. Temporary `gha-creds-*.json` files and the unrelated root `temp.txt` are excluded from Cloud Build and Docker contexts.
- The former GitHub Workload Identity resources may remain unused in the temporary GCP project. They were not torn down as part of this code change.
- The manual path was exercised after an explicit user request using the dirty-tree override. Regional Cloud Build `12683414-b6bb-41ce-a1af-54ea2f6f8472` succeeded, Cloud Run revision `weliketrains-00011-qzt` received 100% of traffic, `/api/health` returned `ok`, and the canonical public URL returned HTTP 200 with the Wayce page title. This proves the manual deployment path but not repository reproducibility until the deployed local changes are committed.

## Next session

Read `AGENTS.md`. Human polishing is pending. Do not restart the app architecture, introduce a desktop dashboard or prepare the deferred write-up. Do not recreate GitHub Actions or deploy without an explicit user request; use the guarded local deployment script when asked. Google model access can change: configured Gemini 3.5 returned 429, while Gemini 2.5 Flash worked in this project; the model remains environment-configurable.

Normal use now starts as Guest. Local Google account sync is configured and its sign-in/logout persistence flow has been exercised; production still needs the account environment and secret bindings deployed before claiming hosted account support. Developer-mode persona state must remain synthetic, visibly labelled and isolated from guest/account persistence.
