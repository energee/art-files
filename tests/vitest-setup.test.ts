// vitest-setup.test.ts — the shared setup file (tests/setup.ts) marks every
// suite as a React act() environment, so DOM suites need no per-file flag.
import { describe, expect, it } from "vitest";

describe("vitest setup", () => {
  it("sets IS_REACT_ACT_ENVIRONMENT for every suite", () => {
    expect((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT).toBe(true);
  });
});
