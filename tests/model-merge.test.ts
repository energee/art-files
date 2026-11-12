import { describe, expect, it } from "vitest";
import { deepEqual, deepMerge } from "../src/model/merge";

describe("deepMerge", () => {
  const base = { a: 1, style: { fill: "#fff", layer: "white" }, list: [1, 2] };
  it("merges nested objects", () => {
    expect(deepMerge(base, { style: { fill: "#000" } }))
      .toEqual({ a: 1, style: { fill: "#000", layer: "white" }, list: [1, 2] });
  });
  it("replaces arrays wholesale", () => {
    expect(deepMerge(base, { list: [9] }).list).toEqual([9]);
  });
  it("ignores undefined patch values", () => {
    expect(deepMerge(base, { a: undefined }).a).toBe(1);
  });
  it("does not mutate its inputs", () => {
    deepMerge(base, { style: { fill: "#000" } });
    expect(base.style.fill).toBe("#fff");
  });
  it("stacks: later merges win (last-enabled-wins)", () => {
    const once = deepMerge(base, { a: 2 });
    expect(deepMerge(once, { a: 3 }).a).toBe(3);
  });
  it("does not alias a patch sub-object the base lacks", () => {
    const noStyle: { a: number; extra?: { fill: string } } = { a: 1 };
    const patch = { extra: { fill: "#000" } };
    const merged = deepMerge(noStyle, patch);
    merged.extra!.fill = "#fff";
    expect(patch.extra.fill).toBe("#000");
  });
});

describe("deepEqual", () => {
  it("never calls two different Sets or Maps equal: they have no keys to compare", () => {
    expect(deepEqual(new Set([1]), new Set([2]))).toBe(false);
    expect(deepEqual(new Map([[1, 2]]), new Map([[1, 3]]))).toBe(false);
    expect(deepEqual(new Set(), {})).toBe(false);
  });

  it("still calls one Set equal to itself", () => {
    const same = new Set([1]);
    expect(deepEqual({ same }, { same })).toBe(true);
  });
});
