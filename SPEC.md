# Float Plan — NY Harbor (Pier 25) — Build Spec

Single self-contained HTML file: `/Users/gmecocci/projects/floatplan/index.html`.
Opened via `file://` in any modern browser (Mac Safari/Chrome, iPhone Safari). No build step, no server.
Only external dependency: Leaflet from CDN (radar map). Everything else vanilla JS/CSS in one file.

## Purpose

User sails from a mooring field at Pier 25, Hudson River, Manhattan (40.7203 N, -74.0135 W).
App answers, for a chosen departure time + duration:

1. **Is it safe to sail?** — wind within limits, no storms, no serious advisories.
2. **Which direction to head out?** — north (up the Hudson) or south (toward the Upper Bay), driven by current (ebb = south-flowing, flood = north-flowing).
3. **Reefing expected?** — 15–18 kts sustained = reef band.

Then: **monitor mode** — user saves the plan, app auto-refreshes and diffs new data against the
saved snapshot, flagging deteriorating conditions (wind up, new advisories, storms).

## Wind limits (defaults; editable in Settings, persisted localStorage)

- GREEN (go): sustained < 15 kts and gusts < 20 kts
- YELLOW (go, reef expected): sustained 15–18 kts
- RED (no-go): sustained > 20 kts OR gusts > 25 kts
- RED regardless of wind: any thunderstorm in window forecast; Gale/Storm warning; Severe Thunderstorm/Tornado watch or warning covering the window
- YELLOW flag (cautionary, not auto-no-go): Small Craft Advisory active during window — surfaced prominently, verdict shows "CAUTION"; user decides. (SCA in NY Harbor usually means 20+ kt sustained which trips RED anyway.)

All thresholds in **knots**. All wind data converted to knots regardless of source unit.

## Data sources (exact endpoints/fields filled from research — see RESEARCH FACTS section appended below)

1. **Currents**: NOAA CO-OPS `currents_predictions` for the Hudson River station nearest Pier 25.
   - Two fetches: `interval=MAX_SLACK` (slack/max flood/max ebb events for timeline labels) and a fine interval (30 or 60 min) for the current-speed curve.
   - `time_zone=lst_ldt`, `units=english` (knots).
   - Flood on the Hudson ≈ northward (upriver), ebb ≈ southward. Use station meanFloodDir/meanEbbDir to render arrows.
2. **Tides (context)**: The Battery 8518750 `predictions&interval=hilo` — show HW/LW times as secondary info.
3. **Wind + weather**: NWS `api.weather.gov` gridpoint data for the point.
   - `forecastGridData` for windSpeed / windGust / windDirection / probabilityOfPrecipitation / skyCover time series (parse ISO8601 validTime spans with durations).
   - `forecastHourly` for shortForecast text + icons per hour.
   - Convert km/h or mph → knots as required by observed `uom`.
4. **Advisories**: `alerts/active` for the marine zone covering NY Harbor (expected ANZ338) AND for the point (land alerts like Severe T-storm). Merge, dedupe by id.
5. **Marine text forecast**: zone forecast text for the marine zone (nice-to-have card, collapsible).
6. **Radar**: Leaflet map centered ~40.70,-74.02, zoom ~10. Base tiles: CARTO light/dark (auto per theme). RainViewer frames (past + nowcast) as animated overlay with play/pause + frame slider + timestamp label. Marker at Pier 25. Preserve every active NWS warning polygon and its official motion overlay. Separately cap radar-cell linear SCIT projections at four, ranked first by closest projected one-hour approach to Pier 25 and then by meteorological significance and recency. Keep 15-minute ticks, but permanently label only each track's +60-minute endpoint; intermediate times appear on hover.

## Plan inputs

- Departure: date + time pickers. Default: today, next half-hour boundary at least 30 min out.
- Duration: 2 / 3 / 4 / 5 / 6 h chips (default 3 h).
- "Save plan" button → snapshots verdict inputs (max sustained, max gust, alert ids, thunder flag, current summary) + timestamp into localStorage → enables Monitor mode.

## Verdict card (top of page, always visible)

