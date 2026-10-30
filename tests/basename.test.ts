// basename.test.ts — baseName, the file name toasts show for a path: the last
// segment on either separator, a bare name unchanged, and the whole path when
// it ends in a separator (a folder), so a toast never names an empty file.
import { expect, it } from "vitest";
import { baseName } from "../src/lib/utils";

it("takes the last segment of a POSIX or Windows path, and leaves a bare name alone", () => {
  expect(baseName("/Users/x/Lupula.pdf")).toBe("Lupula.pdf");
  expect(baseName("C:\\x\\Lupula.pdf")).toBe("Lupula.pdf");
  expect(baseName("Lupula.pdf")).toBe("Lupula.pdf");
});

it.each([["/x/exports/"], ["C:\\x\\exports\\"], ["/"]])("returns the whole path when %s ends in a separator", (path) => {
  expect(baseName(path)).toBe(path);
});
