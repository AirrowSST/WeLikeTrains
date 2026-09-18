import 'dotenv/config';
import { planJourney } from '../server/planner';
import { places,profiles,nextDeparture } from '../shared/catalog';
const request={origin:places[0],destination:places[1],departure:nextDeparture('07:40'),preferences:profiles[0].preferences,dataMode:'live' as const,scenario:'normal' as const};
const start=performance.now();const plan=await planJourney(request);
console.log(JSON.stringify({elapsedMs:Math.round(performance.now()-start),source:plan.recommended.source,route:plan.recommended.title,duration:plan.recommended.duration,legs:plan.recommended.segments.map(s=>({mode:s.mode,line:s.line,from:s.from,to:s.to,minutes:s.minutes,stops:s.stops.slice(0,4)})),weather:plan.conditions.weather,feeds:plan.conditions.feeds.filter(f=>f.status!=='live'||f.name.includes('routing')),notices:plan.conditions.notices.slice(0,5).map(n=>({title:n.title,description:n.description}))},null,2));
