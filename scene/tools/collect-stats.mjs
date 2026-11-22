import { chromium } from 'playwright';
import fs from 'node:fs';

const browser = await chromium.launch({ headless: true });
const results = [];

const views = [
  ['near', 'так'],
  ['near', 'ні'],
  ['hall', 'так'],
  ['hall', 'ні'],
  ['far', 'так'],
  ['far', 'ні']
];

for (const [view, culling] of views) {
  const page = await browser.newPage();

  const cull = culling === 'ні' ? '&cull=0' : '';
  await page.goto(`http://localhost:8090/scene/?view=${view}${cull}`);

  await page.waitForFunction(() => window.__sceneStatsReady === true);
  await page.waitForTimeout(2000);

  const stats = await page.evaluate(() => window.__sceneStats());

  results.push(stats);
  await page.close();
}

await browser.close();

const csv = [
  'view;culling;calls;triangles;lodLevel;frustumCulled',
  ...results.map(x =>
    `${x.view};${x.culling};${x.calls};${x.triangles};${x.lodLevel};${x.frustumCulled}`
  )
].join('\n');

fs.writeFileSync('../results/lod-stats.csv', '\uFEFF' + csv);
console.table(results);
console.log('Збережено: results/lod-stats.csv');