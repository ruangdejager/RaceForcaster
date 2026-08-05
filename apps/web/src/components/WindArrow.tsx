import type { WindRelation } from '@raceforecaster/core';

/**
 * An arrow showing where the wind is pushing you, relative to the way you are
 * pointing.
 *
 * The arrow points along the wind's direction of travel, not the direction it
 * comes from, and it is drawn in the rider's frame: straight up means it is
 * coming at your face. That's the reading a rider needs — "is this helping or
 * hurting" — rather than a compass bearing they'd have to combine with their
 * heading in their head.
 */

interface Props {
  /** Angle of the wind relative to travel, -180..180. 0 is a dead headwind. */
  windRelativeDeg: number;
  relation: WindRelation;
  size?: number;
  color?: string;
}

// Matches the head/tailwind pair used everywhere else wind is coloured
// (WindProfileChart's WIND_RESIST/WIND_PUSH): red against you, teal along.
// Cross gets the app's secondary blue rather than amber, which is reserved
// for the page's own accent and would otherwise compete with it here.
const COLORS: Record<WindRelation, string> = {
  head: '#e05a4e',
  tail: '#199e70',
  left: '#3987e5',
  right: '#3987e5',
};

export function WindArrow({ windRelativeDeg, relation, size = 13, color }: Props): JSX.Element {
  // A wind *from* dead ahead (relative 0°) blows towards the rider, so the
  // arrow points down the screen: rotate by 180° from "up".
  const rotation = windRelativeDeg + 180;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-label={`Wind ${relation === 'head' ? 'against you' : relation === 'tail' ? 'behind you' : `from your ${relation}`}`}
      style={{ flex: 'none', transform: `rotate(${rotation}deg)` }}
    >
      <path
        d="M8 1.5 L12.2 9 H9.4 V14.2 H6.6 V9 H3.8 Z"
        fill={color ?? COLORS[relation]}
      />
    </svg>
  );
}
