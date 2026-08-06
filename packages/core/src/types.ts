/**
 * Shared vocabulary for the whole planner.
 *
 * Units are stated on every field and never mixed: metres, m/s, °C, degrees
 * true, epoch milliseconds. Anything user-facing (km, km/h, local time) is
 * converted at the edge, not in here.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface TrackPoint extends LatLon {
  /** Metres above sea level. */
  ele: number;
  /** Cumulative distance from the start, metres. */
  dist: number;
}

export interface RoutePoint extends TrackPoint {
  /** Direction of travel, degrees clockwise from true north. */
  bearing: number;
  /** Gradient as a ratio: 0.05 is a 5% climb, negative is descending. */
  grade: number;
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export type FacilityId =
  | 'provisions'
  | 'water'
  | 'food'
  | 'drop_bags'
  | 'mechanic'
  | 'bike_wash'
  | 'medic'
  | 'toilet'
  | 'supporters'
  | 'shower'
  | 'sleep';

export type CheckpointKind = 'start' | 'checkpoint' | 'water' | 'finish';

export interface Checkpoint {
  id: string;
  name: string;
  /** Distance along the route, metres. */
  dist: number;
  lat: number;
  lon: number;
  /** Metres above sea level. */
  ele: number;
  kind: CheckpointKind;
  facilities: FacilityId[];
  /** Free text, e.g. "the big climb starts after this". */
  note?: string;
  /** Planned stationary time here, minutes. */
  stopMinutes: number;
}

export interface Route {
  id: string;
  name: string;
  /** Resampled to uniform spacing; see `RESAMPLE_SPACING_M`. */
  points: RoutePoint[];
  /** Metres. */
  totalDistance: number;
  /** Metres of cumulative climbing. */
  totalAscent: number;
  /** Metres of cumulative descending, positive number. */
  totalDescent: number;
  bounds: Bounds;
  /** IANA zone resolved from the start coordinate, e.g. "Africa/Johannesburg". */
  timezone: string;
  /** Checkpoints detected from GPX waypoints, plus the implicit start/finish. */
  checkpoints: Checkpoint[];
}

// --- Weather -------------------------------------------------------------

/**
 * met.no gives hour-by-hour detail for roughly the first 65 hours and only
 * 6-hourly blocks after that. Which one an individual forecast point came from
 * decides whether the UI should caveat it.
 */
export type ForecastResolution = '1h' | '6h';

export interface ForecastPoint {
  /** Epoch milliseconds, UTC. */
  t: number;
  /** °C. */
  airTemp: number;
  /** Percent, 0-100. */
  relHumidity: number;
  /** °C, null when the compact endpoint was used. */
  dewPoint: number | null;
  /** m/s. */
  windSpeed: number;
  /** Direction the wind blows FROM, degrees clockwise from true north. */
  windFromDeg: number;
  /** Percent, 0-100. */
  cloudPct: number;
  /** Percent, 0-100. */
  fogPct: number | null;
  uvIndex: number | null;
  /** hPa. */
  pressure: number | null;
  /** mm in the hour that follows. Coarse blocks are divided down to per-hour. */
  precipMmPerHour: number;
  /** met.no symbol id, e.g. "partlycloudy_day". */
  symbolCode: string | null;
  resolution: ForecastResolution;
}

export interface ForecastSeries {
  lat: number;
  lon: number;
  /** Metres above sea level that this forecast was requested for. */
  altitude: number;
  /** Ascending by `t`. */
  points: ForecastPoint[];
  /** Epoch ms this was retrieved. */
  fetchedAt: number;
}

/** A forecast series pinned to a position along the route. */
export interface WeatherSample {
  /** Distance along the route, metres. */
  dist: number;
  lat: number;
  lon: number;
  altitude: number;
  series: ForecastSeries;
}

export type WindRelation = 'head' | 'tail' | 'left' | 'right';

/** Fully resolved conditions for one rider position at one instant. */
export interface WeatherAt {
  /** °C. */
  airTemp: number;
  /** °C, Steadman apparent temperature. */
  apparentTemp: number;
  relHumidity: number;
  /** m/s. */
  windSpeed: number;
  /** Direction the wind blows FROM, degrees true. */
  windFromDeg: number;
  /** 16-point compass abbreviation of `windFromDeg`, e.g. "NNW". */
  windFromCompass: string;
  /** Wind angle relative to travel, -180..180. 0 is dead-on headwind. */
  windRelativeDeg: number;
  windRelation: WindRelation;
  /** Component along the direction of travel, m/s. Positive opposes you. */
  headwindMs: number;
  /** Component across the direction of travel, m/s. Positive is from the right. */
  crosswindMs: number;
  cloudPct: number;
  /** mm/h. */
  precipMmPerHour: number;
  symbolCode: string | null;
  resolution: ForecastResolution;
}

// --- Sun -----------------------------------------------------------------

export interface SunTimes {
  /** ISO date, YYYY-MM-DD, in the race's local zone. */
  date: string;
  /** Epoch ms, or null on a polar day/night. */
  sunrise: number | null;
  sunset: number | null;
}

export interface DarkSegment {
  /** Epoch ms. */
  fromTime: number;
  toTime: number;
  /** Metres along the route. */
  fromDist: number;
  toDist: number;
}

// --- Planning ------------------------------------------------------------

export interface RiderParams {
  riderMassKg: number;
  bikeMassKg: number;
  /** Drag area, m². 0.32 is a road bike on the hoods. */
  cdA: number;
  /** Coefficient of rolling resistance. */
  crr: number;
  /** Speeds are clamped into this band so descents stay believable, km/h. */
  minSpeedKmh: number;
  maxSpeedKmh: number;
  /** Fraction of pedal power that reaches the road. */
  drivetrainEfficiency: number;
}

/**
 * `ambient` matches what YR shows, so the numbers agree with the app riders
 * already check. `riding` adds your own speed to the airflow, which is what
 * you actually feel on the bike.
 */
export type ApparentTempMode = 'ambient' | 'riding';

export interface PlanSettings {
  /** Epoch ms. */
  startTime: number;
  /** Target *moving* average, km/h. Checkpoint stops are added on top. */
  targetSpeedKmh: number;
  rider: RiderParams;
  /** Checkpoint list including any user edits to names, facilities and stops. */
  checkpoints: Checkpoint[];
  apparentTempMode: ApparentTempMode;
}

/** One row of the plan: where you are, when, and what it's doing there. */
export interface PlanSample {
  /** Epoch ms. */
  time: number;
  /** Metres along the route. */
  dist: number;
  lat: number;
  lon: number;
  ele: number;
  /** Degrees true. */
  bearing: number;
  grade: number;
  /** Instantaneous riding speed at this point, km/h. */
  speedKmh: number;
  /**
   * Average moving speed from the start up to this point, km/h — distance
   * covered so far divided by moving time so far. Climb-heavy terrain early
   * on pulls this below the target average; descent-heavy terrain pushes it
   * above. Equals the target at the very start, where there's no distance to
   * average yet.
   */
  avgSpeedKmh: number;
  weather: WeatherAt;
  isDark: boolean;
}

export interface PlanCheckpoint {
  checkpoint: Checkpoint;
  /** Epoch ms. */
  arriveTime: number;
  leaveTime: number;
  /** Elapsed race time on arrival, seconds. */
  elapsedSeconds: number;
  weather: WeatherAt;
  isDark: boolean;
  /** Dominant wind relation over the leg to the next checkpoint. */
  nextLegWind: WindRelation | null;
}

export interface PlanSummary {
  /** Epoch ms. */
  finishTime: number;
  movingSeconds: number;
  stoppedSeconds: number;
  totalSeconds: number;
  minTemp: number;
  maxTemp: number;
  minApparentTemp: number;
  maxApparentTemp: number;
  /** Hours with measurable rain along the way. */
  rainHours: number;
  /** Total rainfall you ride through, mm. */
  totalRainMm: number;
  darkHours: number;
  totalStopMinutes: number;
  /** True when part of the race still only has 6-hourly forecast data. */
  hasCoarseForecast: boolean;
  /** Epoch ms after which the forecast is still coarse, null when all fine. */
  coarseAfter: number | null;
  headwindHours: number;
  tailwindHours: number;
}

export interface RacePlan {
  routeId: string;
  routeName: string;
  /** Epoch ms this plan was computed. */
  generatedAt: number;
  /** IANA zone for displaying every time in this plan. */
  timezone: string;
  startTime: number;
  totalDistance: number;
  totalAscent: number;
  settings: PlanSettings;
  /** Fine-grained series for the charts, one every `SAMPLE_INTERVAL_MIN`. */
  samples: PlanSample[];
  /** Timeline rows: the start instant, then each clock hour the race passes. */
  hours: PlanSample[];
  checkpoints: PlanCheckpoint[];
  darkSegments: DarkSegment[];
  summary: PlanSummary;
}
