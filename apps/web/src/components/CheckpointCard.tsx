import { FACILITY_LABELS, type PlanCheckpoint } from '@raceforecaster/core';
import { clock, km, kmh, sentenceCase, stopLabel, temp, windLabel } from '../format.js';
import { WeatherIcon, weatherLabel } from './WeatherIcon.jsx';

interface Props {
  entry: PlanCheckpoint;
  timezone: string;
  onStopAdjust: (checkpointId: string, deltaMinutes: number) => void;
  onRemove: (checkpointId: string) => void;
}

/** Stop time steps in fives — nobody plans a checkpoint to the minute. */
const STEP_MINUTES = 5;

export function CheckpointCard({ entry, timezone, onStopAdjust, onRemove }: Props): JSX.Element {
  const { checkpoint: cp, weather } = entry;
  // Only ever true for a checkpoint someone added themselves, in this
  // browser, right now — real ones from the route file never get this id
  // shape, so there's no way to remove something the route actually defines.
  const isRemovable = cp.id.startsWith('cp-manual-');

  // The note is the organiser's own wording, and the facility tags were
  // inferred from it — so showing both prints the same list twice ("Food,
  // medic, toilet — Food & drink, rest spot, medic, toilet"). Prefer the human
  // sentence, and fall back to the tags only when there wasn't one.
  const description = cp.note?.trim()
    ? cp.note
    : cp.facilities.map((f) => FACILITY_LABELS[f]).join(', ');

  const adjust = (delta: number): void => {
    onStopAdjust(cp.id, delta);
  };

  return (
    <article className={`cp-card${cp.kind === 'water' ? ' cp-water' : ''}`}>
      <header className="cp-head">
        <h3 className="cp-name">
          <span className="diamond" aria-hidden="true">
            ◆
          </span>
          <span className="text">{cp.name}</span>
        </h3>
        <span className="cp-position">
          {km(cp.dist)} km · {Math.round(cp.ele)} m
          {isRemovable && (
            <button
              type="button"
              className="cp-remove"
              onClick={() => onRemove(cp.id)}
              aria-label={`Remove ${cp.name}`}
              title="Remove this checkpoint"
            >
              ×
            </button>
          )}
        </span>
      </header>

      {description && <p className="cp-facilities">{sentenceCase(description)}</p>}

      <div className="cp-times">
        <span className="clock-run">
          arrive <b>{clock(timezone, entry.arriveTime)}</b>
          {cp.stopMinutes > 0 && (
            <>
              {' · '}leave <b>{clock(timezone, entry.leaveTime)}</b>
            </>
          )}
        </span>

        <div className="cp-stop">
          <span className="stop-label">stop</span>
          <button
            type="button"
            onClick={() => adjust(-STEP_MINUTES)}
            disabled={cp.stopMinutes === 0}
            aria-label={`Reduce stop at ${cp.name}`}
          >
            −
          </button>
          <span className="stop-value" aria-live="polite">
            {stopLabel(cp.stopMinutes)}
          </span>
          <button
            type="button"
            onClick={() => adjust(STEP_MINUTES)}
            aria-label={`Increase stop at ${cp.name}`}
          >
            +
          </button>
        </div>
      </div>

      <div className="cp-weather">
        <WeatherIcon symbolCode={weather.symbolCode} isDark={entry.isDark} size={17} />
        <span>{weatherLabel(weather.symbolCode)}</span>
        <span>
          {temp(weather.airTemp)} (feels {temp(weather.apparentTemp)})
        </span>
        <span>
          {kmh(weather.windSpeed)} km/h {weather.windFromCompass}
        </span>
        {entry.nextLegWind && <span>next leg: {windLabel(entry.nextLegWind)}</span>}
      </div>
    </article>
  );
}
