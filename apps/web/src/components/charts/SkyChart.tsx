import type { RacePlan } from '@raceforecaster/core';
import { useMemo } from 'react';
import { clock, km } from '../../format.js';
import { areaPath, barPath, INK, linearScale, linePath, SERIES, timeTicks } from './plot.js';
import { useCrosshair } from './useCrosshair.js';

const W = 620;
const CLOUD_H = 54;
const RAIN_H = 58;
const GAP = 14;
const AXIS_H = 22;
const H = CLOUD_H + GAP + RAIN_H + AXIS_H;
const PAD = { top: 8, right: 10, left: 34 };

const CLOUD_TOP = PAD.top;
const CLOUD_BOTTOM = CLOUD_TOP + CLOUD_H;
const RAIN_TOP = CLOUD_BOTTOM + GAP;
const RAIN_BOTTOM = RAIN_TOP + RAIN_H;

interface Props {
  plan: RacePlan;
}

/**
 * Cloud cover and rainfall, stacked rather than overlaid.
 *
 * These are the two things people most often cram onto one plot with two y-axes
 * — percent on the left, millimetres on the right. That's a chart that invents
 * a relationship: where the two lines cross means nothing, because the
 * alignment of the scales was an arbitrary choice. Two panels sharing one time
 * axis says exactly the same thing and can't mislead: read down the column to
 * see whether the cloud that's building is actually going to rain on you.
 */
export function SkyChart({ plan }: Props): JSX.Element {
  const { samples, timezone } = plan;

  const geo = useMemo(() => {
    const start = samples[0]?.time ?? plan.startTime;
    const end = samples[samples.length - 1]?.time ?? plan.summary.finishTime;

    const peakRain = Math.max(0.5, ...samples.map((s) => s.weather.precipMmPerHour));

    const x = linearScale([start, end], [PAD.left, W - PAD.right]);
    const cloudY = linearScale([0, 100], [CLOUD_BOTTOM, CLOUD_TOP]);
    const rainY = linearScale([0, peakRain], [RAIN_BOTTOM, RAIN_TOP]);

    // One bar per sample, with a 2px surface gap so adjacent bars read as
    // separate marks without needing a stroke around them.
    const slot = (W - PAD.left - PAD.right) / Math.max(1, samples.length);
    const barWidth = Math.max(1.5, slot - 2);

    return {
      x,
      cloudY,
      rainY,
      start,
      end,
      peakRain,
      barWidth,
      cloud: samples.map((s): [number, number] => [x(s.time), cloudY(s.weather.cloudPct)]),
    };
  }, [samples, plan.startTime, plan.summary.finishTime]);

  const hoverXs = useMemo(() => samples.map((s) => geo.x(s.time)), [samples, geo]);
  const { svgRef, index, handlers } = useCrosshair(hoverXs);
  const hovered = index !== null ? samples[index] : null;

  const anyRain = plan.summary.totalRainMm > 0;

  return (
    <div className="chart-card">
      <h3>Cloud &amp; rain</h3>
      <div className="chart-key">
        <span>
          <i style={{ background: INK.label }} />
          cloud cover %
        </span>
        <span>
          <i style={{ background: SERIES.primary }} />
          rain mm/h
        </span>
        {hovered && (
          <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text)' }}>
            {clock(timezone, hovered.time)} · {km(hovered.dist)} km ·{' '}
            {Math.round(hovered.weather.cloudPct)}% cloud ·{' '}
            {hovered.weather.precipMmPerHour.toFixed(2)} mm/h
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
          aria-label={`Cloud cover and rainfall along the route. ${anyRain ? `About ${plan.summary.totalRainMm.toFixed(1)} millimetres of rain expected.` : 'No rain expected.'}`}
          style={{ display: 'block', touchAction: 'pan-y' }}
          {...handlers}
        >
          {/* --- Cloud panel --- */}
          {[0, 50, 100].map((pct) => (
            <g key={pct}>
              <line
                x1={PAD.left}
                y1={geo.cloudY(pct)}
                x2={W - PAD.right}
                y2={geo.cloudY(pct)}
                stroke={INK.grid}
                strokeWidth={1}
              />
              <text x={PAD.left - 6} y={geo.cloudY(pct) + 3.5} fill={INK.dim} fontSize={9} textAnchor="end">
                {pct}
              </text>
            </g>
          ))}
          <path d={areaPath(geo.cloud, CLOUD_BOTTOM)} fill={INK.label} opacity={0.2} />
          <path d={linePath(geo.cloud)} fill="none" stroke={INK.label} strokeWidth={2} strokeLinejoin="round" />
          <text x={W - PAD.right} y={CLOUD_TOP + 9} fill={INK.dim} fontSize={9.5} textAnchor="end">
            cloud %
          </text>

          {/* --- Rain panel --- */}
          <line x1={PAD.left} y1={RAIN_BOTTOM} x2={W - PAD.right} y2={RAIN_BOTTOM} stroke={INK.axis} strokeWidth={1} />
          <text x={PAD.left - 6} y={RAIN_TOP + 8} fill={INK.dim} fontSize={9} textAnchor="end">
            {geo.peakRain.toFixed(geo.peakRain < 1 ? 1 : 0)}
          </text>
          <text x={PAD.left - 6} y={RAIN_BOTTOM + 3.5} fill={INK.dim} fontSize={9} textAnchor="end">
            0
          </text>

          {samples.map((s) => {
            const height = RAIN_BOTTOM - geo.rainY(s.weather.precipMmPerHour);
            if (height <= 0.2) return null;
            return (
              <path
                key={s.time}
                d={barPath(geo.x(s.time) - geo.barWidth / 2, geo.rainY(s.weather.precipMmPerHour), geo.barWidth, height, 3)}
                fill={SERIES.primary}
              />
            );
          })}

          {!anyRain && (
            <text x={(PAD.left + W - PAD.right) / 2} y={RAIN_TOP + RAIN_H / 2 + 4} fill={INK.dim} fontSize={11} textAnchor="middle">
              no rain forecast
            </text>
          )}
          <text x={W - PAD.right} y={RAIN_TOP + 9} fill={INK.dim} fontSize={9.5} textAnchor="end">
            rain mm/h
          </text>

          {/* --- Shared time axis --- */}
          {timeTicks(geo.start, geo.end).map((t) => (
            <text key={t} x={geo.x(t)} y={H - 7} fill={INK.dim} fontSize={10} textAnchor="middle">
              {clock(timezone, t)}
            </text>
          ))}

          {hovered && (
            <line
              pointerEvents="none"
              x1={geo.x(hovered.time)}
              y1={CLOUD_TOP}
              x2={geo.x(hovered.time)}
              y2={RAIN_BOTTOM}
              stroke={INK.label}
              strokeWidth={1}
            />
          )}
        </svg>
      </div>
    </div>
  );
}
