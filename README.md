# RaceForecaster

Plan a long race against the weather you'll actually ride into.

Upload a route, set the average speed you intend to hold and the time you start.
RaceForecaster works out where you'll be at every point in the day and tells you
what the weather is doing *there, then* — temperature and what it will feel like,
wind strength and whether it's a head, tail or crosswind, where on the route the
rain lands, and which stretches you'll ride in the dark. Every checkpoint gets an
arrival time, its own forecast, and an editable stop.

Weather comes from [MET Norway](https://www.met.no/) (the institute behind YR).

---

## Quick start

```bash
npm install
```

Copy the environment template and put your own details in it:

```bash
cp .env.example .env
```

`MET_USER_AGENT` is the only required setting. MET Norway's
[terms of service](https://api.met.no/doc/TermsOfService) require every request
to identify the application and a way to contact whoever runs it — requests
without it are refused with a 403. Something like this:

```
MET_USER_AGENT="RaceForecaster/0.1 github.com/you/RaceForecaster you@example.com"
```

Then:

```bash
npm run dev
```

The app is at <http://localhost:5173>. There's a sample 230 km route on the
landing page if you don't have a GPX to hand.

## Running it for real

```bash
docker compose up --build
```

Serves the whole thing — API and web app — on <http://localhost:8787> from a
single container. `MET_USER_AGENT` is read from your `.env`. Saved routes, share
links and the forecast cache live in a named volume.

Without Docker, `npm run build && npm start` does the same on port 8787.

---

## How it works

### The pipeline

1. **Parse.** GPX (`<trk>` or `<rte>`) and TCX are both accepted. Waypoints
   become checkpoints, snapped to the nearest point on the track, with
   facilities guessed from whatever description the organiser wrote.
2. **Prepare.** The track is simplified to strip GPS jitter, then redrawn with a
   point every 100 m so anything downstream can ask "what's happening at km 137"
   by index. Elevation is smoothed before gradients are taken from it.
3. **Pace.** Your target average is converted into arrival times (below).
4. **Fetch.** A forecast is pulled roughly every 15 km along the route, so you're
   never more than 7.5 km from real data, plus one at every checkpoint.
5. **Resolve.** For each moment of the race: interpolate between the two nearest
   forecast locations, then between the two nearest forecast hours, correct the
   temperature for your actual altitude, and resolve the wind against the
   direction you're travelling.

### Pacing

You set one number — the average you intend to hold — but riding a hilly course
at a constant speed would put you in the wrong place at the wrong time all day,
and knowing where you'll be when the weather turns is the entire point.

So instead the model finds the steady power whose resulting speeds *average out*
to the figure you asked for, then rides that: slow up the climbs, fast down the
descents, in the proportions physics dictates.

```
P = v · ( m·g·sin θ  +  Crr·m·g·cos θ  +  ½·ρ·CdA·v² )
           gravity        rolling            drag
```

Air density falls with altitude, so a high pass is genuinely faster for the same
effort. Rider mass, bike mass, CdA and Crr are all adjustable.

Your target is a **moving** average — checkpoint stops are added on top, and each
one pushes every later arrival back.

One deliberate limitation: the model doesn't know about braking for corners,
traffic or technical descents, so on a twisty descent it will be optimistic. The
maximum speed setting is the backstop.

### Wind

`wind_from_direction` is the direction the wind blows *from*. Resolved against
your heading:

```
rel = normalize180(windFrom − travelBearing)

|rel| ≤ 45  → headwind        |rel| ≥ 135 → tailwind
45 < rel < 135 → from right   −135 < rel < −45 → from left

headwind component = windSpeed · cos(rel)   // > 0 against you, < 0 pushing you along
```

Wind is interpolated as a vector, never as a compass bearing. Averaging 350° and
10° in degree space gives 180° — the exact opposite of the right answer.

### Feels like

Steadman's Australian Apparent Temperature, the same basis YR uses, so the
numbers agree with the app you're probably already checking:

```
e  = (rh/100) · 6.105 · exp(17.27·T / (237.7+T))
AT = T + 0.33·e − 0.70·v − 4.00
```

There's also a "as felt on the bike" mode that uses your true airspeed — the
vector sum of the wind and your own motion — rather than ambient wind.

### Forecast resolution

MET Norway publishes hour-by-hour detail for roughly the next 65 hours and only
6-hourly blocks beyond that. Planning two weeks out is perfectly reasonable, but
the numbers deserve a caveat until race week, so each hour records which kind of
data it came from and the UI says so — and stops saying so, by itself, once it
stops being true.

---

## Layout

```
packages/core/     the entire planning engine — no Node, no DOM, no HTTP
apps/api/          Hono server: GPX ingest, met.no caching proxy, share links
apps/web/          React front end
scripts/           sample route generator
```

`packages/core` is platform-neutral on purpose. The server computes a plan with
it, and the browser **reruns the exact same code** over the forecast data it
already has — which is why dragging the speed control repaints the whole plan in
about 30 ms without a single network request. A React Native app can import it
unchanged.

## Being a good citizen with the weather API

The terms of service aren't optional, and the client is built around them:

- Every request carries the identifying `User-Agent` from `MET_USER_AGENT`.
- Responses are cached until their `Expires` header, then revalidated with
  `If-Modified-Since` so an unchanged forecast costs a 304.
- Concurrent requests for the same coordinate are collapsed into one.
- Outbound requests are paced to `MET_MAX_RPS` (default 5/s, against their 20/s
  ceiling).
- Coordinates are rounded to 4 decimals, matching their own cache granularity.
- The browser never talks to met.no directly — it goes through this cache.
- Attribution (CC BY 4.0) is in the app footer. Keep it there.

## API

```
POST /api/routes         GPX/TCX, multipart "file" or a raw body  → { route, warnings }
GET  /api/routes/:id                                              → { route }
POST /api/plans          { routeId, startTime, targetSpeedKmh, … } → { plan, weather, sun }
POST /api/shares         same body                                → { id, url }
GET  /api/shares/:id                                              → { route, settings, plan, weather, sun }
GET  /api/health
```

`POST /api/plans` returns the raw forecast series alongside the computed plan,
which is what lets the client take over and recompute locally.

## Development

```bash
npm run dev          # core watch + API + Vite, all at once
npm test             # vitest over the engine
npm run typecheck    # all three packages
npm run build        # production build of everything
```

Tests run offline against a recorded met.no response, and cover the things that
are easy to get quietly wrong: wind interpolation across the 0°/360° wrap, all
four head/tail/left/right quadrants, pacing landing on the target average over
hilly terrain, the altitude temperature correction, the 1h→6h resolution
fallback, and a start time on the far side of a daylight-saving transition.

Regenerate the sample route with:

```bash
node scripts/make-sample-route.mjs
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `MET_USER_AGENT` | — | **Required.** Identifies you to MET Norway. |
| `PORT` | `8787` | Port the API listens on. |
| `DATA_DIR` | `./data` | SQLite database location. |
| `PUBLIC_BASE_URL` | `http://localhost:$PORT` | Origin used to build share links. |
| `MET_MAX_RPS` | `5` | Outbound request ceiling. |
| `WEB_ROOT` | `apps/web/dist` | Built web assets to serve. |

## Licence and data

Weather data © MET Norway, used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The sample route is
synthetic — invented geometry between two real towns, not a real road.

Forecasts are forecasts. Treat the output as a plan, not a promise.
