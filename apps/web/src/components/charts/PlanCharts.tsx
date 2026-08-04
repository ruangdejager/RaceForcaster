import type { RacePlan } from '@raceforecaster/core';
import { SkyChart } from './SkyChart.jsx';
import { TemperatureChart } from './TemperatureChart.jsx';
import { WindChart } from './WindChart.jsx';
import { WindDirectionMap } from './WindDirectionMap.jsx';

interface Props {
  plan: RacePlan;
}

/**
 * The detail panels, in the order the questions get asked: how cold will it be,
 * will it rain on me, how hard is the wind, and where does it turn against me.
 *
 * Every value plotted here also appears as text in the hourly timeline, which
 * is the table view for all four — no number is reachable only by hovering.
 */
export function PlanCharts({ plan }: Props): JSX.Element {
  return (
    <section className="charts" aria-label="Conditions in detail">
      <TemperatureChart plan={plan} />
      <SkyChart plan={plan} />
      <WindChart plan={plan} />
      <WindDirectionMap plan={plan} />
    </section>
  );
}
