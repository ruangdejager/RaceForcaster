import { describe, expect, it } from 'vitest';
import { inferFacilities } from '../src/gpx/facilities.js';
import { parseRouteFile, RouteParseError } from '../src/gpx/parse.js';
import { buildRoute } from '../src/route/build.js';
import { chooseSampleLocations, roundCoord } from '../src/weather/sampling.js';
import { eastwardTrack, makeGpx, mPerDegLon } from './helpers.js';

const START_LAT = -33.9;
const START_LON = 18.4;
const distToLon = (m: number): number => START_LON + m / mPerDegLon(START_LAT);

describe('parseRouteFile', () => {
  it('reads a track with elevation', () => {
    const gpx = makeGpx(eastwardTrack({ lengthM: 1000, stepM: 100 }));
    const parsed = parseRouteFile(gpx);
    expect(parsed.points.length).toBe(11);
    expect(parsed.hasElevation).toBe(true);
    expect(parsed.name).toBe('Test Route');
  });

  it('reads a <rte> when there is no <trk>', () => {
    const gpx = `<?xml version="1.0"?><gpx version="1.1">
      <rte><name>Planned</name>
        <rtept lat="-33.9" lon="18.4"><ele>10</ele></rtept>
        <rtept lat="-33.9" lon="18.5"><ele>20</ele></rtept>
      </rte></gpx>`;
    const parsed = parseRouteFile(gpx);
    expect(parsed.points).toHaveLength(2);
  });

  it('notices when a file carries no elevation at all', () => {
    const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>
      <trkpt lat="-33.9" lon="18.4"/><trkpt lat="-33.9" lon="18.5"/>
    </trkseg></trk></gpx>`;
    expect(parseRouteFile(gpx).hasElevation).toBe(false);
  });

  it('reads waypoints with their descriptions', () => {
    const gpx = makeGpx(eastwardTrack({ lengthM: 1000, stepM: 100 }), [
      { name: 'CP1', lat: START_LAT, lon: distToLon(500), desc: 'Water and toilets' },
    ]);
    const parsed = parseRouteFile(gpx);
    expect(parsed.waypoints).toHaveLength(1);
    expect(parsed.waypoints[0]?.name).toBe('CP1');
    expect(parsed.waypoints[0]?.description).toContain('Water');
  });

  it('reads a TCX course', () => {
    const tcx = `<?xml version="1.0"?><TrainingCenterDatabase><Courses><Course>
      <Name>TCX Route</Name>
      <Track>
        <Trackpoint><Position><LatitudeDegrees>-33.9</LatitudeDegrees><LongitudeDegrees>18.4</LongitudeDegrees></Position><AltitudeMeters>10</AltitudeMeters></Trackpoint>
        <Trackpoint><Position><LatitudeDegrees>-33.9</LatitudeDegrees><LongitudeDegrees>18.5</LongitudeDegrees></Position><AltitudeMeters>20</AltitudeMeters></Trackpoint>
      </Track>
    </Course></Courses></TrainingCenterDatabase>`;
    const parsed = parseRouteFile(tcx);
    expect(parsed.name).toBe('TCX Route');
    expect(parsed.points).toHaveLength(2);
    expect(parsed.hasElevation).toBe(true);
  });

  it('explains itself when the file is unusable', () => {
    expect(() => parseRouteFile('')).toThrow(RouteParseError);
    expect(() => parseRouteFile('<html><body>nope</body></html>')).toThrow(RouteParseError);
    expect(() => parseRouteFile('<?xml version="1.0"?><gpx><trk><trkseg/></trk></gpx>')).toThrow(
      /No usable track/,
    );
  });
});

describe('inferFacilities', () => {
  it('picks tags out of the kind of description organisers actually write', () => {
    const tags = inferFacilities(
      'Check-in/out · provisions, drop boxes, mechanic, bike wash, medic, toilet',
    );
    expect(tags).toEqual(
      expect.arrayContaining(['provisions', 'drop_bags', 'mechanic', 'bike_wash', 'medic', 'toilet']),
    );
  });

  it('spots a supporters note', () => {
    expect(inferFacilities('supporters allowed here')).toContain('supporters');
  });

  it('returns nothing for text with no facilities in it', () => {
    expect(inferFacilities('the big climb starts after this')).toHaveLength(0);
    expect(inferFacilities(undefined, null, '')).toHaveLength(0);
  });
});

describe('buildRoute', () => {
  const gpx = makeGpx(
    eastwardTrack({ lengthM: 60_000, stepM: 100, elevation: (d) => 100 + d / 200 }),
    [
      { name: 'CP1 Syphonia', lat: START_LAT, lon: distToLon(20_000), desc: 'Food & drink, medic, toilet' },
      { name: 'CP2 Rietfontein', lat: START_LAT, lon: distToLon(40_000), desc: 'provisions, bike wash' },
    ],
    'Trans Baviaans',
  );

  it('produces a prepared route with checkpoints in order', () => {
    const { route } = buildRoute(gpx, { id: 'r1' });
    expect(route.name).toBe('Trans Baviaans');
    expect(route.totalDistance).toBeCloseTo(60_000, -2);
    expect(route.checkpoints).toHaveLength(2);
    expect(route.checkpoints[0]?.dist ?? 0).toBeLessThan(route.checkpoints[1]?.dist ?? 0);
    expect(route.checkpoints[0]?.dist ?? 0).toBeCloseTo(20_000, -2);
  });

  it('resolves the timezone from the start of the route', () => {
    expect(buildRoute(gpx, { id: 'r1' }).route.timezone).toBe('Africa/Johannesburg');
  });

  it('tags facilities from the waypoint descriptions', () => {
    const { route } = buildRoute(gpx, { id: 'r1' });
    expect(route.checkpoints[0]?.facilities).toContain('medic');
    expect(route.checkpoints[1]?.facilities).toContain('bike_wash');
  });

  it('defaults every stop to zero so the plan only reflects real decisions', () => {
    const { route } = buildRoute(gpx, { id: 'r1' });
    for (const cp of route.checkpoints) expect(cp.stopMinutes).toBe(0);
  });

  it('lets an explicit name override the one in the file', () => {
    expect(buildRoute(gpx, { id: 'r1', name: 'My Race' }).route.name).toBe('My Race');
  });

  it('skips a waypoint that is nowhere near the route, and says so', () => {
    const offRoute = makeGpx(eastwardTrack({ lengthM: 10_000, stepM: 100 }), [
      { name: 'Home', lat: -34.5, lon: 19.5 },
    ]);
    const { route, warnings } = buildRoute(offRoute, { id: 'r2' });
    expect(route.checkpoints).toHaveLength(0);
    expect(warnings.join(' ')).toContain('Home');
  });

  it('warns when the file has no elevation', () => {
    const flat = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>
      <trkpt lat="-33.9" lon="18.4"/><trkpt lat="-33.9" lon="18.5"/>
      <trkpt lat="-33.9" lon="18.6"/></trkseg></trk></gpx>`;
    const { warnings } = buildRoute(flat, { id: 'r3' });
    expect(warnings.join(' ')).toMatch(/no elevation/i);
  });
});

