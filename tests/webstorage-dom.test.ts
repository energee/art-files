// webstorage-dom.test.ts — DOM suites must see happy-dom's localStorage, not
// Node's. Node 25+ ships a native `localStorage` global that is undefined
// without `--localstorage-file`; before Vitest 5 it shadowed happy-dom's and
// suites needed NODE_OPTIONS=--no-experimental-webstorage (#419). Vitest 5's
// populateGlobal overrides the native getter, so `npm test` needs no flag.
// This fails if a runner upgrade or Node change lets the native global win.
// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

afterEach(() => localStorage.clear());

it("localStorage and sessionStorage are happy-dom's working Storage", () => {
  expect(globalThis.localStorage).toBe(window.localStorage);
  expect(globalThis.sessionStorage).toBe(window.sessionStorage);
  localStorage.setItem("labellab.probe", "1");
  expect(localStorage.getItem("labellab.probe")).toBe("1");
});
