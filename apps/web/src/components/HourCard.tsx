import type { PlanSample } from '@raceforecaster/core';
import { km, kmh, rainDescription, temp, windLabel } from '../format.js';
import { WeatherIcon, weatherLabel } from './WeatherIcon.jsx';
import { WindArrow } from './WindArrow.jsx';

interface Props {
  sample: PlanSample;
  timezone: string;
  /** Local clock time, precomputed by the timeline. */
  label: string;
}

export function HourCard({ sample, label }: Props): JSX.Element {
  const w = sample.weather;
  const rain = rainDescription(w.precipMmPerHour);

  return (
    <article className={`hour-card${sample.isDark ? ' dark-hour' : ''}`}>
      <div className="hour-when">
        <div className="clock">{label}</div>
        <div className="km">{km(sample.dist)} km</div>
      </div>

      <div className="hour-main">
        <div className="hour-sky">
          <WeatherIcon symbolCode={w.symbolCode} isDark={sample.isDark} size={20} />
          <span className="label">{weatherLabel(w.symbolCode)}</span>
          {w.resolution === '6h' && (
            <span className="coarse-tag" title="Still a 6-hourly outlook at this time">
              6h
            </span>
          )}
        </div>

        <div className="hour-wind">
          <WindArrow windRelativeDeg={w.windRelativeDeg} relation={w.windRelation} />
          <span>
            {kmh(w.windSpeed)} km/h {w.windFromCompass}
          </span>
          <span className="dim">·</span>
          <span>{windLabel(w.windRelation)}</span>
          {rain && (
            <>
              <span className="dim">·</span>
              <span className="rain-tag">
                {rain} {w.precipMmPerHour.toFixed(1)} mm/h
              </span>
            </>
          )}
        </div>
      </div>

      <div className="hour-temp">
        <div className="value">{temp(w.airTemp)}</div>
        <div className="feels">feels {temp(w.apparentTemp)}</div>
      </div>
    </article>
  );
}
