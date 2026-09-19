# PS2 audit follow-up — 2026-09-19

P0 items (deployment, physical-phone acceptance and submission readiness) are marked **verified by the user**, as requested. This is user attestation; no new agent deployment, phone test or submission was performed. Earlier engineering records remain historical evidence.

Road works are out of scope by user decision. Removed RoadWorks polling, its feed diagnostics and planner road-work warnings. Existing references to active RoadWorks integration in older coverage/source documents are superseded by this decision. Rail disruptions, lift maintenance, traffic conditions and released bus changes remain in scope.

## Remaining P1/P2

- P1 search: Wayce now renders a standardised input and dropdown backed by Google Place Autocomplete Data API, with visible Google Maps attribution and indexed station, bus-stop and landmark search retained offline. Maps JavaScript API is enabled in the current project, but Places API (New) is not yet enabled and the existing browser key restriction must be changed from Places UI Kit to Maps JavaScript API plus Places API (New). The guarded setup script enables the services only during an explicitly authorised infrastructure deployment. A live-key Data API exercise remains necessary after configuration. Search coverage does not imply routing-graph coverage.
- P1 routing coverage: broader walking coverage and measured first/last access legs remain follow-up work. Schematic bus geometry stays labelled.
- P1 accessibility: continuous step-free access and indoor paths remain unverified.
- P2 rail realtime: a functioning official payload remains unverified; scheduled departures stay labelled.
- P2 push: actual device delivery remains a separate follow-up item without push-specific results.

These remaining items need further implementation or provider/field evidence; they are not closed by the wording correction or road-works removal.
