import type { RacePlan } from '@raceforecaster/core';
import { clock, dayClock, duration, km } from '../format.js';
import { CheckpointCard } from './CheckpointCard.jsx';
import { HourCard } from './HourCard.jsx';

interface Props {
  plan: RacePlan;
  onStopAdjust: (checkpointId: string, deltaMinutes: number) => void;
}

type Row =
  | { kind: 'hour'; time: number; index: number }
  | { kind: 'checkpoint'; time: number; index: number };

/**
 * The race as one chronological column: every clock hour you'll be riding
 * through, with checkpoints slotted in at the moment you reach them.
 *
 * A single ordered list rather than two parallel ones, because the question a
 * rider is asking is "what happens next", and the answer alternates between
 * the two kinds of row.
 */
export function Timeline({ plan, onStopAdjust }: Props): JSX.Element {
  const rows: Row[] = [
    ...plan.hours.map((h, index): Row => ({ kind: 'hour', time: h.time, index })),
    ...plan.checkpoints.map((c, index): Row => ({ kind: 'checkpoint', time: c.arriveTime, index })),
  ].sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time;
    // A checkpoint reached exactly on the hour reads better after the hour row.
    return a.kind === 'hour' ? -1 : 1;
  });

  return (
    <section className="timeline" aria-label="Race timeline">
      {rows.map((row) => {
        if (row.kind === 'hour') {
          const sample = plan.hours[row.index];
          if (!sample) return null;
          return (
            <HourCard
              key={`h-${sample.time}`}
              sample={sample}
              timezone={plan.timezone}
              label={clock(plan.timezone, sample.time)}
            />
          );
        }

        const entry = plan.checkpoints[row.index];
        if (!entry) return null;
        return (
          <CheckpointCard
            key={`c-${entry.checkpoint.id}`}
            entry={entry}
            timezone={plan.timezone}
            onStopAdjust={onStopAdjust}
          />
        );
      })}

      <FinishBanner plan={plan} />
    </section>
  );
}

function FinishBanner({ plan }: { plan: RacePlan }): JSX.Element {
  return (
    <div className="finish-banner">
      <span className="finish-flag" aria-hidden="true">
        🏁
      </span>
      <div>
        <div className="finish-label">Planned finish</div>
        <div className="finish-time">{dayClock(plan.timezone, plan.summary.finishTime)}</div>
      </div>
      <div className="finish-right">
        <div>{km(plan.totalDistance)} km</div>
        <div className="big">{duration(plan.summary.totalSeconds)} total</div>
      </div>
    </div>
  );
}
