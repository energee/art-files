// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n, { getLanguage, isNote, languages, resolveLanguage, setLanguage, t, useLanguage } from "../src/i18n";

afterEach(() => {
  vi.restoreAllMocks();
  setLanguage("en");
  localStorage.clear();
});

describe("language selection", () => {
  it("declares every UI language to macOS so native panels follow the system language", () => {
    const plist = readFileSync("src-tauri/Info.plist", "utf8");
    const declared = [...plist.matchAll(/<string>(\w+)<\/string>/g)].map((m) => m[1]);
    expect(declared).toEqual(languages.map(({ value }) => value));
  });

  it("still reads a note made before a language switch as a warning", () => {
    setLanguage("de");
    const note = t("Note: {{message}}", { message: "x" });
    setLanguage("fr");
    expect(isNote(note)).toBe(true);
    expect(isNote("Could not open x")).toBe(false);
  });

  it("matches regional system languages in preference order and falls back for unsupported languages", () => {
    expect(resolveLanguage("system", ["ja-JP", "fr-CA", "de-DE"])).toBe("fr");
    expect(resolveLanguage("system", ["ES-mx"])).toBe("es");
    expect(resolveLanguage("system", ["de_AT"])).toBe("de");
    expect(resolveLanguage("system", ["pt-BR"])).toBe("pt");
    expect(resolveLanguage("system", ["pt-PT", "en-US"])).toBe("pt");
    expect(resolveLanguage("system", ["it-IT", "ja-JP"])).toBe("en");
    expect(resolveLanguage("system", [])).toBe("en");
    expect(resolveLanguage("de", ["es-ES"])).toBe("de");
  });

  it("switches translations and document language immediately and remembers an explicit choice", () => {
    const output: string[] = [];
    for (const language of ["en", "es", "fr", "de", "pt"] as const) {
      setLanguage(language);
      expect(getLanguage()).toBe(language);
      expect(document.documentElement.lang).toBe(language);
      expect(localStorage.getItem("labellab.language")).toBe(language);
      output.push(t("Language"));
    }
    expect(output).toEqual(["Language", "Idioma", "Langue", "Sprache", "Idioma"]);
  });

  it("selects locale-specific plural forms, including French zero, and interpolates counts", () => {
    setLanguage("en");
    expect(t("{{count}} layer", { count: 0 })).toBe("0 layers");
    expect(t("{{count}} layer", { count: 1 })).toBe("1 layer");
    expect(t("{{count}} layer", { count: 2 })).toBe("2 layers");
    setLanguage("fr");
    expect(t("{{count}} layer", { count: 0 })).toBe("0 calque");
    expect(t("{{count}} layer", { count: 1 })).toBe("1 calque");
    expect(t("{{count}} layer", { count: 2 })).toBe("2 calques");
    setLanguage("de");
    expect(t("{{count}} layer", { count: 1 })).toBe("1 Ebene");
    expect(t("{{count}} layer", { count: 2 })).toBe("2 Ebenen");
    setLanguage("pt");
    expect(t("{{count}} layer", { count: 1 })).toBe("1 camada");
    expect(t("{{count}} layer", { count: 2 })).toBe("2 camadas");
  });

  it("uses English for an unknown resource key without losing interpolated user content", () => {
    setLanguage("fr");
    expect(t("Unsupported message for {{name}}", { name: "Lupula <2026>" })).toBe("Unsupported message for Lupula <2026>");
  });

  it("re-renders useLanguage when only the preference changes", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-BR"]);
    function Probe() {
      const { preference, language } = useLanguage();
      return `${preference}:${language}`;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => { setLanguage("pt"); root.render(createElement(Probe)); });
    expect(host.textContent).toBe("pt:pt");
    act(() => setLanguage("system"));
    expect(host.textContent).toBe("system:pt");
    act(() => root.unmount());
  });

  it("keeps language switching available when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    setLanguage("es");
    expect(getLanguage()).toBe("es");
    expect(t("Language")).toBe("Idioma");
  });

  it("restores system detection when an explicit choice is cleared in another window", () => {
    setLanguage("de");
    localStorage.removeItem("labellab.language");
    window.dispatchEvent(new StorageEvent("storage", { key: "labellab.language", newValue: null }));
    expect(getLanguage()).toBe(resolveLanguage("system", navigator.languages));
    expect(document.documentElement.lang).toBe(i18n.resolvedLanguage);
  });

  it("treats an invalid stored preference as system instead of selecting an unsupported locale", () => {
    setLanguage("fr");
    localStorage.setItem("labellab.language", "not-a-language");
    window.dispatchEvent(new StorageEvent("storage", { key: "labellab.language", newValue: "not-a-language" }));
    expect(getLanguage()).toBe(resolveLanguage("system", navigator.languages));
    setLanguage("system");
    expect(localStorage.getItem("labellab.language")).toBeNull();
  });
});

describe("dates", () => {
  it("formats in the UI language, in the operator's region of it", async () => {
    const { shortDate } = await import("../src/lib/utils");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB", "de-AT"]);
    setLanguage("en");
    expect(shortDate("2026-10-11T12:00:00Z")).toBe("11 Oct 2026");
    setLanguage("es");
    expect(shortDate("2026-10-11T12:00:00Z")).toBe(new Intl.DateTimeFormat("es", { month: "short", day: "numeric", year: "numeric" }).format(new Date("2026-10-11T12:00:00Z")));
    expect(shortDate("not a date")).toBe("");
  });
});
