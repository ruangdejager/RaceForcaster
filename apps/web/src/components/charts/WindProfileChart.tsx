import type { RacePlan, Route } from '@raceforecaster/core';
import { useMemo } from 'react';
import { clock, km } from '../../format.js';
import {
  areaPath,
  barPath,
  INK,
  linearScale,
  linePath,
  scrollToCheckpoint,
  SERIES,
  WIND_PUSH,
  WIND_RESIST,
  windPushColor,
} from './plot.js';
import { useCrosshair } from './useCrosshair.js';

interface Props {
  route: Route;
  plan: RacePlan;
}

const W = 900;
const PROFILE_H = 200;
const STRIP_H = 70;
const GAP = 6;
const AXIS_H = 22;
const H = PROFILE_H + GAP + STRIP_H + AXIS_H;
const PAD = { top: 10, right: 10, left: 34 };

/** How close the pointer has to be to a checkpoint's marker, in viewBox
 *  pixels, before the crosshair locks onto it instead of the wind reading. */
const SNAP_PX = 14;
const CP_BAR_W = 7;
const CP_BAR_H = 16;

const PROFILE_TOP = PAD.top;
const PROFILE_BOTTOM = PROFILE_TOP + PROFILE_H;
const STRIP_TOP = PROFILE_BOTTOM + GAP;
const STRIP_BOTTOM = STRIP_TOP + STRIP_H;

/**
 * The elevation profile painted with the wind you'll feel at the hour you
 * pass each point, plus a synced strip below showing exactly how many km/h
 * of that is working for or against you.
 *
 * The profile alone (`ElevationProfile`) answers "what does the road look
 * like"; the plain wind chart (`WindChart`) answers "how strong is the wind,
 * over time". Neither answers the question this chart is for: *where* does
 * the wind turn against you. A headwind that starts exactly at the base of
 * the day's biggest climb is a materially different race than one that hits
 * on the flat run-in, and that's invisible until the two are drawn as one.
 */
