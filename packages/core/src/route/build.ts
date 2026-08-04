import type { Checkpoint, Route, RoutePoint } from '../types.js';
import { haversineMetres } from '../geo/distance.js';
import { prepareTrack } from '../geo/prepare.js';
import { inferFacilities } from '../gpx/facilities.js';
import { parseRouteFile, type ParsedWaypoint } from '../gpx/parse.js';
import { timezoneFor } from '../time/timezone.js';

/**
 * A waypoint further than this from the track isn't on the route — it's a
 * nearby POI the organiser bundled into the same file.
 */
const MAX_SNAP_DISTANCE_M = 2000;

/** Waypoints closer together than this along the route are treated as one. */
const DEDUPE_DISTANCE_M = 250;

export interface BuildRouteOptions {
  id: string;
  /** Overrides the name embedded in the file, e.g. the uploaded filename. */
  name?: string;
}

export interface BuildRouteResult {
  route: Route;
  /** Non-fatal problems worth telling the rider about. */
  warnings: string[];
}

interface Snapped {
  waypoint: ParsedWaypoint;
  index: number;
  dist: number;
  offRouteM: number;
}

/** Nearest track point to a coordinate, by brute force. */
function snapToTrack(points: readonly RoutePoint[], lat: number, lon: number): Snapped | null {
  let bestIdx = -1;
  let bestDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    const d = haversineMetres({ lat, lon }, p);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  const best = points[bestIdx];
  if (!best) return null;
  return {
    waypoint: { name: '', lat, lon, ele: null, description: '', kind: 'checkpoint' },
    index: bestIdx,
    dist: best.dist,
    offRouteM: bestDist,
  };
}

function buildCheckpoints(
  points: readonly RoutePoint[],
  waypoints: readonly ParsedWaypoint[],
  warnings: string[],
): Checkpoint[] {
  const snapped: Snapped[] = [];

  for (const wpt of waypoints) {
    const hit = snapToTrack(points, wpt.lat, wpt.lon);
    if (!hit) continue;
    if (hit.offRouteM > MAX_SNAP_DISTANCE_M) {
      warnings.push(
        `Skipped "${wpt.name}": it sits ${(hit.offRouteM / 1000).toFixed(1)} km off the route.`,
      );
      continue;
    }
    snapped.push({ ...hit, waypoint: wpt });
  }

  snapped.sort((a, b) => a.dist - b.dist);

  const checkpoints: Checkpoint[] = [];
  let lastDist = Number.NEGATIVE_INFINITY;

  for (const s of snapped) {
    if (s.dist - lastDist < DEDUPE_DISTANCE_M && checkpoints.length > 0) continue;
    lastDist = s.dist;

    const point = points[s.index];
    if (!point) continue;

    checkpoints.push({
      id: `cp-${checkpoints.length + 1}`,
      name: s.waypoint.name,
      dist: s.dist,
      lat: point.lat,
      lon: point.lon,
      ele: s.waypoint.ele ?? point.ele,
      kind: s.waypoint.kind,
      facilities: inferFacilities(s.waypoint.name, s.waypoint.description),
      ...(s.waypoint.description ? { note: s.waypoint.description } : {}),
      // Zero by default so the plan only ever reflects stops the rider has
      // actually decided on. The summary chip makes the total obvious.
      stopMinutes: 0,
    });
  }

  return checkpoints;
}

/** Parse an uploaded route file into the fully prepared `Route` the planner uses. */
export function buildRoute(xml: string, options: BuildRouteOptions): BuildRouteResult {
  const parsed = parseRouteFile(xml);
  const warnings: string[] = [];

  const track = prepareTrack(parsed.points);
  if (track.points.length < 2) {
    throw new Error('The route is too short to plan against.');
  }

  if (!parsed.hasElevation) {
    warnings.push(
      'This file has no elevation data, so the route is treated as flat. Arrival times will be less accurate on hilly courses.',
    );
  }

  const start = track.points[0];
  const timezone = start ? timezoneFor(start.lat, start.lon) : 'UTC';

  const checkpoints = buildCheckpoints(track.points, parsed.waypoints, warnings);
  if (parsed.waypoints.length === 0) {
    warnings.push(
      'No waypoints in the file, so no checkpoints were detected. You can add them by distance.',
    );
  }

  const route: Route = {
    id: options.id,
    name: options.name?.trim() || parsed.name,
    points: track.points,
    totalDistance: track.totalDistance,
    totalAscent: track.totalAscent,
    totalDescent: track.totalDescent,
    bounds: track.bounds,
    timezone,
    checkpoints,
  };

  return { route, warnings };
}

/** Add a checkpoint at an arbitrary distance, for routes without waypoints. */
export function checkpointAtDistance(
  route: Route,
  distM: number,
  name: string,
): Checkpoint | null {
  const clamped = Math.max(0, Math.min(route.totalDistance, distM));
  let best: RoutePoint | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const p of route.points) {
    const delta = Math.abs(p.dist - clamped);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = p;
    }
  }
  if (!best) return null;

  return {
    id: `cp-manual-${Math.round(clamped)}`,
    name,
    dist: best.dist,
    lat: best.lat,
    lon: best.lon,
    ele: best.ele,
    kind: 'checkpoint',
    facilities: [],
    stopMinutes: 0,
  };
}
