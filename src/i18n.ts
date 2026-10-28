import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { useSyncExternalStore } from "react";
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
  return typeof window === "undefined" ? [] : navigator.languages?.length
    ? navigator.languages : [navigator.language];
}

const resources = Object.fromEntries(languages.map(({ value }) => [value, {
  translation: {
    ...core[value], ...shell[value], ...controls[value], ...messages[value],
    ...inspector[value], ...workspace[value], ...editor[value], ...validation[value],
  },
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

const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function notify(): void {
  if (typeof document !== "undefined" && document.documentElement) document.documentElement.lang = getLanguage();
  for (const listener of listeners) listener();
}
i18n.on("languageChanged", notify);
notify();

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
  notify();
}

export function useLanguage(): { preference: LanguagePreference; language: Language; setLanguage: typeof setLanguage } {
  useSyncExternalStore(subscribe, () => `${preference}:${getLanguage()}`);
  return { preference, language: getLanguage(), setLanguage };
}

if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    if (preference === "system") void i18n.changeLanguage(resolveLanguage(preference, systemLanguages()));
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    preference = readPreference();
    void i18n.changeLanguage(resolveLanguage(preference, systemLanguages()));
    notify();
  });
}

/** A "Note:" message is a warning, not an error. Checked in every UI
 *  language: a note keeps the language it was made in after a switch. */
export function isNote(text: string): boolean {
  return languages.some(({ value }) => text.startsWith(i18n.getFixedT(value)("Note:")));
}

export default i18n;
