import i18next, { type TFunction, type TOptions } from "i18next";
import { useMemo } from "react";
import { initReactI18next, useTranslation } from "react-i18next";
import en from "./locales/en";

// Every UI consumer loads the configured instance, including isolated dialogs.
export { useTranslation } from "react-i18next";

export type Language = "en" | "es" | "fr" | "de" | "pt";
export type LanguagePreference = Language | "system";
const STORAGE_KEY = "labellab.language";
export const languages: ReadonlyArray<{ value: Language; label: string }> = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt", label: "Português" },
];

function isLanguage(value: string | null): value is Language {
  return languages.some((language) => language.value === value);
}

function readPreference(): LanguagePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isLanguage(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

/** Match regional tags in browser preference order, then fall back to English. */
export function resolveLanguage(preference: LanguagePreference, preferred: readonly string[]): Language {
  if (preference !== "system") return preference;
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (isLanguage(base)) return base;
  }
  return "en";
}

let preference = readPreference();
/** The browser's languages. Node (the generate harness, node-environment
 *  tests) has a `navigator` that follows the OS locale; it stays English. */
function systemLanguages(): readonly string[] {
  if (typeof window === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

/** English ships inside this module; every other catalog is its own chunk,
 *  fetched only when that language becomes active. */
const catalogs: Record<Exclude<Language, "en">, () => Promise<{ default: Record<string, string> }>> = {
  es: () => import("./locales/es"),
  fr: () => import("./locales/fr"),
  de: () => import("./locales/de"),
  pt: () => import("./locales/pt"),
};

const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: "en",
  fallbackLng: "en",
  supportedLngs: languages.map(({ value }) => value),
  keySeparator: false,
  nsSeparator: false,
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export const t = i18n.t.bind(i18n);

/** useTranslation's `t` for a component that re-reads fixed labels on every
 *  render (App's command table, #725): plain lookups are remembered, while a
 *  call with options still goes to i18next. A language change gives a new `t`
 *  and so a new cache, which is what relabels everything. */
export function useCachedT(): TFunction {
  const { t: lookup } = useTranslation();
  return useMemo(() => {
    const seen = new Map<string, string>();
    return ((key: string, options?: TOptions) => {
      if (options) return lookup(key, options);
      if (!seen.has(key)) seen.set(key, lookup(key));
      return seen.get(key);
    }) as unknown as TFunction; // i18next 27 brands TFunction, so a plain function needs the double cast
  }, [lookup]);
}

export function getLanguage(): Language {
  const language = i18n.resolvedLanguage ?? null;
  return isLanguage(language) ? language : "en";
}

function syncDocumentLang(): void {
  if (typeof document !== "undefined" && document.documentElement) document.documentElement.lang = getLanguage();
}
i18n.on("languageChanged", syncDocumentLang);
syncDocumentLang();

/** Fetch the preferred language's catalog, then switch to it. A switch made
 *  while an earlier catalog was still loading wins over it. */
async function applyPreference(): Promise<void> {
  const language = resolveLanguage(preference, systemLanguages());
  if (language !== "en" && !i18n.hasResourceBundle(language, "translation")) {
    const { default: catalog } = await catalogs[language]();
    i18n.addResourceBundle(language, "translation", catalog);
  }
  if (language === resolveLanguage(preference, systemLanguages())) await i18n.changeLanguage(language);
}

/** Settles once the saved language's catalog is in; main.tsx renders after
 *  it so the first frame is already in that language. Node (the generate
 *  harness, tests) resolves English at once, with nothing to fetch. */
export const languageReady = applyPreference();

/** Changing UI language never replaces or remounts the document workspace.
 *  Resolves once the new language is showing. */
export function setLanguage(next: LanguagePreference): Promise<void> {
  preference = next;
  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // A blocked store must not prevent changing language for this session.
  }
  return applyPreference();
}

/** Re-renders on every changeLanguage, which i18next emits even when the
 *  resolved language stays the same (e.g. "pt" → "system" on a pt machine). */
export function useLanguage(): { preference: LanguagePreference; language: Language; setLanguage: typeof setLanguage } {
  useTranslation();
  return { preference, language: getLanguage(), setLanguage };
}

// ponytail: no live "languagechange"/"storage" sync. The desktop app has one
// window and macOS fixes its languages at launch; a dev browser tab reloads.

export default i18n;
