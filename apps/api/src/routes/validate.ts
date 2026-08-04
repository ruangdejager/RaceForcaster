import {
  DEFAULT_RIDER,
  parseLocalDateTime,
  type ApparentTempMode,
  type Checkpoint,
  type FacilityId,
  type PlanSettings,
  type RiderParams,
  type Route,
} from '@raceforecaster/core';
import { ALL_FACILITIES } from '@raceforecaster/core';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function clampNumber(
  value: unknown,
  { min, max, fallback, field }: { min: number; max: number; fallback?: number; field: string },
): number {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw new ValidationError(`${field} is required.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a number.`);
  if (n < min || n > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max}.`);
  }
  return n;
}

/**
 * Accept a start time as epoch milliseconds, a full ISO instant, or the bare
 * `YYYY-MM-DDTHH:mm` an `<input type="datetime-local">` produces — the last
 * interpreted in the race's own timezone, which is almost never the server's.
 */
function parseStartTime(value: unknown, route: Route): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    const local = parseLocalDateTime(value, route.timezone);
    if (local !== null) return local;

    const iso = Date.parse(value);
    if (Number.isFinite(iso)) return iso;
  }

  throw new ValidationError(
    'startTime must be epoch milliseconds, an ISO timestamp, or YYYY-MM-DDTHH:mm.',
  );
}

function parseRider(value: unknown): RiderParams {
  if (!isRecord(value)) return DEFAULT_RIDER;

  const rider: RiderParams = {
    riderMassKg: clampNumber(value['riderMassKg'], {
      min: 30,
      max: 200,
      fallback: DEFAULT_RIDER.riderMassKg,
      field: 'rider.riderMassKg',
    }),
    bikeMassKg: clampNumber(value['bikeMassKg'], {
      min: 3,
      max: 60,
      fallback: DEFAULT_RIDER.bikeMassKg,
      field: 'rider.bikeMassKg',
    }),
    cdA: clampNumber(value['cdA'], {
      min: 0.15,
      max: 1.2,
      fallback: DEFAULT_RIDER.cdA,
      field: 'rider.cdA',
    }),
    crr: clampNumber(value['crr'], {
      min: 0.001,
      max: 0.03,
      fallback: DEFAULT_RIDER.crr,
      field: 'rider.crr',
    }),
    minSpeedKmh: clampNumber(value['minSpeedKmh'], {
      min: 1,
      max: 20,
      fallback: DEFAULT_RIDER.minSpeedKmh,
      field: 'rider.minSpeedKmh',
    }),
    maxSpeedKmh: clampNumber(value['maxSpeedKmh'], {
      min: 20,
      max: 120,
      fallback: DEFAULT_RIDER.maxSpeedKmh,
      field: 'rider.maxSpeedKmh',
    }),
    drivetrainEfficiency: clampNumber(value['drivetrainEfficiency'], {
      min: 0.8,
      max: 1,
      fallback: DEFAULT_RIDER.drivetrainEfficiency,
      field: 'rider.drivetrainEfficiency',
    }),
  };

  if (rider.minSpeedKmh >= rider.maxSpeedKmh) {
    throw new ValidationError('rider.minSpeedKmh must be below rider.maxSpeedKmh.');
  }
  return rider;
}

const FACILITY_SET = new Set<string>(ALL_FACILITIES);

/**
 * Checkpoints come back from the client with the rider's edits. Names and
 * notes are free text, but distances are re-clamped to the route and every
 * other field is validated, so a hand-edited request can't produce a plan that
 * silently disagrees with the route it claims to describe.
 */
function parseCheckpoints(value: unknown, route: Route): Checkpoint[] {
  if (value === undefined || value === null) return route.checkpoints;
  if (!Array.isArray(value)) throw new ValidationError('checkpoints must be an array.');
  if (value.length > 200) throw new ValidationError('That is more checkpoints than a route can have.');

  return value.map((raw, i): Checkpoint => {
    if (!isRecord(raw)) throw new ValidationError(`checkpoints[${i}] must be an object.`);

    const dist = clampNumber(raw['dist'], {
      min: 0,
      max: route.totalDistance,
      field: `checkpoints[${i}].dist`,
    });

    const facilities = Array.isArray(raw['facilities'])
      ? (raw['facilities'].filter((f): f is FacilityId => typeof f === 'string' && FACILITY_SET.has(f)))
      : [];

    const kind = raw['kind'];
    const note = raw['note'];

    return {
      id: typeof raw['id'] === 'string' && raw['id'] ? raw['id'] : `cp-${i + 1}`,
      name: typeof raw['name'] === 'string' ? raw['name'].slice(0, 120) : `CP${i + 1}`,
      dist,
      lat: Number(raw['lat']) || 0,
      lon: Number(raw['lon']) || 0,
      ele: Number(raw['ele']) || 0,
      kind:
        kind === 'start' || kind === 'finish' || kind === 'water' || kind === 'checkpoint'
          ? kind
          : 'checkpoint',
      facilities,
      ...(typeof note === 'string' && note ? { note: note.slice(0, 500) } : {}),
      stopMinutes: clampNumber(raw['stopMinutes'], {
        min: 0,
        max: 24 * 60,
        fallback: 0,
        field: `checkpoints[${i}].stopMinutes`,
      }),
    };
  });
}

export function parsePlanSettings(body: unknown, route: Route): PlanSettings {
  if (!isRecord(body)) throw new ValidationError('Request body must be a JSON object.');

  const mode = body['apparentTempMode'];
  const apparentTempMode: ApparentTempMode = mode === 'riding' ? 'riding' : 'ambient';

  return {
    startTime: parseStartTime(body['startTime'], route),
    targetSpeedKmh: clampNumber(body['targetSpeedKmh'], {
      min: 3,
      max: 80,
      field: 'targetSpeedKmh',
    }),
    rider: parseRider(body['rider']),
    checkpoints: parseCheckpoints(body['checkpoints'], route),
    apparentTempMode,
  };
}
