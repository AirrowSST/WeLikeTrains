import "dotenv/config";
import { getConditions } from "../server/feeds";
import { oneMapToken, searchPlaces } from "../server/providers";
import { nextDeparture } from "../shared/catalog";
const conditions = await getConditions({
  dataMode: "live",
  scenario: "normal",
  departure: nextDeparture("07:40"),
});
console.log(
  JSON.stringify(
    {
      feeds: conditions.feeds,
      crowdReadings: conditions.crowd.length,
      noticeCount: conditions.notices.length,
      weather: conditions.weather,
    },
    null,
    2,
  ),
);
try {
  await oneMapToken();
  const places = await searchPlaces("Tampines");
  console.log("OneMap geocoding results:", places.length);
} catch {
  console.log("OneMap authentication unavailable");
}
