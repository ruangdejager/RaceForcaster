import type { RacePlan } from '@raceforecaster/core';
import { dayClock } from '../format.js';

interface Props {
  plan: RacePlan;
}

/**
 * An honest note about forecast resolution.
 *
 * met.no publishes hour-by-hour detail for roughly the next 65 hours and only
 * 6-hourly blocks beyond that. Planning a race two weeks out is completely
 * reasonable, but the numbers deserve a caveat until race week — and the
 * caveat should disappear on its own once it stops being true, rather than
 * sitting there permanently teaching people to ignore it.
 */
export function ForecastNotice({ plan }: Props): JSX.Element | null {
  if (!plan.summary.hasCoarseForecast) return null;

  const from = plan.summary.coarseAfter;
  const allCoarse = from !== null && from <= plan.startTime;

  return (
    <p className="notice">
      {allCoarse ? (
        <>
          This far out the forecast is still MET Norway's 6-hourly outlook. It sharpens to precise
          hour-by-hour detail automatically, about 60 hours before each time — so it's worth
          checking back as race day approaches.
        </>
      ) : (
        <>
          Weather after <strong>{from !== null ? dayClock(plan.timezone, from) : 'later today'}</strong>{' '}
          is MET Norway's 6-hourly outlook. It sharpens to precise hour-by-hour detail automatically
          about 60 h before each time, as race day approaches.
        </>
      )}
    </p>
  );
}
