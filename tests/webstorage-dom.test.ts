// webstorage-dom.test.ts — DOM suites must see happy-dom's localStorage, not
// Node's. Node 25+ ships a native `localStorage` global that is undefined
// without `--localstorage-file`; before Vitest 5 it shadowed happy-dom's and
// suites needed NODE_OPTIONS=--no-experimental-webstorage (#419). Vitest 5
// added both Storage keys to populateGlobal's override list, so `npm test`
// needs no flag.
// This fails if a runner upgrade or Node change lets the native global win.
// It can only fail on Node 25+, where the native global exists; CI runs Node 24.
// @vitest-environment happy-dom
import { Storage as HappyDomStorage } from "happy-dom";
import { afterEach, expect, it } from "vitest";

afterEach(() => localStorage.clear());

// instanceof, not `=== window.localStorage`: here `window` is globalThis, so an
// identity check would pass even if Node's native Storage had won.
it("localStorage and sessionStorage are happy-dom's working Storage", () => {
  expect(localStorage).toBeInstanceOf(HappyDomStorage);
  expect(sessionStorage).toBeInstanceOf(HappyDomStorage);
  localStorage.setItem("labellab.probe", "1");
  expect(localStorage.getItem("labellab.probe")).toBe("1");
});
