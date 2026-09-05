// Run with npx tsx scripts/benchmark-layout.ts; cached fonts, representative Lolev layers.
import { performance } from 'node:perf_hooks';
import { lolevLayers, pdfMeasure, logoSvg } from '../tests/fixtures';
import { planLayers, planLayerScene } from '../src/planLayers';
import { boxesForLayers, hitBoxesFromLayout } from '../src/hittestLayers';
const layers = lolevLayers();
const realMeasure = await pdfMeasure();
let calls = 0;
const measure: typeof realMeasure = (...args) => { calls++; return realMeasure(...args); };
const assets = { logoSvg };
function preview(shared: boolean) {
  if (shared) {
    const { items, boxes } = planLayerScene(layers, measure, assets);
    return { items, boxes: hitBoxesFromLayout(layers, boxes).filter((b) => ['name', 'description'].includes(b.id)) };
  }
  return { items: planLayers(layers, measure, assets), boxes: boxesForLayers(['name', 'description'], layers, measure, assets) };
}
for (let n = 0; n < 10; n++) { preview(false); preview(true); }
const rounds = [];
for (let round = 0; round < 5; round++) {
  for (const shared of [false, true]) {
    calls = 0;
    const start = performance.now();
    for (let n = 0; n < 100; n++) preview(shared);
    rounds.push({ shared, ms: performance.now() - start, measurements: calls });
  }
}
console.log(JSON.stringify(rounds, null, 2));
