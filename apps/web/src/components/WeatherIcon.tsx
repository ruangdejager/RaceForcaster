import { describeSymbol } from '@raceforecaster/core';

/**
 * Weather glyphs drawn inline rather than pulled from a font or sprite sheet.
 *
 * They stay crisp at any size, inherit no network dependency, and — the reason
 * that actually matters here — the sun and moon can be told apart at a glance
 * in a list where half the rows are ridden after dark.
 */

interface Props {
  symbolCode: string | null;
  size?: number;
  /** Overrides the day/night variant baked into the symbol code. */
  isDark?: boolean;
}

const SUN = '#f7c948';
const MOON = '#c9d4e2';
const CLOUD = '#9fb0c2';
const CLOUD_DARK = '#7a8b9d';
const RAIN = '#4b9fea';
const SNOW = '#d7e8f5';
const BOLT = '#f5a623';

export function WeatherIcon({ symbolCode, size = 22, isDark }: Props): JSX.Element {
  const info = describeSymbol(symbolCode);
  const night = isDark ?? info.variant === 'night';

  const body: JSX.Element[] = [];

  const cloud = (key: string, x = 0, y = 0, scale = 1, fill = CLOUD): JSX.Element => (
    <path
      key={key}
      transform={`translate(${x} ${y}) scale(${scale})`}
      d="M7.5 17.5a4 4 0 0 1 .3-8 5.6 5.6 0 0 1 10.6 1.3 3.4 3.4 0 0 1-.6 6.7z"
      fill={fill}
    />
  );

  const orb = (key: string, cx: number, cy: number, r: number): JSX.Element =>
    night ? (
      // Crescent via an offset mask, so it reads as a moon at 22px.
      <path
        key={key}
        d={`M${cx + r * 0.55} ${cy - r} a ${r} ${r} 0 1 0 ${r * 0.45} ${r * 1.75} a ${r * 0.82} ${r * 0.82} 0 1 1 ${-r * 0.45} ${-r * 1.75} z`}
        fill={MOON}
      />
    ) : (
      <g key={key}>
        <circle cx={cx} cy={cy} r={r} fill={SUN} />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <line
            key={deg}
            x1={cx + Math.cos((deg * Math.PI) / 180) * (r + 1.6)}
            y1={cy + Math.sin((deg * Math.PI) / 180) * (r + 1.6)}
            x2={cx + Math.cos((deg * Math.PI) / 180) * (r + 3.4)}
            y2={cy + Math.sin((deg * Math.PI) / 180) * (r + 3.4)}
            stroke={SUN}
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        ))}
      </g>
    );

  const drops = (key: string, color: string): JSX.Element => (
    <g key={key} stroke={color} strokeWidth="1.9" strokeLinecap="round">
      <line x1="8" y1="19" x2="6.6" y2="22" />
      <line x1="12" y1="19" x2="10.6" y2="22" />
      <line x1="16" y1="19" x2="14.6" y2="22" />
    </g>
  );

  const flakes = (key: string): JSX.Element => (
    <g key={key} fill={SNOW}>
      <circle cx="8" cy="20.5" r="1.3" />
      <circle cx="12.4" cy="21" r="1.3" />
      <circle cx="16.6" cy="20.5" r="1.3" />
    </g>
  );

  switch (info.category) {
    case 'clear':
      body.push(orb('orb', 12, 12, 5.2));
      break;

    case 'partly':
      body.push(orb('orb', 15.5, 8.5, 4));
      body.push(cloud('cloud', 0, 2, 0.92));
      break;

    case 'cloudy':
      body.push(cloud('back', 3, -2.5, 0.72, CLOUD_DARK));
      body.push(cloud('cloud', 0, 2, 0.94));
      break;

    case 'fog':
      body.push(cloud('cloud', 0, -1, 0.9, CLOUD_DARK));
      body.push(
        <g key="bars" stroke={CLOUD} strokeWidth="1.9" strokeLinecap="round">
          <line x1="4" y1="18.5" x2="20" y2="18.5" />
          <line x1="6" y1="22" x2="18" y2="22" />
        </g>,
      );
      break;

    case 'rain':
    case 'showers':
      if (info.category === 'showers') body.push(orb('orb', 16.5, 7.5, 3.6));
      body.push(cloud('cloud', 0, 0, 0.9, CLOUD_DARK));
      body.push(drops('drops', RAIN));
      break;

    case 'sleet':
      body.push(cloud('cloud', 0, 0, 0.9, CLOUD_DARK));
      body.push(drops('drops', RAIN));
      body.push(<circle key="flake" cx="12.4" cy="21.4" r="1.3" fill={SNOW} />);
      break;

    case 'snow':
      body.push(cloud('cloud', 0, 0, 0.9, CLOUD_DARK));
      body.push(flakes('flakes'));
      break;

    case 'thunder':
      body.push(cloud('cloud', 0, 0, 0.9, CLOUD_DARK));
      body.push(
        <path key="bolt" d="M13 17.5l-4 5h3l-1 4 4.5-5.5H12.5z" fill={BOLT} />,
      );
      break;
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 26"
      role="img"
      aria-label={info.label}
      style={{ flex: 'none' }}
    >
      {body}
    </svg>
  );
}

export function weatherLabel(symbolCode: string | null): string {
  return describeSymbol(symbolCode).label;
}
