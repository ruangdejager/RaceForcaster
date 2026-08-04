/**
 * "Feels like" temperature.
 *
 * Uses Steadman's Australian Apparent Temperature, the same basis YR shows, so
 * the numbers here agree with the app riders are already checking rather than
 * quietly disagreeing by two degrees.
 */

/** Water vapour pressure in hPa, from temperature and relative humidity. */
export function vapourPressureHpa(airTempC: number, relHumidityPct: number): number {
  const saturation = 6.105 * Math.exp((17.27 * airTempC) / (237.7 + airTempC));
  return (relHumidityPct / 100) * saturation;
}

/**
 * Steadman apparent temperature, °C.
 *
 * `windSpeedMs` is the airflow over the body: ambient wind for the standard
 * figure, or true airspeed for what a moving rider feels.
 */
export function apparentTemperature(
  airTempC: number,
  relHumidityPct: number,
  windSpeedMs: number,
): number {
  const e = vapourPressureHpa(airTempC, relHumidityPct);
  return airTempC + 0.33 * e - 0.7 * windSpeedMs - 4.0;
}

/**
 * Airspeed a rider actually feels, m/s.
 *
 * The air moves at some velocity over the ground and the rider moves through
 * it, so what hits you is the vector difference. A tailwind (negative
 * `headwindMs`) genuinely cancels part of your own speed; a crosswind adds to
 * it regardless of sign.
 */
export function riderAirspeedMs(
  headwindMs: number,
  crosswindMs: number,
  riderSpeedMs: number,
): number {
  return Math.hypot(headwindMs + riderSpeedMs, crosswindMs);
}
