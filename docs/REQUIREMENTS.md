# Requirement coverage

Source: the supplied “Problem Statement 2 — Smart Commuter Companion”. User clarification strengthens mobile-first to **mobile-only** and requests all three selectable personas, Rachel first. Endpoint suggestions and “Beyond the Brief” examples are not all mandatory integrations.

| Requirement | Implementation / evidence | Boundary |
|---|---|---|
| Phone web app, no native build | React PWA; `src/styles.css`, manifest, bottom navigation; Playwright width/order assertions | Real-device test still required |
| Rachel primary end to end | Public Tampines/Raffles endpoints, 07:40/08:45 defaults, scenario route/steps/save | Public landmarks stand in for private addresses |
| Arjun / Mdm Lim selectable | Isolated Developer-mode faux-account presets, cycling/crowd/shelter/slow walking/step-free/large text | Accessibility is explicitly unverified; demo state never syncs |
| Guest and Google accounts | Local guest preferences and multiple daily commutes; server-verified Google sign-in merges and syncs account state | Sign-out restores the separate guest space; account data is user-deletable |
| Actual origin/destination/time routes | OSM graph + OneMap PT, input validation and geocoding | Local bus subset and estimated timetable |
| Revised route as conditions change | Condition-aware search; compare unconstrained original vs alternatives | Live upstream outages fall back honestly |
| Rail, bus, walk, cycle where needed | Transit adjacency, access A*, cycling-to-transit candidate; route leg icons | Cycle graph incomplete; no bike-on-train guarantee |
| Door-to-door legs | Walking first and last segments, real coordinates, instructions | Last metres/station entrances may be approximate |
| OSM required base | Bundled OSM GeoJSON + graph; provenance/import script | No missing organiser polygons are claimed |
| ODbL and no public-server abuse | Visible attribution, distributed derived extract, manually cached bounded imports | Refresh snapshot deliberately, not per user |
| Affected vs unaffected map | Original dashed, affected overlay, selected alternative, toggle/recenter/zoom | OneMap alerts can only highlight entire leg if hop data absent |
| Crowd in one glance | Low/moderate/high/unknown labels; station real-time + forecast and per-bus occupancy | Unknown stays unknown; bus occupancy only near departure |
| Time and delay comparison | Option durations, arrival, buffers, walking, reasons | Estimated intervals are not confidence bounds |
| Proactive action, meaningful threshold | One-line advice, saved routines, opt-in Scheduler/Web Push, cooldown/dedup | Daily repeats, max 100 records/run, OS delivery constraints |
| Planned and unplanned events | Structured alerts, station lift maintenance, road works/advisories, demo closures, next-day relevant warning | Unstructured road/rail planned notices informational until safely mapped |
| Correct TrainServiceAlerts nesting | Parser reads `AffectedSegments` and separate `Message`; unit fixtures | Feed delay allowance is an app estimate |
| Mitigation in official feed | Displays per-segment free boarding/shuttle information in notices/chat | No invented shuttle route geometry |
| Canonical aliases | STL/SLRT, PTL/PLRT, CEL/CCL, CGL/EWL etc. in shared catalog | Station references from OSM are not always complete |
| Weather changes travel decisions | Travel-window-specific NEA 2h/24h/4d adapters, rain penalties/cycling exclusion | Broad daily outlook does not predict exact trip-time rain |
| Underground/offline behavior | Service worker app/map cache + saved last journey; stale/offline banner | No new routes/live data/AI while disconnected |
| Accessibility | Large text, 44px primary controls, labelled states, focus handling, reduced motion, automated axe | Automated checks do not certify whole-app accessibility |
| Clearly labelled injected demo | Default Demo experience, scenario descriptions, notice source, assistant context | Synthetic replay, not a historical real incident |
| No secrets / lawful sources / privacy | Ignored env, Secret Manager, official APIs, OSM licence, explicit AI/push consent | No scraping; review each provider’s current terms |
| AI team proposition | Vertex-grounded suggestions and preference interview; Cloud TTS; tested fallback | Risk is heuristic, not a trained disruption predictor |
| Reproducible evidence | Vitest, Playwright, local/hosted evaluation scripts and recorded outputs | No unsupported accuracy claim |
| App, short write-up, demo | App and technical setup README implemented | User explicitly deferred submission write-up/recording pending human polishing; submission instructions supplied for future context |
| GCP hosting and keys | Cloud Run, Vertex AI, TTS, Firestore, Scheduler, Secret Manager | External official transport APIs and OS push remain external dependencies |

Not implemented as current product claims: historical disruption-model training, passenger-volume ML, every suggested DataMall endpoint, authoritative covered-linkway/exit layers, background GPS, automatic location-based step completion, voice recognition, or a native application. Foreground location is explicit and demo positions are visibly simulated; unsupported live location never falls back silently. These limitations are not silently simulated.
