/**
 * Generate a synthetic but realistic sample route, so the app has something to
 * demonstrate with and so end-to-end testing doesn't depend on anyone's
 * personal GPX file.
 *
 * The geometry is invented. It runs across the Eastern Cape between two real
 * towns at a plausible scale, with an elevation profile shaped like a long
 * gravel race: rolling for the first third, a serious climb in the middle, a
 * long descent to the coastal plain, then a flat run to the finish.
 *
 *   node scripts/make-sample-route.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Lives under the web app's public directory so the same file is served by the
// Vite dev server and by the production build, with no second copy to keep in
// sync and nothing extra to mount into the container.
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../apps/web/public/samples/demo-230km.gpx',
);

const TARGET_KM = 230;
const START = { lat: -33.2926, lon: 23.4909 }; // near Willowmore
const END = { lat: -34.0489, lon: 24.9182 }; // near Jeffreys Bay

const R = 6371008.8;
const toRad = (d) => (d * Math.PI) / 180;

function haversine(a, b) {
  const dPhi = toRad(b.lat - a.lat);
  const dLam = toRad(b.lon - a.lon);
  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLam / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Elevation control points: [km, metres]. */
const PROFILE = [
  [0, 700], [12, 760], [25, 720], [40, 850], [54, 910],
  [68, 820], [82, 640], [100, 529], [115, 610], [133, 562],
  [142, 690], [152, 770], [161, 820], [170, 520], [180, 59],
  [196, 90], [212, 60], [230, 20],
];

function elevationAt(km) {
  for (let i = 1; i < PROFILE.length; i++) {
    const [k1, e1] = PROFILE[i];
    const [k0, e0] = PROFILE[i - 1];
    if (km <= k1) {
      const f = (km - k0) / (k1 - k0);
      // Smoothstep between control points so the profile has no sharp kinks
      // and the gradient model sees something road-like.
      const s = f * f * (3 - 2 * f);
      return e0 + (e1 - e0) * s;
    }
  }
  return PROFILE[PROFILE.length - 1][1];
}

/**
 * A path from START to END with meander added, tuned so the travelled distance
 * lands on the target. `wiggle` scales the sideways excursion.
 */
function buildPath(wiggle, steps = 4600) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Straight-line interpolation plus two out-of-phase sine terms, which
    // gives long sweeping bends rather than a zigzag.
    const bendLat = Math.sin(t * Math.PI * 3) * 0.16 + Math.sin(t * Math.PI * 7) * 0.045;
    const bendLon = Math.cos(t * Math.PI * 2.5) * 0.12 - Math.sin(t * Math.PI * 5) * 0.05;
    points.push({
      lat: START.lat + (END.lat - START.lat) * t + bendLat * wiggle,
      lon: START.lon + (END.lon - START.lon) * t + bendLon * wiggle,
    });
  }
  return points;
}

function pathLengthKm(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return total / 1000;
}

// Binary search the meander amplitude that produces the target distance.
let lo = 0;
let hi = 6;
let path = buildPath(hi);
for (let i = 0; i < 50; i++) {
  const mid = (lo + hi) / 2;
  path = buildPath(mid);
  if (pathLengthKm(path) < TARGET_KM) lo = mid;
  else hi = mid;
}
path = buildPath((lo + hi) / 2);

// Attach cumulative distance and elevation.
let cum = 0;
const track = path.map((p, i) => {
  if (i > 0) cum += haversine(path[i - 1], p);
  const km = cum / 1000;
  return { ...p, km, ele: elevationAt(km) };
});

const totalKm = track[track.length - 1].km;

/** Checkpoints, at the distances a race of this length would put them. */
const CHECKPOINTS = [
  [54, 'CP1 Syphonia', 'Food & drink, rest spot, medic, toilet'],
  [100, 'CP2 Rietfontein', 'Check-in/out, provisions, drop boxes, mechanic, bike wash, medic, toilet'],
  [133, 'CP3 Hadley', 'Check-in/out, provisions, drop boxes, medic, toilet — the big climb starts after this'],
  [161, 'CP4 Toring', 'Check-in/out, provisions, drop boxes, mechanic, medic, toilet — top of the climb'],
  [180, 'CP5 Mimosa', 'Check-in/out, provisions, mechanic, medic, toilet — supporters allowed here'],
];

function pointAtKm(km) {
  let best = track[0];
  let bestDelta = Infinity;
  for (const p of track) {
    const delta = Math.abs(p.km - km);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = p;
    }
  }
  return best;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const waypoints = CHECKPOINTS.map(([km, name, desc]) => {
  const p = pointAtKm(km);
  return (
    `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">\n` +
    `    <ele>${p.ele.toFixed(1)}</ele>\n` +
    `    <name>${esc(name)}</name>\n` +
    `    <desc>${esc(desc)}</desc>\n` +
    `  </wpt>`
  );
}).join('\n');

const trkpts = track
  .map(
    (p) =>
      `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><ele>${p.ele.toFixed(1)}</ele></trkpt>`,
  )
  .join('\n');

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RaceForecaster sample generator" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Demo 230 km</name>
    <desc>Synthetic sample route for RaceForecaster. The geometry is invented and does not follow any real road.</desc>
  </metadata>
${waypoints}
  <trk>
    <name>Demo 230 km</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, gpx, 'utf8');

const ascent = track.reduce(
  (sum, p, i) => (i === 0 ? 0 : sum + Math.max(0, p.ele - track[i - 1].ele)),
  0,
);

console.log(`Wrote ${OUT}`);
console.log(`  ${track.length} track points`);
console.log(`  ${totalKm.toFixed(1)} km, ~${Math.round(ascent)} m ascent`);
console.log(`  ${CHECKPOINTS.length} checkpoints`);
