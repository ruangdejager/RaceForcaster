declare module 'tz-lookup' {
  /**
   * Resolve an IANA time zone name from a coordinate, offline.
   * Throws on out-of-range input.
   */
  export default function tzlookup(lat: number, lon: number): string;
}