describe('chooseSampleLocations', () => {
  const { route } = buildRoute(
    makeGpx(eastwardTrack({ lengthM: 230_000, stepM: 200 }), [
      { name: 'CP1', lat: START_LAT, lon: distToLon(54_000) },
      { name: 'CP2', lat: START_LAT, lon: distToLon(100_000) },
      { name: 'CP3', lat: START_LAT, lon: distToLon(133_000) },
    ]),
    { id: 'r1' },
  );

  const locations = chooseSampleLocations(route);

  it('covers the route without leaving a big gap', () => {
    expect(locations.length).toBeGreaterThan(10);
    for (let i = 1; i < locations.length; i++) {
      const gap = (locations[i]?.dist ?? 0) - (locations[i - 1]?.dist ?? 0);
      expect(gap).toBeLessThanOrEqual(16_000);
    }
  });

  it('starts at zero and ends at the finish', () => {
    expect(locations[0]?.dist).toBe(0);
    expect(locations[locations.length - 1]?.dist ?? 0).toBeCloseTo(route.totalDistance, -2);
  });

  it('samples at every checkpoint', () => {
    for (const cp of route.checkpoints) {
      expect(locations.some((l) => Math.abs(l.dist - cp.dist) < 1)).toBe(true);
    }
  });

  it('stays inside the request budget even on a very long route', () => {
    const { route: long } = buildRoute(
      makeGpx(eastwardTrack({ lengthM: 1_200_000, stepM: 1000 })),
      { id: 'long' },
    );
    expect(chooseSampleLocations(long).length).toBeLessThanOrEqual(40);
  });
});

describe('roundCoord', () => {
  it('truncates to the four decimals met.no asks for', () => {
    expect(roundCoord(-33.92491234)).toBe(-33.9249);
    expect(roundCoord(18.42409876)).toBe(18.4241);
  });
});
