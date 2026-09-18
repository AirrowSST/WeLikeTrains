import "dotenv/config";
import { getConditions } from "../server/feeds";
import { searchPlaces } from "../server/providers";
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
const places = await searchPlaces("Tampines");
console.log("Bundled place and station results:", places.length);
