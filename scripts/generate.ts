// generate.ts — Node entry for `npm run generate`. Argv and filesystem only;
// resolve / plan / encode live in generate-lib.ts so tests drive them without
// spawning a process.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { runGenerate } from "./generate-lib";

const argv = process.argv.slice(2);
const code = await runGenerate({
  argv,
  cwd: process.cwd(),
  readStdin: () => readFileSync(0, "utf8"),
  readFile: (p) => new Uint8Array(readFileSync(p)),
  readFileText: (p) => readFileSync(p, "utf8"),
  writeFile: (p, b) => writeFileSync(p, b),
  mkdir: (p) => mkdirSync(p, { recursive: true }),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
process.exit(code);
