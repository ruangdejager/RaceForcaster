/**
 * @raceforecaster/core
 *
 * Every piece of race-planning logic, with no dependency on Node, the DOM or
 * any HTTP client. The web app, the API and (later) the mobile app all import
 * this same code, so a plan computed on the server and one recomputed live in
 * the browser cannot drift apart.
 */

export * from './types.js';
export * from './constants.js';

// Geometry
export {
  angleDelta,
  compassPoint,
  haversineMetres,
  initialBearingDeg,
  lerpLatLon,
  normalize180,
  normalize360,
  toDeg,
  toRad,
} from './geo/distance.js';
export { simplify, simplifyIndices } from './geo/simplify.js';
export { indexAtDistance, pointAtDistance, resampleTrack, type RawPoint } from './geo/resample.js';
export { computeAscentDescent, computeGrades, movingAverage } from './geo/elevation.js';
export { prepareTrack, type PreparedTrack } from './geo/prepare.js';

// Route files
export {
  parseRouteFile,
  RouteParseError,
  type ParsedRouteFile,
  type ParsedWaypoint,
} from './gpx/parse.js';
export { ALL_FACILITIES, FACILITY_LABELS, inferFacilities } from './gpx/facilities.js';
export {
  buildRoute,
  checkpointAtDistance,
  type BuildRouteOptions,
  type BuildRouteResult,
} from './route/build.js';

// Time
export {
  formatTime,
  formatWeekday,
  localDateKey,
  offsetMsAt,
  offsetString,
  parseLocalDateTime,
  timezoneFor,
  toLocalDateTimeInput,
  zonedWallClockToUtc,
} from './time/timezone.js';

// Weather
export { coarseAfter, MetParseError, parseMetForecast, type MetForecastResponse } from './weather/met.js';
export { apparentTemperature, riderAirspeedMs, vapourPressureHpa } from './weather/apparent.js';
export {
  classifyWind,
  fromVector,
  kmhToMs,
  lerpWind,
  msToKmh,
  relativeWind,
  toVector,
  WIND_RELATION_LABELS,
  type RelativeWind,
  type WindVector,
} from './weather/wind.js';
export { resolveSeriesAt, weatherAt, type WeatherAtOptions } from './weather/interpolate.js';
export { describeSymbol, type SkyCategory, type SymbolInfo } from './weather/symbol.js';
export { chooseSampleLocations, roundCoord, type SampleLocation } from './weather/sampling.js';
export { yrForecastUrl } from './weather/links.js';

// Sun
export {
  createDaylightLookup,
  darkHours,
  datesSpanned,
  toDarkSegments,
  type DaylightLookup,
} from './sun/daylight.js';

// Pacing
export { airDensity, powerForSpeed, speedForPower } from './pacing/physics.js';
export {
  computePacing,
  distanceAtElapsed,
  movingSecondsAtDistance,
  stoppedSecondsBefore,
  type PacingResult,
} from './pacing/model.js';

// Planning
export { buildPlan, PlanError, type BuildPlanInput } from './plan/build.js';
