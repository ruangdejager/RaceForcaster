import type { RacePlan } from '@raceforecaster/core';
import { useMemo } from 'react';
import { clock, km, windLabel } from '../../format.js';
import { INK, linearScale, linePath, niceDomain, SERIES, ticks, timeTicks } from './plot.js';
import { useCrosshair } from './useCrosshair.js';

const W = 620;
const H = 172;
const PAD = { top: 10, right: 10, bottom: 22, left: 34 };

interface Props {
  plan: RacePlan;
}

/**
 * Wind speed, and how much of it is actually against you.
 *
 * Both series are km/h on one axis — legitimately, because they are the same
 * quantity: the second is the first resolved onto your direction of travel.
 * That's the number that matters. A 25 km/h crosswind is unpleasant; a 25 km/h
 * headwind is a different race. Above the zero line the wind is costing you
 * time, below it you're being pushed along.
 */
export function WindChart({ plan }: Props): JSX.Element {
  const { samples, timezone } = plan;

  const geo = useMemo(() => {
    const start = samples[0]?.time ?? plan.startTime;
    const end = samples[samples.length - 1]?.time ?? plan.summary.finishTime;

    const speeds = samples.map((s) => s.weather.windSpeed * 3.6);
    const components = samples.map((s) => s.weather.headwindMs * 3.6);
    const domain = niceDomain([...speeds, ...components], { includeZero: true, minSpan: 10 });

    const x = linearScale([start, end], [PAD.left, W - PAD.right]);
    const y = linearScale(domain, [H - PAD.bottom, PAD.top]);

    return {
      x,
      y,
      domain,
      start,
      end,
      speed: samples.map((s): [number, number] => [x(s.time), y(s.weather.windSpeed * 3.6)]),
      component: samples.map((s): [number, number] => [x(s.time), y(s.weather.headwindMs * 3.6)]),
    };
  }, [samples, plan.startTime, plan.summary.finishTime]);

  const hoverXs = useMemo(() => samples.map((s) => geo.x(s.time)), [samples, geo]);
  const { svgRef, index, handlers } = useCrosshair(hoverXs);
  const hovered = index !== null ? samples[index] : null;

  return (
    <div className="chart-card">
      <h3>Wind</h3>
      <div className="chart-key">
        <span>
          <i style={{ background: SERIES.primary }} />
          wind speed
        </span>
        <span>
          <i style={{ background: SERIES.secondary }} />
          head / tail component
        </span>
        {hovered && (
          <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text)' }}>
            {clock(timezone, hovered.time)} · {km(hovered.dist)} km ·{' '}
            {Math.round(hovered.weather.windSpeed * 3.6)} km/h {hovered.weather.windFromCompass} ·{' '}
            {windLabel(hovered.weather.windRelation)}
          </span>
        )}
      </div>

      <div className="chart-scroll">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          role="img"
          aria-label={`Wind along the route: ${plan.summary.headwindHours.toFixed(1)} hours of headwind and ${plan.summary.tailwindHours.toFixed(1)} hours of tailwind`}
          style={{ display: 'block', touchAction: 'pan-y' }}
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
                {Math.round(value)}
              </text>
            </g>
          ))}

          {/* The zero line is the thing being read against, so it gets weight. */}
          <line
            x1={PAD.left}
            y1={geo.y(0)}
            x2={W - PAD.right}
            y2={geo.y(0)}
            stroke={INK.axis}
            strokeWidth={1.5}
          />

          {timeTicks(geo.start, geo.end).map((t) => (
            <text key={t} x={geo.x(t)} y={H - 7} fill={INK.dim} fontSize={10} textAnchor="middle">
              {clock(timezone, t)}
            </text>
          ))}

          <path d={linePath(geo.speed)} fill="none" stroke={SERIES.primary} strokeWidth={2} strokeLinejoin="round" />
          <path d={linePath(geo.component)} fill="none" stroke={SERIES.secondary} strokeWidth={2} strokeLinejoin="round" />

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
              <circle cx={geo.x(hovered.time)} cy={geo.y(hovered.weather.windSpeed * 3.6)} r={4} fill={SERIES.primary} stroke={INK.surface} strokeWidth={2} />
              <circle cx={geo.x(hovered.time)} cy={geo.y(hovered.weather.headwindMs * 3.6)} r={4} fill={SERIES.secondary} stroke={INK.surface} strokeWidth={2} />
            </g>
          )}
        </svg>
      </div>

      <p className="chart-note">
        The orange line is the wind resolved along your direction of travel. Above zero it pushes
        against you; below zero it pushes you along.
      </p>
    </div>
  );
}
