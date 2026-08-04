/**
 * Elevation smoothing and gradient extraction.
 *
 * Consumer GPS elevation is noisy at the metre level. Differentiating it raw
 * produces instantaneous gradients of ±40% on flat ground, which would make
 * the pacing model lurch between walking pace and terminal velocity. Every
 * gradient in the planner therefore comes from the smoothed profile.
 */

/** Centred moving average, O(n) via prefix sums. */
export function movingAverage(values: readonly number[], halfWindow: number): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (halfWindow <= 0) return [...values];

  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    prefix[i + 1] = (prefix[i] ?? 0) + (values[i] ?? 0);
  }

  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(n - 1, i + halfWindow);
    out[i] = ((prefix[hi + 1] ?? 0) - (prefix[lo] ?? 0)) / (hi - lo + 1);
  }
  return out;
}

/**
 * Gradient at each point as a ratio, by central difference across
 * `halfWindow` samples either side.
 */
export function computeGrades(
  elevations: readonly number[],
  spacingM: number,
  halfWindow: number,
): number[] {
  const n = elevations.length;
  const out = new Array<number>(n).fill(0);
  if (n < 2 || spacingM <= 0) return out;

  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - halfWindow);
    const hi = Math.min(n - 1, i + halfWindow);
    const run = (hi - lo) * spacingM;
    if (run <= 0) continue;
    const rise = (elevations[hi] ?? 0) - (elevations[lo] ?? 0);
    out[i] = rise / run;
  }
  return out;
}

export interface AscentDescent {
  ascent: number;
  descent: number;
}

/**
 * Total climbing and descending, metres.
 *
 * Runs on the smoothed profile and additionally ignores wobbles below
 * `thresholdM`, so a flat road doesn't accumulate hundreds of phantom metres.
 */
export function computeAscentDescent(
  elevations: readonly number[],
  thresholdM = 1,
): AscentDescent {
  let ascent = 0;
  let descent = 0;
  if (elevations.length < 2) return { ascent, descent };

  let anchor = elevations[0] ?? 0;
  let direction: 1 | -1 | 0 = 0;

  for (let i = 1; i < elevations.length; i++) {
    const e = elevations[i] ?? 0;
    const delta = e - anchor;

    if (direction === 0) {
      if (Math.abs(delta) >= thresholdM) {
        direction = delta > 0 ? 1 : -1;
        if (direction === 1) ascent += delta;
        else descent -= delta;
        anchor = e;
      }
      continue;
    }

    if (direction === 1) {
      if (delta > 0) {
        ascent += delta;
        anchor = e;
      } else if (-delta >= thresholdM) {
        // Reversal large enough to be real rather than noise.
        direction = -1;
        descent -= delta;
        anchor = e;
      }
    } else {
      if (delta < 0) {
        descent -= delta;
        anchor = e;
      } else if (delta >= thresholdM) {
        direction = 1;
        ascent += delta;
        anchor = e;
      }
    }
  }

  return { ascent, descent };
}
