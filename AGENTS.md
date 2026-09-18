# WeLikeTrains — AI-first development guide

This repository is intended for repeated human/AI collaboration. Treat this file as the starting context, not as permission to expand scope, submit the project or claim unperformed tests.

## User decisions — retain these

- This is a **MOBILE-ONLY web app**, not a desktop dashboard. Keep one column, bottom navigation, comfortable touch targets and the same phone interface on wide screens (maximum width 480px).
- Rachel (Tampines → Raffles Place, 07:40 / 08:45) is primary. Keep Arjun and Mdm Lim selectable.
- User decided on 2026-09-19 that normal use starts in a standard local guest space. Rachel, Arjun and Mdm Lim are isolated faux-account presets under **Options → Developer mode**; presets may inject labelled synthetic time, location, disruptions and custom weather, and must restore the real guest/signed-in state on exit. Google sign-in merges guest preferences and daily commutes into a verified account; demo state must never sync.
- User approved foreground location services on 2026-09-18. Device location requires an explicit user action, live tracking runs only while the active journey dialog is open, journey progress stays manual, and demo mode uses clearly labelled deterministic simulated locations. Do not add background location tracking or silently substitute demo coordinates after a live failure.
- App hosting/backend/AI are on Google Cloud project `qwiklabs-gcp-02-7df98c2d8335`, Cloud Run `weliketrains`, region `asia-southeast1`.
- User decided on 2026-09-19 that all GitHub Actions workflows are removed. Verification and production deployment are manual only. Deploy from this authenticated device only after an explicit request in chat, using `scripts/deploy-code.ps1`; never infer deployment authority from a push, commit or completed test run. The device-local Codex skill `$weliketrains-deploy` records this workflow and its authorization boundary, but the repository script and docs remain the portable sources of truth.
- User decided on 2026-09-19 that competition work should be committed and pushed directly to `main`; do not require pull requests or restore branch protection unless the user asks. Preserve unrelated or in-progress working-tree changes, keep the local pre-push verification gate, and remember that pushing to `main` is not deployment authorization.
- **Hackathon pace is an explicit priority.** Prefer the smallest coherent change and the smallest proportionate verification that gives useful confidence; do not repeatedly run slow, unaffected suites by default. Routine pushes use `npm run verify:push` (TypeScript plus unit tests), not the full browser suite. **Playwright/browser testing is deliberately deprioritized during routine iteration:** run it only for an affected user-facing flow, a meaningful UI/integration risk, an explicit request, or before deployment/milestone validation. Do not run the entire browser suite merely because a change touches frontend code. Keep `npm run verify` for deployment, broad integration changes, milestone checks or an explicit request. Fast iteration never permits skipping a relevant regression test, weakening credential/privacy boundaries or making unsupported claims.
- User explicitly said on 2026-09-18: **do not do the submission write-up now; we are not about to submit; human polishing is pending**. Do not infer submission authority from the reference documents. Existing demo/checklist and requirements documents are engineering notes, not a final submission.
- Problem brief: `C:\Users\Yaw Tia\Downloads\PS2_README (1).md`.
- Organiser submission context, supplied for future agents: `C:\Users\Yaw Tia\Downloads\README.md`. Read it when relevant, but do not prepare/write/submit deliverables unless the user later asks.
- Future submission context only: organiser expects runnable source/README, a root `WRITEUP.md`, and a linked phone-sized demo recording (not a committed large video). Setup must work from a fresh clone; credentials must stay out of all history; any claimed results must be reproducible without a judge paying. Logistics/deadline/access are still marked TBC in the supplied document.

## Working safely

- `.env` contains real user credentials and is ignored. Never print, commit, replace or upload it. `.local` and `.cache` are also ignored. Use `.env.example` for setup documentation.
- Google Cloud CLI is locally installed in `.local/gcloud/google-cloud-sdk/bin/gcloud.cmd`; user signed in. Runtime uses attached service identity, not a downloaded key.
- Demo disruptions/crowds are synthetic and must remain labelled. OSM geometry is real. Live failures must not silently become demo data.
- The risk index is rule-based, not trained disruption prediction. Accessibility remains explicitly unverified. Keep these limitations honest.
- Do not claim a real-phone field test has happened. Playwright/axe checks are automated only.
- Do not refetch public Overpass data in tests, at startup or on each request. Bundled OSM files and provenance are committed; refresh is explicit.

## Validation and operations

`npm run build`, `npm test`, `npm run test:e2e`, `npm run evaluate`. Build includes TypeScript. Browser tests expect compiled assets and start/reuse port 8080. Development UI is 5173.

See `docs/GCP.md` for deployment. Code-only redeploy retains secret bindings. Deployment is manual from this authenticated device and requires an explicit user request; Git pushes never deploy. The configured local pre-push hook runs the fast `npm run verify:push` gate; no remote GitHub workflow runs. This is a temporary Qwiklabs project; do not promise permanent hosting. Git remote is `https://github.com/AirrowSST/WeLikeTrains`.

## Default development cycle

