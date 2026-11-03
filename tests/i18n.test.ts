// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shortDate } from "../src/lib/utils";
import { getLanguage, languages, resolveLanguage, setLanguage, t, useLanguage } from "../src/i18n";

afterEach(async () => {
  vi.restoreAllMocks();
  await setLanguage("en");
  localStorage.clear();
});

describe("language selection", () => {
  it("declares every UI language to macOS so native panels follow the system language", () => {
    const plist = readFileSync("src-tauri/Info.plist", "utf8");
    const declared = [...plist.matchAll(/<string>(\w+)<\/string>/g)].map((m) => m[1]);
    expect(declared).toEqual(languages.map(({ value }) => value));
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

  it("switches translations and document language and remembers an explicit choice", async () => {
    const output: string[] = [];
    for (const language of ["en", "es", "fr", "de", "pt"] as const) {
      await setLanguage(language);
      expect(getLanguage()).toBe(language);
      expect(document.documentElement.lang).toBe(language);
      expect(localStorage.getItem("labellab.language")).toBe(language);
      output.push(t("Language"));
    }
    expect(output).toEqual(["Language", "Idioma", "Langue", "Sprache", "Idioma"]);
  });

  it("selects locale-specific plural forms, including French zero, and interpolates counts", async () => {
    await setLanguage("en");
    expect(t("{{count}} layer", { count: 0 })).toBe("0 layers");
    expect(t("{{count}} layer", { count: 1 })).toBe("1 layer");
    expect(t("{{count}} layer", { count: 2 })).toBe("2 layers");
    await setLanguage("fr");
    expect(t("{{count}} layer", { count: 0 })).toBe("0 calque");
    expect(t("{{count}} layer", { count: 1 })).toBe("1 calque");
    expect(t("{{count}} layer", { count: 2 })).toBe("2 calques");
    await setLanguage("de");
    expect(t("{{count}} layer", { count: 1 })).toBe("1 Ebene");
    expect(t("{{count}} layer", { count: 2 })).toBe("2 Ebenen");
    await setLanguage("pt");
    expect(t("{{count}} layer", { count: 1 })).toBe("1 camada");
    expect(t("{{count}} layer", { count: 2 })).toBe("2 camadas");
  });

  it("uses English for an unknown resource key without losing interpolated user content", async () => {
    await setLanguage("fr");
    expect(t("Unsupported message for {{name}}", { name: "Lupula <2026>" })).toBe("Unsupported message for Lupula <2026>");
  });

  it("re-renders useLanguage when only the preference changes", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-BR"]);
    function Probe() {
      const { preference, language } = useLanguage();
      return `${preference}:${language}`;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => { await setLanguage("pt"); root.render(createElement(Probe)); });
    expect(host.textContent).toBe("pt:pt");
    await act(() => setLanguage("system"));
    expect(host.textContent).toBe("system:pt");
    act(() => root.unmount());
  });

  it("keeps language switching available when browser storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    await setLanguage("es");
    expect(getLanguage()).toBe("es");
    expect(t("Language")).toBe("Idioma");
  });

  it("treats an invalid stored preference as system instead of selecting an unsupported locale", async () => {
    localStorage.setItem("labellab.language", "not-a-language");
    vi.resetModules();
    const fresh = await import("../src/i18n");
    await fresh.languageReady;
    expect(fresh.getLanguage()).toBe(resolveLanguage("system", navigator.languages));
    expect(document.documentElement.lang).toBe(fresh.getLanguage());
    await fresh.setLanguage("system");
    expect(localStorage.getItem("labellab.language")).toBeNull();
  });
});

describe("catalog loading", () => {
  it("loads only the active language's catalog at startup, before the first render", async () => {
    localStorage.setItem("labellab.language", "de");
    vi.resetModules();
    const fresh = await import("../src/i18n");
    await fresh.languageReady;
    expect(fresh.getLanguage()).toBe("de");
    expect(fresh.t("Language")).toBe("Sprache");
    expect(document.documentElement.lang).toBe("de");
    expect(fresh.default.hasResourceBundle("fr", "translation")).toBe(false);
  });

  it("lets the last language picked win when an earlier catalog arrives later", async () => {
    vi.resetModules();
    const fresh = await import("../src/i18n");
    await Promise.all([fresh.setLanguage("es"), fresh.setLanguage("fr"), fresh.setLanguage("es")]);
    expect(fresh.getLanguage()).toBe("es");
    expect(fresh.t("Language")).toBe("Idioma");
  });
});

describe("dates", () => {
  it("formats in the UI language, in the operator's region of it", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB", "de-AT"]);
    await setLanguage("en");
    expect(shortDate("2026-10-11T12:00:00Z")).toBe("11 Oct 2026");
    await setLanguage("es");
    expect(shortDate("2026-10-11T12:00:00Z")).toBe(new Intl.DateTimeFormat("es", { month: "short", day: "numeric", year: "numeric" }).format(new Date("2026-10-11T12:00:00Z")));
    expect(shortDate("not a date")).toBe("");
  });
});
