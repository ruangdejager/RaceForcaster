import type { FacilityId } from '../types.js';

/**
 * Guess what's available at a checkpoint from whatever text the route file
 * carries.
 *
 * Organisers write checkpoint descriptions for humans, so this is heuristic by
 * nature and only ever a starting point — every tag it produces is editable in
 * the UI. Getting eight of ten right beats making the rider type all ten.
 */
const PATTERNS: ReadonlyArray<readonly [FacilityId, RegExp]> = [
  ['provisions', /\b(provisions?|supplies|aid ?station|feed(ing)? ?zone|refresh\w*)\b/i],
  ['water', /\b(water ?point|water|hydration|refill|tap)\b/i],
  ['food', /\b(food|meal|hot food|snack|buffet|braai|catering)\b/i],
  ['drop_bags', /\b(drop ?(box|bag)e?s?|special ?needs?|kit ?bag)\b/i],
  ['mechanic', /\b(mechanic|bike ?(tech|support|repair)|neutral ?support|workshop)\b/i],
  ['bike_wash', /\b(bike ?wash|wash ?(point|station)|jet ?wash|hose)\b/i],
  ['medic', /\b(medic\w*|first ?aid|paramedic|doctor|physio)\b/i],
  ['toilet', /\b(toilets?|restrooms?|wc|portaloos?|ablutions?)\b/i],
  ['supporters', /\b(supporters?|seconds?|crew|spectators?|family)\b/i],
  ['shower', /\b(showers?)\b/i],
  ['sleep', /\b(sleep|bunks?|beds?|dorm\w*|nap)\b/i],
];

/** Facility tags implied by a free-text description. */
export function inferFacilities(...texts: Array<string | undefined | null>): FacilityId[] {
  const haystack = texts.filter(Boolean).join(' ');
  if (!haystack.trim()) return [];

  const found: FacilityId[] = [];
  for (const [id, pattern] of PATTERNS) {
    if (pattern.test(haystack)) found.push(id);
  }
  return found;
}

export const FACILITY_LABELS: Record<FacilityId, string> = {
  provisions: 'provisions',
  water: 'water',
  food: 'food',
  drop_bags: 'drop boxes',
  mechanic: 'mechanic',
  bike_wash: 'bike wash',
  medic: 'medic',
  toilet: 'toilet',
  supporters: 'supporters allowed',
  shower: 'shower',
  sleep: 'sleep',
};

export const ALL_FACILITIES: FacilityId[] = Object.keys(FACILITY_LABELS) as FacilityId[];
