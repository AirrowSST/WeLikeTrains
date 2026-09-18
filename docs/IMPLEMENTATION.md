# Implementation tracker

Primary journey: Rachel, Tampines to Raffles Place, 07:40 departure / 08:45 deadline. Additional profiles: Arjun (comfort/cycle), Mdm Lim (step-free / low walking speed).

## Scope
- Mobile-only PWA: one column, bottom navigation and 480px maximum app width at every viewport; actual OSM graph routing and door-to-door legs; OneMap live itinerary adapter.
- Explicit foreground browser location can set the trip origin and display a device-position marker. Active live tracking stops with the journey dialog; manual step confirmation remains authoritative. Demo mode uses deterministic, visibly labelled simulated positions and never requests geolocation permission.
- Original vs alternative route map, affected segments, text-labelled crowds, uncertainty.
- Live LTA adapters with canonical lines, independent health/freshness and cached weather; labelled deterministic replay.
- Planned events, lift outages, rain and crowd forecasts affect route ranking.
- Grounded Vertex AI assistant with bounded function calls for preference proposals and supplied-route recommendations, recent conversational context, speech, transparent disruption-risk estimation and reproducible evaluation.
- Local routine/journey persistence, opt-in background web push with Firestore + Cloud Scheduler.
- Cloud Run, Secret Manager, least-privilege service accounts, deployment script.
- Requirements matrix, assumptions, data licences, demo and clean-machine instructions.

## Constraints discovered
The remote was initially empty. The organiser's referenced PS2/data and PS2/references remain absent. Submission instructions were subsequently supplied at `C:\Users\Yaw Tia\Downloads\README.md` for future context only; the user explicitly deferred write-up/submission pending human polishing. Google Cloud CLI, authenticated access, Secret Manager integrations and Cloud Run deployment are now configured. OSM data is fetched during explicit maintenance and bundled; no runtime public tile/Overpass dependency.

## Engineering verification — 2026-09-18

- The mobile journey map now distinguishes walking, bus, rail and cycling geometry with mode icons, labels and a compact legend; selected endpoints and a small set of Singapore landmarks provide orientation. Weather-affected walking areas use clearly labelled, approximate rain highlights rather than claiming radar-level precision.
- Official OneMap tiles now provide complete online road, building and place context across Singapore. The committed OSM vectors remain underneath as an offline fallback, and reduced detail is visibly labelled if OneMap tiles fail.
- Production build and TypeScript pass.
- 20 unit tests pass, including real OSM Rachel/Arjun/Mdm Lim routes, DTL crowd-code join, location handling and server validation of chat tool calls.
- All 12 Chromium browser checks pass across phone and wide-screen mobile-only UI when run in project-scoped groups, including foreground/simulated location, 320px no-overflow, main journey/chat/preference/save flows, initial-screen axe and large-text/offline reload. The agent command runner terminated the Playwright-managed server during the longer combined run; the same checks passed in shorter grouped runs.
- Local evaluation: nine synthetic journeys plus six preference cases. Two routing checks currently fail because every candidate in the Rachel/rain and Arjun/rain fixtures is marked blocked for unsafe exposed walking; the preference cases pass. Previously recorded cloud evaluation used Vertex AI for all nine journey cases. `docs/evaluation-*.json` contain exact outputs, not a general AI accuracy claim. Model-generated prose still needs human review.
- Hosted Cloud TTS returned MP3; real LTA/OneMap integrations were exercised. Scheduler completed successfully; anonymous reminder calls return 401 and invalid plan bodies return 400.
- Local Vertex function calling was exercised with a combined crowd, walking-limit and route-choice request. Preference arguments and route IDs are validated on the server, and changes remain proposals until the user confirms them.
- Physical-phone, spoken-audio listening, lock-screen push delivery and walked-route verification remain human QA tasks. Accessibility route certification, trained disruption probabilities and final submission materials are not claimed.

## Next session

Read `AGENTS.md`. Human polishing is pending. Do not restart the app architecture, introduce a desktop dashboard or prepare the deferred write-up. Google model access can change: configured Gemini 3.5 returned 429, while Gemini 2.5 Flash worked in this project; the model remains environment-configurable.
