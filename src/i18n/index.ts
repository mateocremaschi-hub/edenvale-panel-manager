import en from './en';

const dictionaries = { en } as const;
type Locale = keyof typeof dictionaries;

// TODO: to add Spanish, create ./es.ts with the same keys as en.ts, add it here
// (`{ en, es }`), and switch currentLocale -- no component changes needed.
const currentLocale: Locale = 'en';

export function t(key: keyof typeof en, vars?: Record<string, string | number>): string {
  let str: string = dictionaries[currentLocale][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{${k}}`, String(v));
    }
  }
  return str;
}
