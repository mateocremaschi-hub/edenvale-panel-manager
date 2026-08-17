/** VACANT-<locationId> is an internal marker (see historicalReplacements.ts / db writes for
 * vacant slots) -- never show it raw to a user, it isn't a real serial number. */
export function displaySerial(serialNumber: string): string {
  return serialNumber.startsWith('VACANT-') ? 'No panel installed' : serialNumber;
}

/** Real serials in this farm's data are long digit-only strings (e.g. "821051140249164146").
 * Anything else -- "To be installed", blank, "TBD", etc -- means no panel is actually
 * installed there, NOT a literal serial number. Used by every place that writes serialNumber
 * from an Excel (the normal import wizard, the master-restore tool, and the historical-
 * replacements tool) so none of them ever write ambiguous placeholder text into serialNumber --
 * it isn't unique (many empty slots could carry the exact same placeholder), which breaks the
 * assumption that a serial identifies one panel and risks false collisions in search/lookup. */
export function looksLikeRealSerial(value: string): boolean {
  return /^\d{10,20}$/.test(value.trim());
}
