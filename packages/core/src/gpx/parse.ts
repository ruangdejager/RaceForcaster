import { XMLParser } from 'fast-xml-parser';
import type { CheckpointKind } from '../types.js';
import type { RawPoint } from '../geo/resample.js';

export interface ParsedWaypoint {
  name: string;
  lat: number;
  lon: number;
  ele: number | null;
  /** Description text from `desc`, `cmt` or `type`, used to infer facilities. */
  description: string;
  kind: CheckpointKind;
}

export interface ParsedRouteFile {
  name: string;
  points: RawPoint[];
  waypoints: ParsedWaypoint[];
  /** False when the file carried no elevation data at all. */
  hasElevation: boolean;
}

export class RouteParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteParseError';
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Leave every value a string: coordinates are converted explicitly below,
  // and automatic coercion mangles names like "CP1" or elevations like "07".
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

/** fast-xml-parser collapses single children to objects; callers want lists. */
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function num(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    // <name><![CDATA[..]]></name> and mixed content land here.
    const t = (value as Record<string, unknown>)['#text'];
    return t === undefined ? '' : String(t).trim();
  }
  return String(value).trim();
}

/** Waypoint symbol/type hints that mean "this is a water stop, not a full CP". */
function classifyWaypoint(name: string, description: string): CheckpointKind {
  const s = `${name} ${description}`;
  if (/\b(start|depart)\b/i.test(s)) return 'start';
  if (/\b(finish|end)\b/i.test(s)) return 'finish';
  if (/\bwater\b/i.test(s) && !/\bcheck ?point|\bcp\d/i.test(s)) return 'water';
  return 'checkpoint';
}

type XmlNode = Record<string, unknown>;

function readPoint(node: XmlNode): RawPoint | null {
  const lat = num(node['@_lat']);
  const lon = num(node['@_lon']);
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, ele: num(node['ele']) ?? 0 };
}

function parseGpx(root: XmlNode): ParsedRouteFile {
  const gpx = root['gpx'] as XmlNode | undefined;
  if (!gpx) throw new RouteParseError('Not a GPX file: no <gpx> element.');

  const points: RawPoint[] = [];
  let sawElevation = false;

  const collect = (nodes: XmlNode[]): void => {
    for (const n of nodes) {
      const p = readPoint(n);
      if (!p) continue;
      if (num(n['ele']) !== null) sawElevation = true;
      points.push(p);
    }
  };

  // Tracks first: they're the normal case and carry elevation.
  for (const trk of asArray(gpx['trk'] as XmlNode | XmlNode[])) {
    for (const seg of asArray(trk['trkseg'] as XmlNode | XmlNode[])) {
      collect(asArray(seg['trkpt'] as XmlNode | XmlNode[]));
    }
  }

  // Planned routes (<rte>) are the other common export shape.
  if (points.length === 0) {
    for (const rte of asArray(gpx['rte'] as XmlNode | XmlNode[])) {
      collect(asArray(rte['rtept'] as XmlNode | XmlNode[]));
    }
  }

  if (points.length < 2) {
    throw new RouteParseError(
      'No usable track found. The file needs a <trk> with track points or a <rte> with route points.',
    );
  }

  const waypoints: ParsedWaypoint[] = [];
  for (const wpt of asArray(gpx['wpt'] as XmlNode | XmlNode[])) {
    const lat = num(wpt['@_lat']);
    const lon = num(wpt['@_lon']);
    if (lat === null || lon === null) continue;

    const name = text(wpt['name']) || 'Waypoint';
    const description = [text(wpt['desc']), text(wpt['cmt']), text(wpt['type'])]
      .filter(Boolean)
      .join(' · ');

    waypoints.push({
      name,
      lat,
      lon,
      ele: num(wpt['ele']),
      description,
      kind: classifyWaypoint(name, `${description} ${text(wpt['sym'])}`),
    });
  }

  const firstTrack = asArray(gpx['trk'] as XmlNode | XmlNode[])[0];
  const metadata = gpx['metadata'] as XmlNode | undefined;
  const name =
    text(firstTrack?.['name']) || text(metadata?.['name']) || text(gpx['name']) || 'Route';

  return { name, points, waypoints, hasElevation: sawElevation };
}

function parseTcx(root: XmlNode): ParsedRouteFile {
  const db = root['TrainingCenterDatabase'] as XmlNode | undefined;
  if (!db) throw new RouteParseError('Not a TCX file: no <TrainingCenterDatabase> element.');

  const points: RawPoint[] = [];
  let sawElevation = false;

  const readTrackpoints = (nodes: XmlNode[]): void => {
    for (const tp of nodes) {
      const pos = tp['Position'] as XmlNode | undefined;
      if (!pos) continue;
      const lat = num(pos['LatitudeDegrees']);
      const lon = num(pos['LongitudeDegrees']);
      if (lat === null || lon === null) continue;
      const ele = num(tp['AltitudeMeters']);
      if (ele !== null) sawElevation = true;
      points.push({ lat, lon, ele: ele ?? 0 });
    }
  };

  // Courses (a planned route) and Activities (a recorded ride) both work.
  const courses = db['Courses'] as XmlNode | undefined;
  for (const course of asArray(courses?.['Course'] as XmlNode | XmlNode[])) {
    for (const track of asArray(course['Track'] as XmlNode | XmlNode[])) {
      readTrackpoints(asArray(track['Trackpoint'] as XmlNode | XmlNode[]));
    }
  }

  if (points.length === 0) {
    const activities = db['Activities'] as XmlNode | undefined;
    for (const activity of asArray(activities?.['Activity'] as XmlNode | XmlNode[])) {
      for (const lap of asArray(activity['Lap'] as XmlNode | XmlNode[])) {
        for (const track of asArray(lap['Track'] as XmlNode | XmlNode[])) {
          readTrackpoints(asArray(track['Trackpoint'] as XmlNode | XmlNode[]));
        }
      }
    }
  }

  if (points.length < 2) throw new RouteParseError('No usable track found in the TCX file.');

  const firstCourse = asArray(courses?.['Course'] as XmlNode | XmlNode[])[0];
  const name = text(firstCourse?.['Name']) || 'Route';

  // TCX CoursePoints are the closest thing it has to GPX waypoints.
  const waypoints: ParsedWaypoint[] = [];
  for (const course of asArray(courses?.['Course'] as XmlNode | XmlNode[])) {
    for (const cp of asArray(course['CoursePoint'] as XmlNode | XmlNode[])) {
      const pos = cp['Position'] as XmlNode | undefined;
      const lat = num(pos?.['LatitudeDegrees']);
      const lon = num(pos?.['LongitudeDegrees']);
      if (lat === null || lon === null) continue;
      const cpName = text(cp['Name']) || 'Waypoint';
      const description = text(cp['Notes']);
      waypoints.push({
        name: cpName,
        lat,
        lon,
        ele: null,
        description,
        kind: classifyWaypoint(cpName, `${description} ${text(cp['PointType'])}`),
      });
    }
  }

  return { name, points, waypoints, hasElevation: sawElevation };
}

/** Parse a GPX or TCX document. The format is detected from its root element. */
export function parseRouteFile(xml: string): ParsedRouteFile {
  if (!xml.trim()) throw new RouteParseError('The file is empty.');

  let root: XmlNode;
  try {
    root = parser.parse(xml) as XmlNode;
  } catch (err) {
    throw new RouteParseError(
      `Could not read the file as XML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (root['gpx']) return parseGpx(root);
  if (root['TrainingCenterDatabase']) return parseTcx(root);
  throw new RouteParseError('Unrecognised file. Upload a GPX or TCX route.');
}
