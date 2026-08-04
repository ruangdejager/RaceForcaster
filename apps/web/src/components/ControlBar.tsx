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
        <div className="chips">
          <Chip
            icon="🏁"
            label={`${dayClock(timezone, summary.finishTime)} finish`}
            title={`${duration(summary.totalSeconds)} total, ${duration(summary.movingSeconds)} of it moving`}
          />
          <Chip
            icon="🌡"
            label={`${summary.minTemp.toFixed(1)}–${summary.maxTemp.toFixed(1)}°C temps`}
            title={`Feels like ${summary.minApparentTemp.toFixed(1)}–${summary.maxApparentTemp.toFixed(1)}°C`}
          />
          <Chip
            icon="🌧"
            label={summary.rainHours > 0 ? `${hours(summary.rainHours)} rain` : 'no rain'}
            title={
              summary.totalRainMm > 0
                ? `About ${summary.totalRainMm.toFixed(1)} mm falls while you're out`
                : 'No rain forecast along the route'
            }
          />
          <Chip
            icon={summary.darkHours > 0 ? '🌙' : '☀'}
            label={summary.darkHours > 0 ? `${hours(summary.darkHours)} dark` : 'all daylight'}
          />
          <Chip
            icon="⏱"
            label={`${stopLabel(summary.totalStopMinutes)} CP stops`}
            title="Total planned time stationary at checkpoints"
          />
          {summary.headwindHours > 0.25 && (
            <Chip icon="↓" label={`${hours(summary.headwindHours)} headwind`} />
          )}
          {summary.tailwindHours > 0.25 && (
            <Chip icon="↑" label={`${hours(summary.tailwindHours)} tailwind`} />
          )}
        </div>
      )}
    </section>
  );
}

function Chip({
  icon,
  label,
  title,
}: {
  icon: string;
  label: string;
  title?: string;
}): JSX.Element {
  return (
    <span className="chip" title={title}>
      <span className="chip-icon" aria-hidden="true">
        {icon}
      </span>
      <strong>{label}</strong>
    </span>
  );
}
