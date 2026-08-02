// main.ts — web UI wiring: form <-> LabelConfig, file drops, live PDF
// previews (the generated PDFs themselves, embedded), and downloads.
import "./style.css";
import type { Fill, Layer, LabelConfig, StyledLine } from "./types";
import { defaultConfig, parseConfigFile, toConfigFile } from "./defaults";
import { validateUpc } from "./upc";
import { validateMask, recolorMaskForPdf } from "./maskimage";
import { buildArtPdf, buildMaskPdf, type Assets } from "./pdf/build";
import poppinsRegular from "./assets/fonts/Poppins-Regular.ttf?url";
import poppinsSemiBold from "./assets/fonts/Poppins-SemiBold.ttf?url";
import poppinsBold from "./assets/fonts/Poppins-Bold.ttf?url";
import logoSvg from "./assets/logo2025.svg?raw";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

let cfg: LabelConfig = defaultConfig();
let texture: { bytes: Uint8Array; kind: "png" | "jpg"; name: string } | null = null;
let maskPng: { bytes: Uint8Array; name: string } | null = null;
let maskError = "";
let artUrl = "";
let maskUrl = "";

const fonts = { regular: new Uint8Array(), semibold: new Uint8Array(), bold: new Uint8Array() };
async function loadFonts() {
  const get = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  [fonts.regular, fonts.semibold, fonts.bold] = await Promise.all([
    get(poppinsRegular), get(poppinsSemiBold), get(poppinsBold),
  ]);
}

// ---- form rendering ------------------------------------------------------

function styleSelects(s: { fill: Fill; layer: Layer }, onChange: () => void, fillless = false): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (!fillless) {
    const fill = document.createElement("select");
    for (const f of ["gold", "white", "black"] as Fill[])
      fill.add(new Option(f, f, false, s.fill === f));
    fill.onchange = () => { s.fill = fill.value as Fill; onChange(); };
    out.push(fill);
  }
  const layer = document.createElement("select");
  for (const l of ["metallic", "white"] as Layer[])
    layer.add(new Option(l, l, false, s.layer === l));
  layer.onchange = () => { s.layer = layer.value as Layer; onChange(); };
  out.push(layer);
  return out;
}

function textRow(
  label: string,
  line: StyledLine,
  opts: { editable?: boolean; removable?: () => void } = {},
): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";
  const name = document.createElement("label");
  name.className = "name";
  name.textContent = label;
  row.append(name);
  if (opts.editable !== false) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = line.text;
    input.oninput = () => { line.text = input.value; refresh(); };
    row.append(input);
  }
  const bold = document.createElement("input");
  bold.type = "checkbox";
  bold.title = "bold";
  bold.checked = !!line.bold;
  bold.onchange = () => { line.bold = bold.checked; refresh(); };
  row.append(bold, ...styleSelects(line, refresh));
  if (opts.removable) {
    const rm = document.createElement("button");
    rm.className = "ghost";
    rm.textContent = "×";
    rm.onclick = () => { opts.removable!(); renderForm(); refresh(); };
    row.append(rm);
  }
  return row;
}

function plainRow(label: string, value: string, oninput: (v: string) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";
  const name = document.createElement("label");
  name.className = "name";
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.oninput = () => { oninput(input.value); refresh(); };
  row.append(name, input);
  return row;
}

function styleRow(label: string, s: { fill: Fill; layer: Layer }, fillless = false): HTMLElement {
  const row = document.createElement("div");
  row.className = "row";
  const name = document.createElement("label");
  name.className = "name";
  name.textContent = label;
  row.append(name, ...styleSelects(s, refresh, fillless));
  return row;
}

function heading(text: string): HTMLElement {
  const h = document.createElement("h2");
  h.textContent = text;
  return h;
}

function renderForm() {
  const root = $("#fields");
  root.replaceChildren();
  // Writes through to cfg.qrLayer (a bare copy would be lost on change).
  const qrStyle = {
    fill: "gold" as Fill,
    get layer() { return cfg.qrLayer; },
    set layer(v: Layer) { cfg.qrLayer = v; },
  };
  root.append(
    heading("Beer"),
    plainRow("Name", cfg.beerName, (v) => (cfg.beerName = v)),
    styleRow("Name style", cfg.nameStyle),
    textRow("Subtitle", cfg.styleLine),
    plainRow("ABV %", cfg.abv, (v) => (cfg.abv = v)),
    styleRow("ABV style", cfg.abvStyle),
    plainRow("UPC-A", cfg.upc, (v) => (cfg.upc = v.trim())),
    plainRow("QR data", cfg.qrData, (v) => (cfg.qrData = v)),
    styleRow("QR layer", qrStyle, true),
    heading("Description"),
    textRow("Header", cfg.descriptionHeader),
  );
  cfg.descriptionLines.forEach((line, i) =>
    root.append(
      textRow(`Line ${i + 1}`, line, {
        removable: () => cfg.descriptionLines.splice(i, 1),
      }),
    ),
  );
  const add = document.createElement("button");
  add.className = "ghost";
  add.textContent = "+ line";
  add.onclick = () => {
    cfg.descriptionLines.push({ text: "", fill: "gold", layer: "metallic" });
    renderForm();
  };
  root.append(
    add,
    heading("Template elements"),
    textRow("Volume", cfg.volume),
    styleRow("Wordmark", cfg.wordmark),
    styleRow("Logo", cfg.logo),
    textRow("Handle/addr", cfg.handleAddress),
    styleRow("Warning", cfg.warning),
    textRow("Store cold", cfg.storeCold),
  );
}

