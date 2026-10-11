// errmsg.test.ts — errMsg, the one spelling of "which text do I show for
// whatever was thrown?", and a message built on it (no "Error: " prefix).
import { expect, it } from "vitest";
import { errMsg } from "../src/lib/utils";
import { loadFailedMessage } from "../src/components/LazyDialog";

it("errMsg shows an Error's message, a string as-is, and anything else stringified", () => {
  expect(errMsg(new Error("boom"))).toBe("boom");
  expect(errMsg(new TypeError("bad type"))).toBe("bad type");
  expect(errMsg("os error 2")).toBe("os error 2");
  expect(errMsg(42)).toBe("42");
  expect(errMsg(undefined)).toBe("undefined");
});

it("a failed lazy load names the reason without the Error: prefix", () => {
  expect(loadFailedMessage("Settings", new Error("chunk missing")))
    .toBe("Settings failed to load: chunk missing. Save your work and reload Label Lab to try again.");
});
