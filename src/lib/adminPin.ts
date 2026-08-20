import { sha256Hex } from './hash';

/**
 * Prompts for the admin PIN and checks it, reusable across every PIN-gated action instead of
 * duplicating the prompt/hash/migration logic at each call site. Returns true if the action
 * should proceed (either no PIN is configured yet -- nothing to protect -- or the entered PIN
 * matched), false if it was wrong or the prompt was cancelled (the caller should bail out
 * without doing anything). Accepts the OLD plain-text PIN format once and silently upgrades it
 * to a hash via `onMigrate`, same backward-compatible behavior as the original PIN checks this
 * replaces -- so nobody already using a pre-hash PIN gets locked out by this change either.
 */
export async function requireAdminPin(currentPinHash: string | null, onMigrate: (newHash: string) => void, promptText = 'Enter admin PIN:'): Promise<boolean> {
  if (!currentPinHash) return true; // no PIN configured yet -- nothing to protect
  const entered = prompt(promptText);
  if (entered == null) return false; // cancelled
  if ((await sha256Hex(entered)) === currentPinHash) return true;
  if (entered === currentPinHash) {
    onMigrate(await sha256Hex(entered));
    return true;
  }
  alert('Incorrect PIN.');
  return false;
}
