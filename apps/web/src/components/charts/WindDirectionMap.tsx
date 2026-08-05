import type { RacePlan } from '@raceforecaster/core';
import { useMemo } from 'react';
import { clock, km, windLabel } from '../../format.js';
import { INK, linePath, SERIES } from './plot.js';

const W = 620;
const H = 300;
const PAD = 22;

interface Props {
  plan: RacePlan;
}

/**
 * The route seen from above, with the wind drawn on it.
 *
 * The other charts answer "when"; this one answers "where". A wind that is
 * merely inconvenient for the first half becomes the whole story once the route
 * turns into it, and that turn is a fact about the map, not about the clock.
 * Arrows point the way the wind blows and grow with its strength.
 */
export function WindDirectionMap({ plan }: Props): JSX.Element {
  const { samples } = plan;

  const geo = useMemo(() => {
    if (samples.length === 0) return null;

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const s of samples) {
      minLat = Math.min(minLat, s.lat);
      maxLat = Math.max(maxLat, s.lat);
      minLon = Math.min(minLon, s.lon);
      maxLon = Math.max(maxLon, s.lon);
    }
    if (!Number.isFinite(minLat)) return null;

    // Work in metres so the route isn't stretched: a degree of longitude is
    // shorter than a degree of latitude everywhere but the equator.
    const midLat = (minLat + maxLat) / 2;
    const lonScale = Math.cos((midLat * Math.PI) / 180);

    const spanX = Math.max(1e-9, (maxLon - minLon) * lonScale);
    const spanY = Math.max(1e-9, maxLat - minLat);

    const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
    const offsetX = (W - spanX * scale) / 2;
    const offsetY = (H - spanY * scale) / 2;

    const project = (lat: number, lon: number): [number, number] => [
      offsetX + (lon - minLon) * lonScale * scale,
      // Flip: latitude grows north, SVG y grows downward.
      offsetY + (maxLat - lat) * scale,
    ];

    const maxWind = Math.max(1, ...samples.map((s) => s.weather.windSpeed));

    return {
      project,
      maxWind,
      track: samples.map((s) => project(s.lat, s.lon)),
    };
  }, [samples]);

  if (!geo) return <div className="chart-card">No route to draw.</div>;

  // Thin the arrows out so they read as a field rather than a hedge.
  const arrowStride = Math.max(1, Math.round(samples.length / 22));
  const arrows = samples.filter((_, i) => i % arrowStride === 0);

  const first = samples[0];
  const last = samples[samples.length - 1];

  return (
    <div className="chart-card">
      <h3>Wind along the route</h3>
      <div className="chart-key">
        <span>
          <i style={{ background: INK.accent }} />
          route
        </span>
        <span>
          <i style={{ background: SERIES.secondary }} />
          wind direction, longer is stronger
        </span>
      </div>

      <div className="chart-scroll">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Map of the route with arrows showing which way the wind blows at each point"
          style={{ display: 'block', width: '100%', height: 'auto' }}
        >
          <path
            d={linePath(geo.track)}
            fill="none"
            stroke={INK.accent}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {arrows.map((s) => {
            const [x, y] = geo.project(s.lat, s.lon);
            // Direction the wind blows towards, in screen space.
            const toDeg = s.weather.windFromDeg + 180;
            const rad = (toDeg * Math.PI) / 180;
            const length = 7 + (s.weather.windSpeed / geo.maxWind) * 15;
            const dx = Math.sin(rad) * length;
            const dy = -Math.cos(rad) * length;

            return (
              <g key={s.time} opacity={0.92}>
                <line
                  x1={x - dx / 2}
                  y1={y - dy / 2}
                  x2={x + dx / 2}
                  y2={y + dy / 2}
                  stroke={SERIES.secondary}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                />
                {/*
                  Apex at (0,-7): the point furthest from the line's centre,
                  in the direction the arrow is rotated to. Base corners sit
                  back at y=0, coincident with the translate origin (the
                  line's outward end). Getting this backward — apex nearer
                  the origin than the base — draws every arrow pointing
                  opposite the line it's attached to, which is what was
                  happening before: the arrowhead read as the wind's origin
                  rather than where it blows to.
                */}
                <path
                  d="M0 -7 L-3.2 0 L3.2 0 Z"
                  fill={SERIES.secondary}
                  transform={`translate(${x + dx / 2} ${y + dy / 2}) rotate(${toDeg})`}
                />
              </g>
            );
          })}

          {first && (
            <circle
              {...markerProps(geo.project(first.lat, first.lon))}
              fill={SERIES.tertiary}
              stroke={INK.surface}
              strokeWidth={2}
            />
          )}
          {last && (
            <circle
              {...markerProps(geo.project(last.lat, last.lon))}
              fill="#e05a4e"
              stroke={INK.surface}
              strokeWidth={2}
            />
          )}

          {plan.checkpoints.map((cp) => {
            const [x, y] = geo.project(cp.checkpoint.lat, cp.checkpoint.lon);
            return (
              <circle key={cp.checkpoint.id} cx={x} cy={y} r={3.2} fill={INK.surface} stroke={INK.accent} strokeWidth={2}>
                <title>
                  {cp.checkpoint.name} · {km(cp.checkpoint.dist)} km ·{' '}
                  {clock(plan.timezone, cp.arriveTime)} ·{' '}
                  {cp.nextLegWind ? windLabel(cp.nextLegWind) : ''}
                </title>
              </circle>
            );
          })}
        </svg>
      </div>

      <p className="chart-note">
        Hourly wind over the route at your position — arrows point where the wind blows, longer is
        stronger. Green is the start, red the finish, rings are checkpoints.
      </p>
    </div>
  );
}

function markerProps([cx, cy]: [number, number]) {
  return { cx, cy, r: 5 };
}