Large colored banner: **GO** (green) / **GO — REEF EXPECTED** (yellow) / **CAUTION — ADVISORY** (yellow-orange) / **NO-GO** (red).
Beneath: bullet reasons, each with the number that triggered it, e.g.:
- "Max sustained in window: 17 kt (reef band 15–18)"
- "Gusts to 27 kt at 15:00 (> 25 limit)"
- "Small Craft Advisory until 18:00"
- "Thunderstorms in forecast 16:00–17:00"
Window = departure → departure + duration. Compute max sustained & max gust across all grid periods overlapping window; list thunder hours from forecastHourly shortForecast regex /thunder|t-?storm/i.

## Direction recommendation card

Logic over current predictions within the window:
- Compute signed current (positive = flood/north, negative = ebb/south) at departure, at midpoint, at return.
- If current reverses (slack falls inside window) AND the flip lands in the first ~half of the window: recommend departing WITH the current now, returning with the reversed current. E.g. ebbing now, turns to flood mid-sail → "Head SOUTH on the ebb, ride the flood home." A LATE flip (past ~55% of the window) is treated like a single-phase window instead — head against the pre-flip current, come home with it before it turns. Guiding principle: never plan a return leg that fights the current.
- If current is one direction for the whole window: recommend heading AGAINST it outbound so the ride home is favorable → "Flooding the whole window — head SOUTH first (against ~1.2 kt flood), come home with it."
- Always show: current state now (ebb/flood/slack + speed), next slack time, next max (flood/ebb) time + speed.
- Compass arrow graphic showing recommended initial heading (N or S along the Hudson).

## Current timeline chart (hand-rolled inline SVG, no chart lib)

- X axis: from 2 h before departure to ~2 h after return (min 8 h span). Y: current speed in kt, flood positive (up), ebb negative (down).
- Smooth path from fine-interval predictions; zero line labeled "slack"; shaded vertical band = sail window; markers for slack / max flood / max ebb with time labels; "now" line.
- Colors: flood one hue, ebb another; readable in both themes.
- Remote observation context: show independent 24-hour measured-current histories for Kill Van Kull LB 14 (`n06010`, flood axis 255°) and The Narrows (`n03020`, flood axis 324°). These are reference stations only and never replace the Hudson prediction in planning or simulation. NOAA no-data/QC withholding is shown as unavailable, never filled or fabricated.
- A compact locator map shows Pier 25 plus the exact Kill Van Kull (40.64358, -74.13889) and The Narrows (40.60639953613281, -74.03800201416016) sensor positions.
- Timeline legends and scrub readouts always identify the location, measurement type, and whether values are forecast or measured. Current values use knots and flood/ebb wording; Battery water levels use feet. Station-bin and axis-projection metadata stays out of the user-facing readout.

## Sail simulator

- Integrate the boat in one-minute steps using the N 11° / S 183° Hudson course, forecast wind, the conservative harbor wind-shadow calibration, and location-adjusted Hudson Entrance current.
- Choose a sailed strategy by comparing velocity vectors, not by applying a decorative angle threshold. Score the direct river heading and paired close-hauled/broad-reach headings by their along-route component; a pair is valid only when its legs cancel cross-route drift and neither leg makes negative route progress. Prefer direct unless the paired strategy is at least 3% faster.
- A WNW wind on the northbound course is approximately 79° off the bow and is therefore an honest direct reach: keep that track straight and explicitly show its true wind angle and `Direct reach · tacking is slower`. Do not invent tacks solely to make the route look nautical.
- When a paired strategy wins, integrate its alternating headings and cross-route velocity. The wake must visibly zigzag, tack/jibe markers must correspond to actual heading changes and maneuver losses, and the readout must show both planned headings and completed/planned maneuver counts.
- Never hide an invalid strategy by clamping a meaningfully negative VMG to zero. A selected sailing leg must make non-negative route progress, and a genuine beating fixture must make positive progress on every leg.

## Wind panel

