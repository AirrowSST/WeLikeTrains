# PS2 audit follow-up — 2026-09-19

P0 items (deployment, physical-phone acceptance and submission readiness) are marked **verified by the user**, as requested. This is user attestation; no new agent deployment, phone test or submission was performed. Earlier engineering records remain historical evidence.

Road works are out of scope by user decision. Removed RoadWorks polling, its feed diagnostics and planner road-work warnings. Existing references to active RoadWorks integration in older coverage/source documents are superseded by this decision. Rail disruptions, lift maintenance, traffic conditions and released bus changes remain in scope.

## Remaining P1/P2

- P1 search: Google Places UI Kit now supplies optional island-wide online address/place coordinates in normal mode, with indexed station, bus-stop and landmark search retained offline. The current GCP project does not yet have Places UI Kit enabled; the guarded setup script enables it only during an explicitly authorised infrastructure deployment. A referrer-restricted live-key browser exercise and public policy/terms review remain necessary. Search coverage does not imply routing-graph coverage.
- P1 routing coverage: broader walking coverage and measured first/last access legs remain follow-up work. Schematic bus geometry stays labelled.
- P1 accessibility: continuous step-free access and indoor paths remain unverified.
- P2 rail realtime: a functioning official payload remains unverified; scheduled departures stay labelled.
- P2 push: actual device delivery remains a separate follow-up item without push-specific results.

These remaining items need further implementation or provider/field evidence; they are not closed by the wording correction or road-works removal.
