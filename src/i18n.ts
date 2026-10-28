import i18next from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import core from "./locales/core";
import shell from "./locales/shell";
import controls from "./locales/controls";
import messages from "./locales/messages";
import workspace from "./locales/workspace";
import inspector from "./locales/inspector";
import editor from "./locales/editor";
import validation from "./locales/validation";

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

// Later catalogs win on a duplicate key, so keep each key in one catalog.
const catalogs = [core, shell, controls, messages, inspector, workspace, editor, validation];
const resources = Object.fromEntries(languages.map(({ value }) => [value, {
  translation: Object.assign({}, ...catalogs.map((catalog) => catalog[value])),
}]));

const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources,
  lng: resolveLanguage(preference, systemLanguages()),
  fallbackLng: "en",
  supportedLngs: languages.map(({ value }) => value),
  keySeparator: false,
  nsSeparator: false,
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export const t = i18n.t.bind(i18n);
export function getLanguage(): Language {
  const language = i18n.resolvedLanguage ?? null;
  return isLanguage(language) ? language : "en";
}

function syncDocumentLang(): void {
  if (typeof document !== "undefined" && document.documentElement) document.documentElement.lang = getLanguage();
}
i18n.on("languageChanged", syncDocumentLang);
syncDocumentLang();

/** Changing UI language never replaces or remounts the document workspace. */
export function setLanguage(next: LanguagePreference): void {
  preference = next;
  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // A blocked store must not prevent changing language for this session.
  }
  void i18n.changeLanguage(resolveLanguage(preference, systemLanguages()));
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
