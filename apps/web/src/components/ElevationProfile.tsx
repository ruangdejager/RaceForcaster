import type { RacePlan, Route } from '@raceforecaster/core';
import { useMemo } from 'react';
import { clock, km } from '../format.js';
import { areaPath, INK, linearScale, linePath } from './charts/plot.js';
import { useCrosshair } from './charts/useCrosshair.js';

interface Props {
  route: Route;
  plan: RacePlan;
}

const W = 700;
const H = 132;
const PAD = { top: 8, right: 8, bottom: 26, left: 8 };

/**
 * The route's shape, with the plan laid over it.
 *
 * Two things are happening at once here. The filled profile is the course and
 * never changes. The hour marks along it *do* — they slide as the speed
 * control moves, which turns an abstract "21 km/h" into "so I hit the big climb
 * at three in the afternoon". That coupling is the reason this sits directly
 * under the speed control rather than in with the other charts.
 */
export function ElevationProfile({ route, plan }: Props): JSX.Element {
  const geometry = useMemo(() => {
    const points = route.points;
    const total = route.totalDistance || 1;

    let minEle = Number.POSITIVE_INFINITY;
    let maxEle = Number.NEGATIVE_INFINITY;
    for (const p of points) {
      if (p.ele < minEle) minEle = p.ele;
      if (p.ele > maxEle) maxEle = p.ele;
    }
    if (!Number.isFinite(minEle)) {
      minEle = 0;
      maxEle = 1;
    }
    if (maxEle - minEle < 20) maxEle = minEle + 20;

    const x = linearScale([0, total], [PAD.left, W - PAD.right]);
    const y = linearScale([minEle, maxEle], [H - PAD.bottom, PAD.top]);

    // One sample every couple of pixels: enough to draw a faithful profile,
    // few enough that the path string stays small on a 2300-point route.
    const stride = Math.max(1, Math.floor(points.length / (W * 2)));
    const series: Array<[number, number]> = [];
    for (let i = 0; i < points.length; i += stride) {
      const p = points[i];
      if (p) series.push([x(p.dist), y(p.ele)]);
    }
    const last = points[points.length - 1];
    if (last) series.push([x(last.dist), y(last.ele)]);

    return { x, y, series, minEle, maxEle, baseline: H - PAD.bottom };
  }, [route]);

  const { x, y, series, baseline } = geometry;

  // Dark stretches, drawn behind the profile as bands of night.
  const darkBands = plan.darkSegments.map((seg) => ({
    x1: x(seg.fromDist),
    x2: x(seg.toDist),
    key: `${seg.fromTime}`,
  }));

  const hourMarks = plan.hours.map((h) => ({
    x: x(h.dist),
    label: clock(plan.timezone, h.time),
    time: h.time,
  }));

  const checkpoints = plan.checkpoints.map((c) => ({
    x: x(c.checkpoint.dist),
    y: y(c.checkpoint.ele),
    name: c.checkpoint.name,
    dist: c.checkpoint.dist,
  }));

  const hoverXs = useMemo(() => plan.samples.map((s) => x(s.dist)), [plan.samples, x]);
  const { svgRef, index, handlers } = useCrosshair(hoverXs);
  const hovered = index !== null ? plan.samples[index] : null;

  return (
    <figure style={{ margin: 0 }}>
      <div className="chart-scroll">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          role="img"
          aria-label={`Elevation profile: ${km(route.totalDistance)} kilometres, ${Math.round(route.totalAscent)} metres of climbing`}
          style={{ display: 'block', touchAction: 'pan-y' }}
          {...handlers}
        >
          {darkBands.map((band) => (
            <rect
              key={band.key}
              x={band.x1}
              y={PAD.top}
              width={Math.max(0, band.x2 - band.x1)}
              height={baseline - PAD.top}
              fill={INK.night}
              opacity={0.17}
            />
          ))}

          <path d={areaPath(series, baseline)} fill={INK.accent} opacity={0.13} />
          <path
            d={linePath(series)}
            fill="none"
            stroke={INK.accent}
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {/* Hour marks: short ticks rising from the baseline. */}
          {hourMarks.map((mark) => (
            <line
              key={mark.time}
              x1={mark.x}
              y1={baseline}
              x2={mark.x}
              y2={baseline - 13}
              stroke={INK.accent}
              strokeWidth={1.5}
              opacity={0.55}
            />
          ))}

          {/* Checkpoints: a dot on the profile plus a full-height hairline. */}
          {checkpoints.map((cp) => (
            <g key={cp.name}>
              <line
                x1={cp.x}
                y1={PAD.top}
                x2={cp.x}
                y2={baseline}
                stroke={INK.label}
                strokeWidth={1}
                opacity={0.3}
              />
              <circle cx={cp.x} cy={cp.y} r={4} fill={INK.surface} />
              <circle cx={cp.x} cy={cp.y} r={2.6} fill={INK.accent} />
            </g>
          ))}

          <line
            x1={PAD.left}
            y1={baseline}
            x2={W - PAD.right}
            y2={baseline}
            stroke={INK.axis}
            strokeWidth={1}
          />

          {/* Distance ruler. */}
          {distanceTicks(route.totalDistance).map((d) => (
            <text
              key={d}
              x={x(d)}
              y={H - 8}
              fill={INK.dim}
              fontSize={10}
              textAnchor={d === 0 ? 'start' : d >= route.totalDistance - 1 ? 'end' : 'middle'}
            >
              {km(d)}
            </text>
          ))}

          {hovered && (
            <g pointerEvents="none">
              <line
                x1={x(hovered.dist)}
                y1={PAD.top}
                x2={x(hovered.dist)}
                y2={baseline}
                stroke={INK.accent}
                strokeWidth={1}
              />
              <circle cx={x(hovered.dist)} cy={y(hovered.ele)} r={4} fill={INK.accent} />
            </g>
          )}
        </svg>
      </div>

      <figcaption className="profile-legend">
        <span>
          <i className="swatch" style={{ background: INK.accent }} /> Elevation
        </span>
        <span>
          <i className="swatch" style={{ background: INK.accent, opacity: 0.6 }} /> checkpoints
        </span>
        <span>hour marks move with your speed</span>
        {plan.darkSegments.length > 0 && (
          <span>
            <i className="swatch" style={{ background: INK.night, opacity: 0.5 }} /> dark
          </span>
        )}
        {hovered && (
          <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text)' }}>
            {km(hovered.dist, 1)} km · {Math.round(hovered.ele)} m ·{' '}
            {clock(plan.timezone, hovered.time)}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** Distance labels every 25, 50 or 100 km depending on how long the route is. */
function distanceTicks(totalMetres: number): number[] {
  const totalKm = totalMetres / 1000;
  const stepKm = totalKm > 400 ? 100 : totalKm > 150 ? 50 : totalKm > 60 ? 25 : 10;
  const out: number[] = [];
  for (let d = 0; d < totalKm; d += stepKm) out.push(d * 1000);
  out.push(totalMetres);
  return out;
}
