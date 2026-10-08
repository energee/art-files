// recovery.test.ts — only snapshots from an earlier launch are offered back (#394).
import { expect, it } from "vitest";
import { LAUNCH_ID, fromEarlierLaunch, recoveryKey } from "@/recovery";

it("keys a tab's snapshot under this launch", () => {
  expect(recoveryKey(3)).toBe(`${LAUNCH_ID}:3`);
});

it("offers only keys from an earlier launch", () => {
  expect(fromEarlierLaunch(["now:1", "old:1", "old:2", "nowish:1"], "now"))
    .toEqual(["old:1", "old:2", "nowish:1"]);
});
