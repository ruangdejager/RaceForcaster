import { yrForecastUrl, type Route, type WeatherSample } from '@raceforecaster/core';
import { km } from '../format.js';

interface Props {
  weather: WeatherSample[];
  route: Route;
}

/** Nearest checkpoint within 500 m of a sample point, for a readable label. */
function nearestCheckpointName(route: Route, dist: number): string | null {
  for (const cp of route.checkpoints) {
    if (Math.abs(cp.dist - dist) < 500) return cp.name;
  }
  return null;
}

/**
 * Every coordinate the plan pulled a forecast for, with a link out to that
 * point's own page on YR.
 *
 * This isn't a list of physical weather stations — met.no is a gridded model,
 * not a station network — it's the actual points this plan queried. The
 * purpose is trust: if a number in the timeline looks off, this is how you
 * check it against the source yourself rather than take the app's
 * interpolation on faith.
 */
export function StationList({ weather, route }: Props): JSX.Element | null {
  if (weather.length === 0) return null;

  return (
    <section className="chart-card station-list" aria-label="Forecast points along the route">
      <h3>Forecast points</h3>
      <p className="chart-note" style={{ marginTop: 0, marginBottom: 10 }}>
        Where along the route the weather was actually looked up. Check any of them
        directly on YR.
      </p>

      <ul className="station-rows">
        {weather.map((sample) => {
          const cpName = nearestCheckpointName(route, sample.dist);
          return (
            <li key={`${sample.lat},${sample.lon}`} className="station-row">
              <span className="station-pos">
                <strong>{km(sample.dist)} km</strong>
                {cpName && <span className="station-cp"> · {cpName}</span>}
              </span>
              <span className="station-links">
                <a href={yrForecastUrl(sample.lat, sample.lon)} target="_blank" rel="noreferrer noopener">
                  YR
                </a>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
