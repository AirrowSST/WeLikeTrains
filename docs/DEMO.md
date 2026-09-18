# End-to-end demonstration and phone acceptance

Engineering QA notes only. The user has deferred the submission write-up and recording pending human polishing. Do not treat this checklist as a completed or approved submission.

## Rachel: about five minutes

1. Open the HTTPS URL in a **real phone browser**. Confirm the mobile-only bottom navigation and one-column UI starts as Guest. Open **Options**, enable **Developer mode**, choose **Open demo presets**, then load Rachel.
2. Explain the scope: Our Tampines Hub → One Raffles Place, leaves 07:40, desk by 08:45. These are real Singapore locations, using real OSM geometry.
3. Select **A regular morning** in Demo experience. The route uses EWL with walking at both ends. Point out the detailed online OneMap label and attribution. Open Full details and explain that timings come from the local OSM routing graph and are estimates.
4. Select **EWL disruption**. Explicitly say: “This is an injected test disruption, not a claim that trains are disrupted now.” The original EWL path remains on the map, its affected portion is distinguished, and the DTL alternative appears. Read the actionable recommendation and arrival-buffer advice. Swipe between cards to compare walking/time/crowd trade-offs.
5. Open **Network updates** to show the simulated affected stations, free-bus/shuttle mitigation and next-day maintenance. Select **Planned closure** to show closure avoidance before travel, not just a status label.
6. Open the companion and read the consent text. Ask “Why this route? Is the risk a probability?” Show the response provider label. Explain the risk is rule-based. Ask “I avoid crowds and need sheltered walks”, review the proposal and apply it. Read a response aloud; do not claim microphone/speech-recognition support.
7. Tap **Use simulated location** and confirm the origin, status and amber map marker all say the position is simulated. Start the journey and manually advance one step; the simulated marker follows the confirmed step. Explain that Live mode requests browser location only after a tap, foreground tracking stops when the journey closes, and steps never auto-complete. With the app previously loaded, turn on airplane mode and reload. Confirm the map/steps remain and the offline/stale warning is prominent. Turn airplane mode off afterwards.
8. Switch **Data & sources → Live feeds**. Show real advisory messages, feed freshness and crowd readings. Explain that OneMap supplies only the visual basemap while the route geometry and place search remain on the bundled OSM snapshot. A quiet live disruption feed is normal; do not relabel the synthetic event as live.

## Additional profiles

- Arjun: load his faux-account preset; compare comfort preferences and cycling availability with custom showers or dry weather. Bicycles are parked before transit. The nearest-station walk can legitimately outrank cycling; do not claim every trip should include a bicycle.
- Mdm Lim: load her faux-account preset, which enables large text and lift-maintenance conditions. Show the known affected station avoided and the explicit warning that step-free access remains unverified. The app is not certified accessible navigation.
- Exit a demo and confirm the prior guest or signed-in account, saved commutes, preferences and text size are restored. Demo changes must not appear in real account data.
- Reminders: on a compatible phone, explain cloud storage and lock-screen privacy, then optionally enable push in Saved commutes. Do not grant permission on behalf of a judge. iOS and browser installation requirements should be checked on the target device; in-app advice works without push.
- Location: on a compatible phone over HTTPS, switch to Live mode, tap **Use my location**, grant permission yourself, and confirm the blue device marker and accuracy label. Start/stop foreground tracking in the journey dialog and confirm closing it stops tracking. Do not grant permission on behalf of a judge or claim a physical-phone result until performed.

## Physical-phone checklist — not yet signed off

Automated Chromium phone emulation is complete separately. A human must record device, OS/browser, date and results for these actual-device checks:

- [ ] Android Chrome: portrait, landscape, scrolling address bar, safe-area bottom navigation.
- [ ] iPhone Safari: keyboard opening in place search/chat, time/date pickers, no accidental input zoom, home-screen installation where needed.
- [ ] Tap targets reachable with one thumb; no horizontal page overflow at 320–480px or enlarged text.
- [ ] Read outdoors; distinguish affected/original/selected routes without relying on colour alone.
- [ ] Swipe alternatives, pan/zoom map, open/close dialogs, VoiceOver/TalkBack labels and focus return.
- [ ] Offline reload after a complete first visit; show stale timestamp; recover when connected.
- [ ] Speaker action works after user gesture and remains usable if cloud speech fails.
- [ ] Opt-in notification arrives on a consenting test device; delete reminder and check no further sends.
- [ ] Walk Rachel’s first/last access legs and confirm entrances, path legality, crossing instructions and actual duration.

Never claim the final two checks were performed merely because automated tests passed. For a real disruption demonstration, use a documented organiser-approved historical replay if provided, or retain the current plainly labelled injected scenario allowed by the brief.

## Submission packaging

The organiser's instructions are at `C:\Users\Yaw Tia\Downloads\README.md` for future context. They call for a root `WRITEUP.md` and linked recording, but the user explicitly asked not to prepare them yet. No submission has been made.