- Hourly rows (or compact chart + rows) covering window ±2 h: time, wind dir arrow + cardinal, sustained kt, gust kt, colored per limits (green/yellow/red cell backgrounds).
- Above it: window summary — dominant direction, range sustained, max gust.
- Observed Now offers the Hudson-relevant Robbins Reef NOAA station and Willy Wall. Do not offer East River stations. Keep the observed row geometry fixed across selections and unavailable states; its reserved comparison badge classifies like-for-like measured versus forecast wind with a 3 kt tolerance as above, within, below, or unavailable.

## Weather strip + radar

- Hourly strip for window ±2 h: NWS icon (use shortForecast text + emoji mapping — do NOT hotlink NWS icons if CORS/mixed issues; emoji mapping is fine), temp °F, PoP %.
- Radar map card as described. If RainViewer fetch fails, show base map + error chip with retry.

## Advisories card

- List active alerts sorted severity desc: event name, severity badge, onset–ends (local), headline. Expand for description. None → subdued "No active advisories" with checkmark.
- Any alert overlapping the sail window gets a "IN WINDOW" badge and feeds the verdict.
- Minimize vertical scrolling by pairing Advisories with Marine Forecast at half-window and medium dashboard widths (520–1199 CSS px). At medium widths, use a dedicated full-dashboard-width pair row so neither card is squeezed into a quarter-page column. In paired layouts, omit the explanatory marine subtitle and compact the table typography, padding, and column proportions without hiding forecast rows or fields. Keep the cards stacked on narrower phones below 520 px so the four-column safety forecast remains readable, and preserve the existing three-column layout at 1200 px and above. All unrelated cards retain their assigned rail or full-width mobile-tab layout.

## Monitor mode

- Toggle at top ("Monitor every 10 min" — interval configurable 5/10/15 in settings). Uses setInterval; also refresh on visibilitychange when tab becomes visible.
- Each refresh recomputes verdict from fresh data and diffs vs saved plan snapshot:
  - verdict worsened (GO→REEF, →CAUTION, →NO-GO)
  - max sustained or gust in window rose ≥ 3 kt above snapshot
  - new alert id appeared / alert upgraded
  - thunder hours appeared where there were none
- Changes → prominent "CONDITIONS CHANGED" banner + list; try browser Notification (request permission on monitor enable; degrade silently if unavailable on file://).
- "Last updated HH:MM:SS" + next-refresh countdown.

## Float plan (printable)

- Collapsible card with editable fields persisted in localStorage: vessel name/type/color, sail number, crew count + names, phones, emergency contact ashore, VHF channel, planned route (auto-filled from direction rec: "Depart Pier 25 mooring → Hudson N/S → return"), ETD, ETA (auto from inputs), "file with" note.
- Print stylesheet: @media print shows only the float-plan sheet + conditions summary (verdict, wind summary, current summary, advisories) in clean black-on-white.
- "Copy as text" button → clipboard plain-text float plan for texting/emailing.

## Layout / style

- Mobile-first single column, max-width ~720px centered on desktop. Cards with rounded corners, generous spacing.
- Auto dark/light via prefers-color-scheme; manual override toggle (localStorage).
- Nautical but restrained aesthetic: deep navy/ink dark theme, off-white light theme, signal colors reserved for verdict/limits. System font stack. Verdict banner is the loudest element on the page.
- Header: "Pier 25 Float Plan" + date, settings gear (limits, monitor interval, theme).

## Engineering requirements

- All times displayed in America/New_York via Intl.DateTimeFormat with explicit timeZone; internal math in epoch ms. NOAA lst_ldt timestamps are local NY time WITHOUT offset suffix ("2026-07-13 14:30") — parse them explicitly as NY-local (manual offset resolution via Intl trick), never `new Date(string)` on them.
- NWS validTime "2026-07-13T14:00:00+00:00/PT2H" — parse start + ISO8601 duration, expand into hourly buckets.
- Each data source fetched independently (Promise.allSettled); one failure never blanks the app. Per-card error state + retry button. AbortController 15 s timeout per fetch.
- Last-good payload per source cached in localStorage with fetch timestamp; on load render cached data immediately (marked "stale, from HH:MM") while revalidating.
- fetch() with no custom headers (browser UA suffices for NWS; custom UA header would trigger CORS preflight — avoid).
- No console errors in normal operation. Handle: empty alert list, missing windGust series, currents API error object ({"error":{...}}), Leaflet CDN load failure (radar card error, rest of app fine).
- Single file: all CSS in <style>, all JS in <script type="module"> (or plain script), Leaflet via <script src> + <link> CDN tags with graceful degradation.
- localStorage keys namespaced `fp25.*`.

## RESEARCH FACTS (verified live 2026-07-13 — build against these exactly)

### Currents — NOAA CO-OPS

- **Primary station: `NYH1927` "Hudson River Entrance"** (40.7076, -74.0253), harmonic, ~1.5 km SSW of Pier 25. Default bin 13 (Depth "7" ft — near-surface, right for a sailboat; do NOT pass a bin param). **meanFloodDir=11° true (north/upriver), meanEbbDir=183° true (south)** — read these numbers from the response itself, they're on every row. Backup station `NYH1928` "Hudson River, Pier 92" (only as manual fallback note, don't auto-switch).
- Endpoint: `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=currents_predictions&application=floatplan&begin_date=YYYYMMDD&range=NN&station=NYH1927&time_zone=gmt&units=english&interval=MAX_SLACK&format=json`
  - Two fetches: `interval=MAX_SLACK` (event list) and `interval=30` (curve).
  - **Use `time_zone=gmt`, not lst_ldt** (audit-verified working): Time strings come back UTC. Parse with `s.replace(' ','T') + 'Z'` → absolute instant. NEVER feed the raw string (space separator) to `new Date()` — Invalid Date in Safari. Render all times via `Intl.DateTimeFormat` with `timeZone:'America/New_York'`.
  - **begin_date is interpreted in GMT when time_zone=gmt.** Compute it from the departure instant: `begin = departureUTCdate - 1 day`, `range=96` — guarantees the event *before* the window is included (needed to classify phase at window start).