1. Read this file, the root README, `docs/IMPLEMENTATION.md`, and the smallest relevant source/test files. Check `git status` before editing; preserve user changes. Do not load secrets to discover architecture.
2. Identify the user-visible outcome and a bounded implementation plan. Ask about materially ambiguous product changes; use established decisions for ordinary implementation details. Distinguish “diagnose/review” from authorization to change or deploy.
3. Add or update a failing regression test when fixing a bug. Keep types and request validation synchronized. Reuse existing React/TypeScript, Express and Leaflet patterns instead of replacing the stack.
4. Implement the smallest coherent change. Keep functions/modules understandable to the next agent. Do not use a language model for geometry, transport connectivity or fabricated live facts.
5. Verify proportionally: TypeScript/build and relevant unit tests first. Treat Playwright/browser checks as a targeted, later-stage validation—not a default requirement for every UI edit—and run only the affected flow when the change warrants it. Check mobile at 320px and normal phone widths when doing browser validation; wide screens must remain phone-sized. Run the local evaluation for routing/preference/AI-contract changes. Tests must not require live paid services.
6. For integration work, separately verify configured vs actually functioning providers. Keep optional cloud evaluation explicit; inspect actual provider labels and never report local fallback as successful Gemini inference. Preserve anonymous Scheduler rejection and credential boundaries.
7. Review the diff for secrets, accidental scope expansion, demo/live confusion, accessibility regressions and unsupported claims. Update engineering notes when behavior changes. Make commits only for owned changes; do not discard or amend human work.
8. Handoff with changed behavior, exact checks/results, remaining limitations and safe next steps. Do not say “done” solely because a build passed. Record durable decisions here and implementation status in `docs/IMPLEMENTATION.md`; do not accumulate transcripts or credentials.

## Architecture map

| Area | Source of truth |
|---|---|
| Mobile UI, profiles, local storage, consent, chat | `src/App.tsx`, `src/styles.css` |
| OSM map and route overlays | `src/Map.tsx` |
| Shared contracts / persona defaults / line aliases | `shared/types.ts`, `shared/catalog.ts` |
| Explainable, non-probabilistic risk index | `shared/risk.ts` |
| Walking/cycling A*, transit graph and local timings | `server/network.ts` |
| Condition-aware candidates, ranking and comparison | `server/planner.ts` |
| Official feed parsing, freshness, labelled demo | `server/feeds.ts` |
| OneMap, Vertex AI, validated preferences and TTS | `server/providers.ts` |
| API validation and middleware | `server/validation.ts`, `server/index.ts` |
| Consented reminders, OIDC and retention | `server/notifications.ts` |
| Offline assets / notification handling | `public/sw.js` |
| OSM rebuild and provenance | `scripts/import-osm.mjs`, `data/OSM-PROVENANCE.json` |
| Cloud infrastructure setup and manual code deployment | `scripts/deploy-gcp.ps1`, `scripts/deploy-code.ps1`, `Dockerfile`, `docs/GCP.md` |

## AI and data guardrails

- Gemini may explain/rank only supplied, unblocked route IDs. Validate returned IDs and preference fields on the server. User confirmation is required before applying preference proposals.
- Gemini chat function calls are limited to validated preference proposals and supplied-route recommendations. Keep the tool loop bounded, return tool results to the model, and never let a tool call silently apply preferences or execute arbitrary user instructions.
- Route-list requests in chat use the validated `display_routes` function and render cards from the app's current computed plan. The model may select and order only supplied, unblocked route IDs; it does not author route facts.
- Unknown crowd/accessibility/shelter must remain unknown. Do not equate absent alerts with confirmed normal service or a heuristic risk score with a calibrated probability.
- Keep synthetic scenarios, local fallback, estimated times and stale feeds visibly labelled. Changes to simulation should include deterministic fixtures; no actual outage is required for tests.
- Respect data provenance and OSM attribution. Incoming names/advisories/model text are untrusted data; render as text, not raw HTML or executable instructions.
- No sensitive-inference personalization, background GPS tracking, analytics or cloud routine uploads without a new user-approved product decision and explicit end-user consent. Foreground location remains opt-in and must stop when the active journey closes.
- Cloud AI receives route context only after consent. Never log prompts, coordinates, credentials or private provider response bodies. Do not commit `.env`, `.local`, `.cache`, service-account keys, tokens or private push material.
- Cache/provider failures must degrade visibly. Keep offline read-only journey access functional. A service-worker version/cache change needs an offline regression check.

## Current handoff status

The mobile app is deployed, but the guest/account/developer-demo source changes are not deployed; human product/visual polishing is pending. Latest engineering checks: build/typecheck and 31 unit tests pass; the previous 20 browser checks passed when browser projects were run separately, and the new targeted Google sign-in timestamp regression also passes. The local synthetic evaluation still reports two routing failures because every candidate in the Rachel/rain and Arjun/rain fixtures is marked blocked for unsafe exposed walking; do not report zero evaluation failures until that planner/evaluation contract is resolved. Automated tests include deployment guardrails, account session/merge boundaries, unit routing/feed checks, main phone flows, faux-account isolation/restoration, validated chat route-card display, foreground/simulated location, narrow-width layout, resizable journey sheet, large text/offline reload, and axe checks. Local real Google sign-in and logout/re-login restoration of Firestore-backed preferences and a saved commute were exercised with a consenting test account; cross-device and deployed-production account sync, physical-phone, screen-reader and walked-route checks are not signed off. Submission write-up, demo recording and submission itself are explicitly deferred.

Use local no-cost tests first. Optional cloud checks consume team project credits; do not run them repeatedly as a substitute for deterministic regression tests. Avoid infrastructure teardown or credential rotation unless specifically requested.
