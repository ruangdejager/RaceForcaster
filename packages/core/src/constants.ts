import type { RiderParams } from './types.js';

// --- Track preparation ---------------------------------------------------

/** Uniform spacing the route is redrawn at, metres. */
export const RESAMPLE_SPACING_M = 100;

/** Douglas-Peucker tolerance, metres. Small enough to keep every real corner. */
export const SIMPLIFY_TOLERANCE_M = 1.5;

/** Half-width of the elevation smoothing window, metres. */
export const ELEVATION_SMOOTH_HALF_M = 150;

/** Half-span of the central difference used for gradients, metres. */
export const GRADE_HALF_SPAN_M = 100;

/**
 * Half-span of the chord used for direction of travel, metres.
 *
 * Wind is something you experience over a stretch of road, not at a point, so
 * a longer chord is not just cheaper — it stops a single switchback flipping
 * the label from tailwind to headwind and back within one card.
 */
export const BEARING_HALF_SPAN_M = 200;

/** Wobbles smaller than this don't count towards total ascent, metres. */
export const ASCENT_THRESHOLD_M = 1;

// --- Weather sampling ----------------------------------------------------

/**
 * Target spacing between forecast lookups along the route, metres.
 *
 * met.no's model resolution is roughly 1 km, but weather does not change
 * meaningfully every kilometre. 15 km keeps a 230 km route to ~16 requests
 * while never leaving the rider more than 7.5 km from a sampled point.
 */
export const WEATHER_SAMPLE_SPACING_M = 15_000;

/** Hard ceiling on forecast lookups for one route, however long it is. */
export const MAX_WEATHER_SAMPLES = 40;

/**
 * Standard atmospheric lapse rate, °C per metre of altitude.
 *
 * Applied between the altitude a forecast was requested for and the rider's
 * actual altitude. Without it a summit checkpoint reads several degrees warmer
 * than it will be, which is the difference between packing a jacket and not.
 */
export const TEMP_LAPSE_RATE_C_PER_M = 0.0065;

/** Below this, rainfall isn't worth mentioning. mm/h. */
export const RAIN_THRESHOLD_MM_PER_H = 0.05;

// --- Planning ------------------------------------------------------------

/** Spacing of the fine-grained plan samples used by the charts, minutes. */
export const SAMPLE_INTERVAL_MIN = 15;

export const DEFAULT_RIDER: RiderParams = {
  riderMassKg: 78,
  bikeMassKg: 10,
  cdA: 0.32,
  crr: 0.005,
  minSpeedKmh: 4,
  maxSpeedKmh: 65,
  drivetrainEfficiency: 0.97,
};

/** Standard gravity, m/s². */
export const GRAVITY = 9.80665;

/** Air density at sea level, 15 °C, kg/m³. */
export const AIR_DENSITY_SEA_LEVEL = 1.225;
