---
status: resolved
trigger: "doesn't work - Online address search is unavailable. Using the ..."
created: 2026-09-19
updated: 2026-09-19
---

# Symptoms

- expected: Typing a Singapore address in the Wayce start or end field shows Google-backed suggestions in the Wayce dropdown.
- actual: Wayce showed "Online address search is unavailable. Using the offline index."
- errors: The UI intentionally hid the underlying provider exception behind its fallback state.
- timeline: Began while trying the new Google Place Autocomplete Data API integration locally.
- reproduction: Focus a start or end field and type at least two characters.

# Current Focus

- hypothesis: Confirmed and fixed.
- test: Inspect enabled Google APIs and safe key restriction metadata, then exercise the real local browser integration.
- expecting: Google Place Autocomplete Data suggestions appear in Wayce's own dropdown.
- next_action: None.
- reasoning_checkpoint: The configured local key matched the old Wayce Places UI key. It allowed only placewidgets.googleapis.com, while places.googleapis.com was disabled.
- tdd_checkpoint: Existing mocked regressions remain valid; live provider verification was performed separately.

# Evidence

- timestamp: 2026-09-19
  observation: The local .env contains a nonempty GOOGLE_MAPS_API_KEY and /api/config exposes it to the browser by design.
- timestamp: 2026-09-19
  observation: The matching key allowed only Places UI Kit, and Places API (New) was not enabled.
- timestamp: 2026-09-19
  observation: After configuration repair, a real headless browser search for National Gallery returned five Singapore suggestions with Google Maps attribution and no fallback warning or console error.
- timestamp: 2026-09-19
  observation: Selecting the first live result populated the destination field as National Gallery Singapore.
- timestamp: 2026-09-19
  observation: Selecting live Google results for Tampines Mall and National Gallery enabled planning and sent both google-prefixed place IDs and Singapore coordinates to /api/plan.

# Eliminated

- hypothesis: The local .env key is missing.
  reason: A nonempty key is present and matches the expected GCP key resource.
- hypothesis: The custom Wayce autocomplete request is structurally broken.
  reason: The live request returned attributed Singapore predictions after the API authorization was corrected.

# Resolution

- root_cause: The implementation had moved from Places UI Kit to Place Autocomplete Data, but the GCP project and browser key retained the old UI Kit-only authorization.
- fix: Enabled Places API (New) and restricted the matching browser key to Maps JavaScript API plus Places API (New), preserving the existing website referrers.
- verification: Live local browser search returned Singapore suggestions without the fallback warning; selecting Tampines Mall and National Gallery enabled planning and sent both selected coordinates to /api/plan.
- files_changed: No application source files were changed for this repair; only GCP API enablement and key restrictions changed, plus this ignored debug record.
