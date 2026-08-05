import type { RacePlan } from '@raceforecaster/core';
import { useMemo } from 'react';
import { clock, km } from '../../format.js';
import { INK, linearScale, linePath, niceDomain, SERIES, ticks, timeTicks } from './plot.js';
import { useCrosshair } from './useCrosshair.js';

const W = 620;
const H = 158;
const PAD = { top: 10, right: 10, bottom: 22, left: 32 };

interface Props {
  plan: RacePlan;
}

/**
 * Air temperature against what it will feel like.
 *
 * Both series are degrees Celsius, so they share one axis — which is the whole
 * point. The gap between the two lines *is* the wind chill, and it is only
 * legible because they are drawn to the same scale.
 */
export function TemperatureChart({ plan }: Props): JSX.Element {
  const { samples, timezone } = plan;

  const geo = useMemo(() => {
    const start = samples[0]?.time ?? plan.startTime;
    const end = samples[samples.length - 1]?.time ?? plan.summary.finishTime;

    const values = samples.flatMap((s) => [s.weather.airTemp, s.weather.apparentTemp]);
    const domain = niceDomain(values, { minSpan: 6 });

    const x = linearScale([start, end], [PAD.left, W - PAD.right]);
    const y = linearScale(domain, [H - PAD.bottom, PAD.top]);

    return {
      x,
      y,
      domain,
      start,
      end,
      air: samples.map((s): [number, number] => [x(s.time), y(s.weather.airTemp)]),
      feels: samples.map((s): [number, number] => [x(s.time), y(s.weather.apparentTemp)]),
    };
  }, [samples, plan.startTime, plan.summary.finishTime]);

  const hoverXs = useMemo(() => samples.map((s) => geo.x(s.time)), [samples, geo]);
  const { svgRef, index, handlers } = useCrosshair(hoverXs);
  const hovered = index !== null ? samples[index] : null;

  return (
    <div className="chart-card">
      <h3>Temperature</h3>
      <div className="chart-key">
        <span>
          <i style={{ background: SERIES.primary }} />
          air temperature
        </span>
        <span>
          <i style={{ background: SERIES.secondary }} />
          feels like
        </span>
        {hovered && (
          <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text)' }}>
            {clock(timezone, hovered.time)} · {km(hovered.dist)} km ·{' '}
            {hovered.weather.airTemp.toFixed(1)}° (feels {hovered.weather.apparentTemp.toFixed(1)}°)
          </span>
        )}
      </div>

      <div className="chart-scroll">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Temperature along the route, ${plan.summary.minTemp.toFixed(1)} to ${plan.summary.maxTemp.toFixed(1)} degrees`}
          style={{ display: 'block', width: '100%', height: 'auto', touchAction: 'pan-y' }}
          {...handlers}
        >
          {ticks(geo.domain, 4).map((value) => (
            <g key={value}>
              <line
                x1={PAD.left}
                y1={geo.y(value)}
                x2={W - PAD.right}
                y2={geo.y(value)}
                stroke={INK.grid}
                strokeWidth={1}
              />
              <text x={PAD.left - 6} y={geo.y(value) + 3.5} fill={INK.dim} fontSize={10} textAnchor="end">
                {Math.round(value)}°
              </text>
            </g>
          ))}

          {timeTicks(geo.start, geo.end).map((t) => (
            <text key={t} x={geo.x(t)} y={H - 7} fill={INK.dim} fontSize={10} textAnchor="middle">
              {clock(timezone, t)}
            </text>
          ))}

          <path d={linePath(geo.feels)} fill="none" stroke={SERIES.secondary} strokeWidth={2} strokeLinejoin="round" />
          <path d={linePath(geo.air)} fill="none" stroke={SERIES.primary} strokeWidth={2} strokeLinejoin="round" />

          {hovered && (
            <g pointerEvents="none">
              <line
                x1={geo.x(hovered.time)}
                y1={PAD.top}
                x2={geo.x(hovered.time)}
                y2={H - PAD.bottom}
                stroke={INK.label}
                strokeWidth={1}
              />
              <circle cx={geo.x(hovered.time)} cy={geo.y(hovered.weather.apparentTemp)} r={4} fill={SERIES.secondary} stroke={INK.surface} strokeWidth={2} />
              <circle cx={geo.x(hovered.time)} cy={geo.y(hovered.weather.airTemp)} r={4} fill={SERIES.primary} stroke={INK.surface} strokeWidth={2} />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
