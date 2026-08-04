import { AIR_DENSITY_SEA_LEVEL, GRAVITY } from '../constants.js';
import type { RiderParams } from '../types.js';

/**
 * Air density from altitude, kg/m³, via the ISA barometric formula.
 *
 * Worth doing rather than assuming sea level: at 2000 m the air is ~18%
 * thinner, which is several minutes over a long climb-heavy race.
 */
export function airDensity(altitudeM: number): number {
  const h = Math.max(0, altitudeM);
  // Exponent 4.25588, not the 5.25588 of the pressure formula: density falls
  // more slowly than pressure because the air is also getting colder.
  // Sanity check: this gives 1.007 kg/m³ at 2000 m, the ISA figure.
  return AIR_DENSITY_SEA_LEVEL * (1 - 2.25577e-5 * h) ** 4.25588;
}

/**
 * Steady-state speed for a given power on a given gradient.
 *
 * Power at the wheel balances three resistances:
 *
 *   P = v · ( m·g·sin θ  +  Crr·m·g·cos θ  +  ½·ρ·CdA·v² )
 *              gravity        rolling            drag
 *
 * which rearranges to a cubic `a·v³ + b·v − P = 0`. Rather than Cardano with
 * its sign cases, solve by bisection: `f` is strictly increasing above its
 * turning point, `f` there is always negative for positive power, so a
 * bracket always exists and the search cannot fail. Thirty iterations put the
 * answer well inside a millimetre per second.
 */
export function speedForPower(powerW: number, grade: number, rider: RiderParams, altitudeM: number): number {
  const mass = rider.riderMassKg + rider.bikeMassKg;
  const theta = Math.atan(grade);
  const wheelPower = Math.max(1, powerW * rider.drivetrainEfficiency);

  const a = 0.5 * airDensity(altitudeM) * rider.cdA;
  const b = mass * GRAVITY * (Math.sin(theta) + rider.crr * Math.cos(theta));

  const f = (v: number): number => a * v * v * v + b * v - wheelPower;

  // Turning point of f for v > 0; zero whenever b >= 0 (flat or climbing).
  let lo = b < 0 ? Math.sqrt(-b / (3 * a)) : 0;
  let hi = Math.max(lo + 1, 30);
  while (f(hi) < 0 && hi < 1000) hi *= 2;

  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }

  return (lo + hi) / 2;
}

/** Power needed to hold a speed on a gradient — the inverse of the above. */
export function powerForSpeed(
  speedMs: number,
  grade: number,
  rider: RiderParams,
  altitudeM: number,
): number {
  const mass = rider.riderMassKg + rider.bikeMassKg;
  const theta = Math.atan(grade);
  const a = 0.5 * airDensity(altitudeM) * rider.cdA;
  const b = mass * GRAVITY * (Math.sin(theta) + rider.crr * Math.cos(theta));
  return (a * speedMs ** 3 + b * speedMs) / rider.drivetrainEfficiency;
}
