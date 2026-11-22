import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = 'http://localhost:8090/scene/';
const TOTAL_TILES = 341;
const RESULTS_DIR = path.resolve('../results');

const scenarios = [
  { view: 'mid', errorTarget: 16 },
  { view: 'hall', errorTarget: 16 },
  { view: 'far', errorTarget: 16 },
  { view: 'far', errorTarget: 32 }
];

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const scenario of scenarios) {
    const { view, errorTarget } = scenario;
    const url = `${BASE_URL}?tiles=1&view=${view}&errorTarget=${errorTarget}`;

    console.log(`\nПеревірка: view=${view}, errorTarget=${errorTarget}`);

    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 }
    });

    const tileResponses = [];
    const errors = [];

    page.on('response', response => {
      if (response.url().includes('/tiles/')) {
        tileResponses.push({
          url: response.url(),
          status: response.status()
        });
      }
    });

    page.on('pageerror', error => errors.push(error.message));

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(
      () => window.__sceneStatsReady && window.__tiles,
      { timeout: 30000 }
    );

    // Очікуємо стабілізації завантаження тайлів.
    let previous = '';
    let stableCount = 0;
    let stats = null;

    const start = Date.now();

    while (Date.now() - start < 45000) {
      await page.waitForTimeout(500);

      stats = await page.evaluate(() => window.__sceneStats());

      const signature = JSON.stringify({
        cached: stats.tiles.cached,
        visible: stats.tiles.visible,
        triangles: stats.triangles,
        downloading: stats.tiles.downloading,
        queued: stats.tiles.queued,
        parsing: stats.tiles.parsing
      });

      const idle =
        stats.tiles.downloading === 0 &&
        stats.tiles.queued === 0 &&
        stats.tiles.parsing === 0;

      if (idle && signature === previous) {
        stableCount++;
      } else {
        stableCount = 0;
      }

      previous = signature;

      if (stableCount >= 4) break;
    }

    const result = {
      view,
      errorTarget,
      totalTiles: TOTAL_TILES,
      cached: stats.tiles.cached,
      cachedPercent: Number(
        (stats.tiles.cached / TOTAL_TILES * 100).toFixed(1)
      ),
      visible: stats.tiles.visible,
      triangles: stats.triangles,
      cachedMiB: stats.tiles.cachedMiB,
      cacheLimitMiB: stats.tiles.cacheLimitMiB,
      cacheFull: stats.tiles.cacheFull,
      networkTileRequests: tileResponses.length,
      networkSuccessful: tileResponses.filter(r =>
        r.status >= 200 && r.status < 300
      ).length,
      networkFailed: tileResponses.filter(r =>
        r.status >= 400
      ).length,
      stable: stableCount >= 4,
      errors
    };

    results.push(result);

    console.log(JSON.stringify(result, null, 2));

    await page.close();
  }
} finally {
  await browser.close();
}

fs.mkdirSync(RESULTS_DIR, { recursive: true });

const jsonPath = path.join(RESULTS_DIR, 'tiles-stats.json');
fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf8');

const columns = [
  'view',
  'errorTarget',
  'cached',
  'cachedPercent',
  'visible',
  'triangles',
  'cachedMiB',
  'networkTileRequests',
  'networkSuccessful',
  'networkFailed',
  'stable'
];

const csv = [
  columns.join(';'),
  ...results.map(row =>
    columns.map(key => row[key]).join(';')
  )
].join('\n');

const csvPath = path.join(RESULTS_DIR, 'tiles-stats.csv');
fs.writeFileSync(csvPath, '\uFEFF' + csv, 'utf8');

console.log('\n=== ПІДСУМКИ ===');
console.table(results.map(row => ({
  view: row.view,
  errorTarget: row.errorTarget,
  cached: `${row.cached}/${TOTAL_TILES}`,
  visible: row.visible,
  triangles: row.triangles,
  MiB: row.cachedMiB,
  requests: row.networkTileRequests,
  stable: row.stable
})));

console.log(`\nJSON: ${jsonPath}`);
console.log(`CSV:  ${csvPath}`);