import {
  parseLocalDateTime,
  toLocalDateTimeInput,
  type PlanSettings,
  type RacePlan,
} from '@raceforecaster/core';
import { dayClock, duration, hours, stopLabel } from '../format.js';

interface Props {
  settings: PlanSettings;
  plan: RacePlan | null;
  timezone: string;
  onSpeedChange: (kmh: number) => void;
  onStartTimeChange: (epochMs: number) => void;
}

const SPEED_STEP = 0.5;
const SPEED_MIN = 8;
const SPEED_MAX = 45;

/**
 * The two inputs that define a plan — how fast, and from when — with the
 * consequences right underneath them.
 *
 * Kept as one block so the cause and its effect are never more than a glance
 * apart: nudge the speed and the finish time, the temperature range and the
 * hours in the dark all move together.
 */
export function ControlBar({
  settings,
  plan,
  timezone,
  onSpeedChange,
  onStartTimeChange,
}: Props): JSX.Element {
  const handleStart = (value: string): void => {
    const parsed = parseLocalDateTime(value, timezone);
    if (parsed !== null) onStartTimeChange(parsed);
  };

  const summary = plan?.summary;

  return (
    <section className="controls" aria-label="Plan settings">
      <div className="speed-row">
        <button
          type="button"
          className="step-button"
          onClick={() => onSpeedChange(settings.targetSpeedKmh - SPEED_STEP)}
          disabled={settings.targetSpeedKmh <= SPEED_MIN}
          aria-label="Decrease average speed"
        >
          −
        </button>

        <div className="speed-value">
          <strong>{settings.targetSpeedKmh.toFixed(1)}</strong>
          <span>km/h avg</span>
        </div>

        <button
          type="button"
          className="step-button"
          onClick={() => onSpeedChange(settings.targetSpeedKmh + SPEED_STEP)}
          disabled={settings.targetSpeedKmh >= SPEED_MAX}
          aria-label="Increase average speed"
        >
          +
        </button>

        <input
          className="speed-slider"
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          value={settings.targetSpeedKmh}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          aria-label="Average speed in kilometres per hour"
        />

        <div className="start-field">
          <label htmlFor="start-time">Start</label>
          <input
            id="start-time"
            type="datetime-local"
            value={toLocalDateTimeInput(timezone, settings.startTime)}
            onChange={(e) => handleStart(e.target.value)}
          />
        </div>
      </div>

      {summary && (
        <div className="stats">
          <StatTile
            label="Finish"
            value={dayClock(timezone, summary.finishTime)}
            title={`${duration(summary.movingSeconds)} moving, ${duration(summary.stoppedSeconds)} stopped`}
          />
          <StatTile
            label="Total"
            value={duration(summary.totalSeconds)}
            title={`${duration(summary.movingSeconds)} moving + ${duration(summary.stoppedSeconds)} at checkpoints`}
          />
          <StatTile
            label="Temp"
            value={`${summary.minTemp.toFixed(1)}–${summary.maxTemp.toFixed(1)}°`}
            title={`Feels like ${summary.minApparentTemp.toFixed(1)}–${summary.maxApparentTemp.toFixed(1)}°C`}
          />
          <StatTile
            label="Rain"
            value={summary.rainHours > 0 ? hours(summary.rainHours) : 'none'}
            critical={summary.rainHours > 0}
            title={
              summary.totalRainMm > 0
                ? `About ${summary.totalRainMm.toFixed(1)} mm falls while you're out`
                : 'No rain forecast along the route'
            }
          />
          <StatTile label="Dark" value={summary.darkHours > 0 ? hours(summary.darkHours) : 'none'} />
          <StatTile
            label="CP stops"
            value={stopLabel(summary.totalStopMinutes)}
            title="Total planned time stationary at checkpoints"
          />
          {summary.headwindHours > 0.25 && (
            <StatTile label="Headwind" value={hours(summary.headwindHours)} critical />
          )}
          {summary.tailwindHours > 0.25 && (
            <StatTile label="Tailwind" value={hours(summary.tailwindHours)} />
          )}
        </div>
      )}
    </section>
  );
}

function StatTile({
  label,
  value,
  title,
  critical,
}: {
  label: string;
  value: string;
  title?: string;
  critical?: boolean;
}): JSX.Element {
  return (
    <div className="stat-tile" title={title}>
      <span className="stat-label">{label}</span>
      <span className={critical ? 'stat-value stat-value-critical' : 'stat-value'}>{value}</span>
    </div>
  );
}