// ---- file handling -------------------------------------------------------

function wireDrop(dropId: string, inputId: string, handler: (f: File) => void) {
  const drop = $(dropId);
  const input = $(inputId) as HTMLInputElement;
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer?.files[0];
    if (f) handler(f);
  };
  input.onchange = () => { if (input.files?.[0]) handler(input.files[0]); };
}

async function onTexture(f: File) {
  texture = {
    bytes: new Uint8Array(await f.arrayBuffer()),
    kind: /\.jpe?g$/i.test(f.name) ? "jpg" : "png",
    name: f.name,
  };
  $("#texture-name").textContent = f.name;
  refresh();
}

async function onMask(f: File) {
  const bmp = await createImageBitmap(f);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const check = validateMask(data.data);
  maskError = check.ok ? "" : check.error!;
  recolorMaskForPdf(data.data);
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
  maskPng = { bytes: new Uint8Array(await blob.arrayBuffer()), name: f.name };
  $("#mask-name").textContent = f.name;
  refresh();
}

// ---- generation ----------------------------------------------------------

let timer = 0;
function refresh() {
  clearTimeout(timer);
  timer = window.setTimeout(generate, 600);
}

async function generate() {
  const errors: string[] = [];
  const upc = validateUpc(cfg.upc);
  if (!upc.ok) errors.push(upc.error!);
  if (maskError) errors.push(maskError);
  if (!cfg.beerName.trim()) errors.push("Beer name is required.");
  if (!texture) errors.push("Drop a texture image.");
  if (!maskPng) errors.push("Drop a metallic mask PNG.");
  $("#errors").textContent = errors.join("\n");
  const blocked = !texture || !maskPng || !upc.ok || !cfg.beerName.trim();
  ($("#dl-art") as HTMLButtonElement).disabled = blocked;
  ($("#dl-mask") as HTMLButtonElement).disabled = blocked;
  if (blocked) return;

  const assets: Assets = {
    fonts,
    logoSvg,
    texture: { bytes: texture!.bytes, kind: texture!.kind },
    maskPng: maskPng!.bytes,
  };
  const [art, mask] = await Promise.all([
    buildArtPdf(cfg, assets),
    buildMaskPdf(cfg, assets),
  ]);
  URL.revokeObjectURL(artUrl);
  URL.revokeObjectURL(maskUrl);
  artUrl = URL.createObjectURL(new Blob([art.slice() as unknown as BlobPart], { type: "application/pdf" }));
  maskUrl = URL.createObjectURL(new Blob([mask.slice() as unknown as BlobPart], { type: "application/pdf" }));
  ($("#prev-art") as HTMLEmbedElement).src = artUrl;
  ($("#prev-mask") as HTMLEmbedElement).src = maskUrl;
}

function download(url: string, name: string) {
  if (!url) return;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

// ---- boot ----------------------------------------------------------------

wireDrop("#drop-texture", "#file-texture", (f) => void onTexture(f));
wireDrop("#drop-mask", "#file-mask", (f) => void onMask(f));
$("#dl-art").onclick = () => download(artUrl, `${cfg.beerName}.pdf`);
$("#dl-mask").onclick = () => download(maskUrl, `${cfg.beerName}-mask.pdf`);
$("#save-config").onclick = () => {
  const blob = new Blob([JSON.stringify(toConfigFile(cfg), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  download(url, `${cfg.beerName || "label"}-config.json`);
  URL.revokeObjectURL(url);
};
$("#load-config").onclick = () => ($("#file-config") as HTMLInputElement).click();
($("#file-config") as HTMLInputElement).onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    cfg = parseConfigFile(await f.text());
    renderForm();
    refresh();
  } catch (err) {
    $("#errors").textContent = String(err);
  }
};

renderForm();
void loadFonts().then(refresh);