- Response shape: `{"current_predictions":{"units":"feet, knots","cp":[{"Type":"ebb","meanFloodDir":11,"Bin":"13","meanEbbDir":183,"Time":"2026-07-13 06:06","Depth":"7","Velocity_Major":-2.65}, ...]}}`
  - `Velocity_Major` **negative = ebb (south), positive = flood (north)**, knots. Slack rows can be `0, -0, 0.01, -0.01`.
  - **`Type` ("ebb"/"flood"/"slack") exists ONLY with MAX_SLACK.** interval=30 rows omit it — classify by sign, |v| < 0.1 ≈ slack.
  - `Velocity_Major/meanFloodDir/meanEbbDir` are numbers; `Bin/Depth/Time` strings.
- **Errors: can be HTTP 400 *or* HTTP 200, both with body `{"error":{"message":"..."}}`.** Check `!res.ok || json.error`. Error responses DO carry CORS headers (body readable).
- Tides (context): `product=predictions&station=8518750&begin_date=...&range=48&interval=hilo&datum=MLLW&units=english&time_zone=gmt&format=json&application=floatplan` → `{"predictions":[{"t":"2026-07-13 11:50","v":"4.78","type":"H"}]}` — `v` is a STRING (parseFloat), `type` H/L.
- CORS: `access-control-allow-origin: *` on all endpoints incl. errors — file:// works.

### Wind / weather — NWS api.weather.gov (grid OKX/33,42)

