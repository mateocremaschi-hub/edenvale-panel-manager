/** VACANT-<locationId> is an internal marker (see historicalReplacements.ts / db writes for
 * vacant slots) -- never show it raw to a user, it isn't a real serial number. */
export function displaySerial(serialNumber: string): string {
  return serialNumber.startsWith('VACANT-') ? 'No panel installed' : serialNumber;
}