export function WindProfileChart({ route, plan }: Props): JSX.Element {
  const geo = useMemo(() => {
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
    const y = linearScale([minEle, maxEle], [PROFILE_BOTTOM, PROFILE_TOP]);

    const stride = Math.max(1, Math.floor(points.length / (W * 2)));
    const profile: Array<[number, number]> = [];
    for (let i = 0; i < points.length; i += stride) {
      const p = points[i];
      if (p) profile.push([x(p.dist), y(p.ele)]);
    }
    const last = points[points.length - 1];
    if (last) profile.push([x(last.dist), y(last.ele)]);

    // The strongest push either way sets the colour and strip scale, so a
    // gusty afternoon doesn't wash out a calm morning into looking identical.
    const maxAbsHeadwind = Math.max(
      0.5,
      ...plan.samples.map((s) => Math.abs(s.weather.headwindMs)),
    );
    const stripY = linearScale(
      [-maxAbsHeadwind, maxAbsHeadwind],
      [STRIP_BOTTOM, STRIP_TOP],
    );

    return { x, y, profile, minEle, maxEle, maxAbsHeadwind, stripY };
  }, [route, plan.samples]);

  const { x, y, profile, maxAbsHeadwind, stripY } = geo;

  // One gradient stop per sample: painting the profile is then just "fill
  // with this gradient" rather than hundreds of individually coloured
  // segments, and the browser interpolates smoothly between stops for free.
  const gradientId = 'wind-profile-gradient';
  const gradientStops = plan.samples.map((s) => ({
    offset: (s.dist / (route.totalDistance || 1)) * 100,
    color: windPushColor(s.weather.headwindMs, maxAbsHeadwind),
  }));

  const darkBands = plan.darkSegments.map((seg) => ({
    x1: x(seg.fromDist),
    x2: x(seg.toDist),
    key: `${seg.fromTime}`,
  }));

  const checkpointXs = plan.checkpoints.map((c) => ({
    id: c.checkpoint.id,
    x: x(c.checkpoint.dist),
    y: y(c.checkpoint.ele),
    name: c.checkpoint.name,
    dist: c.checkpoint.dist,
    isWater: c.checkpoint.kind === 'water',
  }));

  const stripArea = plan.samples.map((s): [number, number] => [x(s.dist), stripY(s.weather.headwindMs)]);

  const hoverXs = useMemo(() => plan.samples.map((s) => x(s.dist)), [plan.samples, x]);
  const { svgRef, index, x: pointerX, handlers } = useCrosshair(hoverXs);
  const hovered = index !== null ? plan.samples[index] : null;

  // See ElevationProfile for the rationale — checkpoints are hit-tested
  // against the continuous pointer position, not the sample series.
  const snapped = useMemo(() => {
    if (pointerX === null) return null;
    let best: (typeof checkpointXs)[number] | null = null;
    let bestDelta = SNAP_PX;
    for (const cp of checkpointXs) {
      const delta = Math.abs(cp.x - pointerX);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = cp;
      }
    }
    return best;
  }, [pointerX, checkpointXs]);

  return (
    <div className="chart-card">
      <h3>Wind over the route</h3>
      <div className="chart-key">
        <span>
          <i style={{ background: WIND_PUSH }} />
          tailwind
        </span>
        <span>
          <i style={{ background: WIND_RESIST }} />
          headwind
        </span>
        {hovered && (
          <span className="mono" style={{ marginLeft: 'auto', color: 'var(--text)' }}>
            {km(hovered.dist, 1)} km · {clock(plan.timezone, hovered.time)} ·{' '}
            {hovered.weather.headwindMs >= 0 ? '+' : ''}
            {(hovered.weather.headwindMs * 3.6).toFixed(1)} km/h
          </span>
        )}
      </div>

      <div className="chart-scroll">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Elevation profile painted with the wind you'll feel at each point, with a strip below showing it in km/h"
          style={{
            display: 'block',
            width: '100%',
            height: 'auto',
            touchAction: 'pan-y',
            cursor: snapped ? 'pointer' : undefined,
          }}
          onClick={() => snapped && scrollToCheckpoint(snapped.id)}
          {...handlers}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
              {gradientStops.map((s) => (
                <stop key={s.offset} offset={`${s.offset}%`} stopColor={s.color} />
              ))}
            </linearGradient>
          </defs>

          {/* --- Profile panel --- */}
          {darkBands.map((band) => (
            <rect
              key={band.key}
              x={band.x1}
              y={PROFILE_TOP}
              width={Math.max(0, band.x2 - band.x1)}
              height={PROFILE_BOTTOM - PROFILE_TOP}
              fill={INK.surface}
              opacity={0.4}
            />
          ))}

          <path d={areaPath(profile, PROFILE_BOTTOM)} fill={`url(#${gradientId})`} opacity={0.85} />
          <path
            d={linePath(profile)}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />

          {/* Same amber/blue "candle" markers as the elevation profile, and
              the same click/keyboard jump to the checkpoint's timeline card. */}
          {checkpointXs.map((cp) => {
            const color = cp.isWater ? SERIES.secondary : INK.accent;
            return (
              <g
                key={cp.id}
                tabIndex={0}
                role="button"
                aria-label={`Jump to ${cp.name} in the timeline`}
                onClick={() => scrollToCheckpoint(cp.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    scrollToCheckpoint(cp.id);
                  }
                }}
                style={{ cursor: 'pointer', outline: 'none' }}
              >
                <line
                  x1={cp.x}
                  y1={PROFILE_TOP}
                  x2={cp.x}
                  y2={STRIP_BOTTOM}
                  stroke={INK.label}
                  strokeWidth={1}
                  opacity={0.35}
                />
                <rect x={cp.x - 12} y={PROFILE_TOP} width={24} height={STRIP_BOTTOM - PROFILE_TOP} fill="transparent" />
                <path
                  d={barPath(cp.x - CP_BAR_W / 2, cp.y - CP_BAR_H, CP_BAR_W, CP_BAR_H, 3)}
                  fill={color}
                  stroke={INK.surface}
                  strokeWidth={1.2}
                />
              </g>
            );
          })}

          <text x={PAD.left} y={PROFILE_TOP + 12} fill={INK.dim} fontSize={10}>
            {Math.round(geo.maxEle)}m
          </text>

          {/* --- Wind strip: signed component in km/h --- */}
          <line
            x1={PAD.left}
            y1={stripY(0)}
            x2={W - PAD.right}
            y2={stripY(0)}
            stroke={INK.axis}
            strokeWidth={1}
          />
          <text x={PAD.left} y={STRIP_TOP + 9} fill={INK.dim} fontSize={9}>
            {(maxAbsHeadwind * 3.6).toFixed(0)}
          </text>
          <text x={PAD.left} y={STRIP_BOTTOM - 2} fill={INK.dim} fontSize={9}>
            -{(maxAbsHeadwind * 3.6).toFixed(0)}
          </text>
          <text x={PAD.left} y={stripY(0) - 4} fill={INK.dim} fontSize={9}>
            against you
          </text>
          <text x={PAD.left} y={stripY(0) + 12} fill={INK.dim} fontSize={9}>
            pushing you along
          </text>

          <path d={areaPath(stripArea, stripY(0))} fill={`url(#${gradientId})`} opacity={0.75} />
          <path d={linePath(stripArea)} fill="none" stroke={`url(#${gradientId})`} strokeWidth={2} />

          {darkBands.map((band) => (
            <rect
              key={`strip-${band.key}`}
              x={band.x1}
              y={STRIP_TOP}
              width={Math.max(0, band.x2 - band.x1)}
              height={STRIP_BOTTOM - STRIP_TOP}
              fill={INK.night}
              opacity={0.16}
              pointerEvents="none"
            />
          ))}

          {/* --- Shared distance axis --- */}
          {distanceTicks(route.totalDistance).map((d) => (
            <text
              key={d}
              x={x(d)}
              y={H - 7}
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
                x1={snapped ? snapped.x : x(hovered.dist)}
                y1={PROFILE_TOP}
                x2={snapped ? snapped.x : x(hovered.dist)}
                y2={STRIP_BOTTOM}
                stroke={INK.label}
                strokeWidth={1}
              />
              <circle
                cx={snapped ? snapped.x : x(hovered.dist)}
                cy={snapped ? snapped.y : y(hovered.ele)}
                r={4.5}
                fill={INK.surface}
                stroke={snapped ? (snapped.isWater ? SERIES.secondary : INK.accent) : INK.accent}
                strokeWidth={2}
              />
              <circle
                cx={snapped ? snapped.x : x(hovered.dist)}
                cy={stripY(hovered.weather.headwindMs)}
                r={3.5}
                fill={INK.surface}
                stroke={INK.accent}
                strokeWidth={2}
              />
              {snapped && (
                <text
                  x={snapped.x}
                  y={PROFILE_TOP - 2}
                  fill={INK.label}
                  fontSize={9.5}
                  textAnchor={snapped.x > W / 2 ? 'end' : 'start'}
                >
                  {snapped.name} · click to view
                </text>
              )}
            </g>
          )}
        </svg>
      </div>

      <p className="chart-note">
        The profile is painted with the wind at the hour you'll pass each point — gold pushes you
        along, red pushes back, deeper colour is stronger. The strip below is the same thing in
        km/h. Amber bars are checkpoints, blue are water points — click one to jump to it below;
        shaded bands are after dark.
      </p>
    </div>
  );
}

function distanceTicks(totalMetres: number): number[] {
  const totalKm = totalMetres / 1000;
  const stepKm = totalKm > 400 ? 100 : totalKm > 150 ? 50 : totalKm > 60 ? 25 : 10;
  const out: number[] = [];
  for (let d = 0; d < totalKm; d += stepKm) out.push(d * 1000);
  out.push(totalMetres);
  return out;
}