- **Plain `fetch(url)` with NO custom headers** (User-Agent is a forbidden fetch header; browser UA accepted; no preflight). CORS `*` everywhere incl. 404s.
- Hourly text/icons: `https://api.weather.gov/gridpoints/OKX/33,42/forecast/hourly` — 156 periods. `startTime` ISO with offset (`2026-07-13T12:00:00-04:00`), `temperature` int °F, `probabilityOfPrecipitation.value` %, `windSpeed` is a **display string** ("8 mph", possibly "5 to 10 mph" — parse defensively, take the max number), `windDirection` compass string, `shortForecast` string. **NO windGust field exists here.**
- **Numeric wind (source of truth): `https://api.weather.gov/gridpoints/OKX/33,42`** — `properties.windSpeed / windGust / windDirection / probabilityOfPrecipitation / skyCover`, each `{uom, values:[{validTime, value}]}`.
  - `windSpeed`/`windGust` uom `wmoUnit:km_h-1` → **kt = kmh / 1.852**. `windDirection` degrees true. windGust series confirmed populated (117 values).
  - `validTime` = `2026-07-13T03:00:00+00:00/PT1H` — instant + ISO-8601 duration. **Durations include day components: observed `P1D`, `P2D`, `P1DT12H`, `P2DT21H`, `P7DT22H`.** Parse `P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?`, hours = D*24+H; expand each span into hourly buckets.
  - **`value` can be null** (seen in windChill/ceilingHeight; shape admits it anywhere) — guard every `.value` before math; `null/1.852 = 0` fake-calm bug.
- Alerts — fetch BOTH, merge, dedupe by `id`:
  - `https://api.weather.gov/alerts/active?point=40.7203,-74.0135` (land: heat advisory was live in testing)
  - `https://api.weather.gov/alerts/active?zone=ANZ338` (marine: SCA/Gale land here). Zone hardcoded — point lookup returns empty (pier is land).
  - Shape: GeoJSON FeatureCollection; `features` always an array (may be empty). `properties`: `event, severity, headline, onset, ends (CAN be null — fall back to expires), effective, expires, description, instruction, urgency, certainty, areaDesc, id, messageType, senderName, web`.
- Marine text forecast (optional card): `/zones/forecast/ANZ338/forecast` is **404 — do not use**. Instead: `https://api.weather.gov/products/types/CWF/locations/OKX` → `@graph` (sorted newest-first, check length>0) → `[0].id` → `https://api.weather.gov/products/{id}` → `.productText`, extract the section starting at the line matching `/^ANZ338-/` until the next `/^ANZ\d{3}-/` or `$$` terminator. Treat panel as optional; either fetch failing hides it gracefully.
- api.weather.gov has known intermittent 5xx: **retry 5xx twice with 1s/3s backoff**, per-panel error states.

### Radar / map

- Leaflet 1.9.4 pinned, cdnjs with official SRI (verified):
  - JS: `https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js` integrity `sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==`
  - CSS: `https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css` integrity `sha512-Zcn6bjR/8RZbLEpLIeOwNtzREBAJnUKESxces60Mpoj+2okopSAcSUIUOseddDm0cxnGQzxIR7vJgsLZbdLE3w==`
  - Both with `crossorigin="anonymous"` (CORS verified for Origin: null). If `window.L` undefined after load → radar card error state, rest of app unaffected.
- Base tiles (key-less, CORS ok): CARTO `https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png` and `dark_all` variant, switch with theme. Attribution: `&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>`.
- RainViewer: `https://api.rainviewer.com/public/weather-maps.json` → `{host:"https://tilecache.rainviewer.com", radar:{past:[{time,path}],nowcast:[...]}}`.
  - Tile layer URL per frame: `` `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png` `` (color 2 = Universal Blue). Animate `past.concat(nowcast)`; **nowcast can be EMPTY — handle 0 future frames.** `time` is unix seconds UTC → frame timestamp label in NY time; mark nowcast frames "forecast".
  - Frame paths expire: refetch weather-maps.json on each monitor tick / manual refresh (≥5 min apart), rebuild layers. Preload only adjacent frame; opacity ~0.7.
- Fallback if RainViewer JSON fails: `<img src="https://radar.weather.gov/ridge/standard/KOKX_loop.gif">` (no CORS — img only, don't fetch; don't reload more often than 2 min).

### Cross-cutting (from audit)

- All `begin_date`/day math from explicit date-part construction (never `toISOString().slice` for local dates; with time_zone=gmt use UTC parts).
- MAX_SLACK: request from day-before so the event bracketing window start is present.
- Refresh debounce 60 s on the manual refresh button.
- localStorage last-good cache per source; render stale immediately with "as of HH:MM" chip, then revalidate.
