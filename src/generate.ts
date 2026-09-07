// generate.ts — DOM-free headless generate: argv, inspect, coerce, build.

export const USAGE =
  "usage: npm run generate -- <master.master> [values.json|-] <outDir> " +
  "[--variant id] [--asset layerId=path] [--set id=value] [--format pdf|psd|all] [--label file.label]\n" +
  "       npm run generate -- <master.master> --inspect\n" +
  "       npm run generate -- <texture|none> <mask.png|none> <outDir> [config.json] " +
  "[--collab-left=file] [--collab-center=file]";

export type FormatSet = { pdf: boolean; psd: boolean };

export type GenerateArgs =
  | {
      mode: "legacy";
      texturePath: string;
      maskPath: string;
      outDir: string;
      configPath?: string;
      collabLeft?: string;
      collabCenter?: string;
    }
  | {
      mode: "inspect";
      masterPath?: string;
    }
  | {
      mode: "generate";
      masterPath?: string;
      valuesPath?: string;
      labelPath?: string;
      outDir: string;
      variants: string[];
      assets: Record<string, string>;
      set: Record<string, string>;
      format: FormatSet;
    };

const BOOL_FLAGS = new Set(["inspect"]);
const KNOWN_FLAGS = new Set([
  "inspect", "master", "values", "label", "out", "variant", "asset", "set", "format",
  "collab-left", "collab-center",
]);

function parseFormat(raw: string): FormatSet {
  if (raw === "all") return { pdf: true, psd: true };
  if (raw === "pdf") return { pdf: true, psd: false };
  if (raw === "psd") return { pdf: false, psd: true };
  throw new Error(`--format must be pdf, psd, or all\n${USAGE}`);
}

function kv(flag: string, raw: string): [string, string] {
  const i = raw.indexOf("=");
  if (i <= 0 || i === raw.length - 1) throw new Error(`--${flag} needs id=value\n${USAGE}`);
  return [raw.slice(0, i), raw.slice(i + 1)];
}

function isMasterPath(p: string): boolean {
  return p.endsWith(".master");
}

/** Parse argv into a generate / inspect / legacy job. `--flag value` and
 *  `--flag=value` both work; `--inspect` is a bare switch. Throws USAGE on
 *  anything malformed. */
export function parseGenerateArgs(argv: string[]): GenerateArgs {
  const positional: string[] = [];
  const singles: Record<string, string> = {};
  const variants: string[] = [];
  const assets: Record<string, string> = {};
  const set: Record<string, string> = {};
  let inspect = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { positional.push(a); continue; }
    const eq = a.indexOf("=");
    const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    if (!KNOWN_FLAGS.has(name)) throw new Error(`unknown flag --${name}\n${USAGE}`);
    if (BOOL_FLAGS.has(name)) {
      if (eq >= 0) throw new Error(`--${name} does not take a value\n${USAGE}`);
      inspect = true;
      continue;
    }
    const value = eq >= 0 ? a.slice(eq + 1) : argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value\n${USAGE}`);
    if (name === "variant") { variants.push(value); continue; }
    if (name === "asset") { const [id, path] = kv("asset", value); assets[id] = path; continue; }
    if (name === "set") { const [id, v] = kv("set", value); set[id] = v; continue; }
    if (name in singles) throw new Error(`--${name} given twice\n${USAGE}`);
    singles[name] = value;
  }

  const flagMaster = singles.master;
  const posMaster = positional.find(isMasterPath);
  const masterPath = flagMaster ?? posMaster;
  const rest = positional.filter((p) => p !== masterPath);

  if (inspect) {
    if (singles.values || singles.label || singles.out || rest.length)
      throw new Error(USAGE);
    return { mode: "inspect", ...(masterPath ? { masterPath } : {}) };
  }

  const newForm = !!(singles.master || singles.values || singles.label || masterPath);
  if (newForm) {
    if (singles.label && singles.values) throw new Error(`--label cannot be combined with --values\n${USAGE}`);
    let valuesPath = singles.values;
    let outDir = singles.out;
    const leftover = [...rest];
    if (!outDir) {
      if (!leftover.length) throw new Error(USAGE);
      outDir = leftover.pop()!;
    }
    if (valuesPath === undefined && leftover.length && !singles.label)
      valuesPath = leftover.shift()!;
    if (leftover.length) throw new Error(USAGE);
    return {
      mode: "generate",
      ...(masterPath ? { masterPath } : {}),
      ...(valuesPath !== undefined ? { valuesPath } : {}),
      ...(singles.label ? { labelPath: singles.label } : {}),
      outDir,
      variants,
      assets,
      set,
      format: singles.format ? parseFormat(singles.format) : { pdf: true, psd: true },
    };
  }

  if (positional.length >= 3) {
    const [texturePath, maskPath, outDir, configPath] = positional;
    if (positional.length > 4) throw new Error(USAGE);
    return {
      mode: "legacy",
      texturePath, maskPath, outDir,
      ...(configPath ? { configPath } : {}),
      ...(singles["collab-left"] ? { collabLeft: singles["collab-left"] } : {}),
      ...(singles["collab-center"] ? { collabCenter: singles["collab-center"] } : {}),
    };
  }

  throw new Error(USAGE);
}
