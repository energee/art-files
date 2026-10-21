// @vitest-environment happy-dom
// theme-sync-dom.test.tsx — every useTheme reader follows a change made
// through any of them: the View → Appearance checks (App) and the Settings
// switch (ThemeSwitch) must never disagree about the current theme.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { useTheme, type Theme } from "@/theme";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.clear();
  document.body.replaceChildren();
});

it("re-renders every reader when one of them sets the theme", async () => {
  const seen: Theme[][] = [[], []];
  let set: (t: Theme) => void = () => {};
  function Reader({ n }: { n: number }) {
    const [theme, setTheme] = useTheme();
    seen[n].push(theme);
    if (n === 0) set = setTheme;
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render([createElement(Reader, { n: 0, key: 0 }), createElement(Reader, { n: 1, key: 1 })]);
  });
  await act(async () => { set("dark"); });
  expect(seen[1].at(-1)).toBe("dark");
  expect(localStorage.getItem("theme")).toBe("dark");
  await act(async () => { set("system"); });
  expect(seen[1].at(-1)).toBe("system");
  expect(document.documentElement.dataset.theme).toBeUndefined();
  await act(async () => root.unmount());
});
