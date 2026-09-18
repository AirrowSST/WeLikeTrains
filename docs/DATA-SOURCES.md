# Sources, licences and data handling

| Source | Use | Attribution / terms |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright), queried through [Overpass](https://overpass-api.de/) | Actual rail/bus route relations, pedestrian/cycle ways, station references and static vector map | © OpenStreetMap contributors. ODbL 1.0; derived database distributed in `data/network.json` and `public/data/basemap.json` with provenance and rebuild code |
| [LTA DataMall](https://datamall.lta.gov.sg/content/datamall/en.html) | TrainServiceAlerts; PCDRealTime/PCDForecast for eleven API line codes; v3 BusArrival; v2 FacilitiesMaintenance; RoadWorks | Official registered API access; follow DataMall API/usage terms. Runtime responses are not republished as a historical dataset |
| [OneMap API](https://www.onemap.gov.sg/apidocs/) | Place search, authentication and public-transport itineraries | Singapore Land Authority official API; registered credentials and token renewal; no OneMap basemap tiles |
| [data.gov.sg](https://data.gov.sg/) / NEA | Travel-window 2-hour, 24-hour and 4-day weather forecasts | Official open API; Singapore Open Data Licence where applicable to the dataset, [terms](https://data.gov.sg/terms) |
| [Google Vertex AI](https://cloud.google.com/vertex-ai/generative-ai/docs) | Grounded conversational advice and preference proposals | Team project service; not a source of invented live transport facts |
| [Google Cloud Text-to-Speech](https://cloud.google.com/text-to-speech/docs) | User-requested spoken replies | Team project service and applicable Google Cloud terms |
| Synthetic fixtures in `server/feeds.ts` | Deterministic disruption, closure, lift, crowd and rain demo | Authored test data, prominently labelled; no historical accuracy claim |

No Telegram/web-page scraping is used. No private commuter data was acquired. Public landmarks in the catalog are demo endpoints, not real residents’ addresses. No external imagery or web fonts are fetched. The local font stylesheet uses installed/system fonts. Lucide icons, Leaflet, React and other packages retain their published licences in npm dependencies; consult the lockfile for exact versions.

## OSM provenance and refresh

`data/OSM-PROVENANCE.json` records extraction time, source, bounding box and query; `scripts/import-osm.mjs` contains the exact bounded split queries and station-code join. The snapshot is WGS84: network coordinate tuples are latitude/longitude, GeoJSON is longitude/latitude. The organiser’s missing station polygon file was not used, and its CRS was not guessed.

`npm run data:osm` is a **manual maintenance command**, not part of app startup, build or CI. It reuses `.cache` and spaces new bounded downloads. For a fresh extract, archive the specific cache files deliberately or use a new checkout; do not repeatedly query a public Overpass server. Respect its load policy or use a managed/self-hosted endpoint (`OVERPASS_URL`) for large refreshes. The running application makes zero public tile/Overpass requests.

The derived extract includes all fetched supported rail route relations and selected buses (2, 12, 17, 27, 34, 36, 67, 118, 190, 196); unmapped, future or incomplete services are not a promise of operational service. Rail names/codes can change. Retain attribution and the ODbL obligations when redistributing modified database files. App code licensing is left to the repository owner; no third-party data ownership is claimed.
