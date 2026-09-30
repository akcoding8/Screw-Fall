import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { generateLevel } from '../src/game/LevelGenerator.js';
import { analyzeEconomy } from '../src/game/EconomyAnalyzer.js';

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const countIndex = args.indexOf('--levels');
const output = resolve(outputIndex >= 0 ? args[outputIndex + 1] : 'artifacts/phase3-economy-analysis.json');
const count = countIndex >= 0 ? Number(args[countIndex + 1]) : 500;
if (!Number.isSafeInteger(count) || count < 10 || count > 10000 || count % 10 !== 0) {
  throw new Error('--levels must be a multiple of 10 between 10 and 10000.');
}
const start = performance.now();
const levels = Array.from({ length: count }, (_, index) => generateLevel(index + 1));
const report = analyzeEconomy(levels);
report.elapsedMs = performance.now() - start;
report.failures = [];
for (const model of report.models) {
  if (model.pointsBalance !== model.lifetimePoints) report.failures.push(`${model.profile}: death removed currency`);
  if (model.profile === 'capable' && model.skins.some(skin => skin.tier !== 'premium' && skin.estimatedNormalLevelsOnly >= 100)) {
    report.failures.push('Capable play requires at least 100 normal levels for a Standard skin.');
  }
  if (model.premium.unlockLifetimePoints !== 100000 || model.premium.goldPrice !== 1000000) {
    report.failures.push(`${model.profile}: Premium milestone or Gold price changed`);
  }
}
const example = report.purchaseAndDeathExample;
if (!example.purchase.ok || example.before.pointsBalance - example.afterPurchase.pointsBalance !== example.price
  || example.before.lifetimePoints !== example.afterPurchase.lifetimePoints
  || example.afterDeath.pointsBalance !== example.afterPurchase.pointsBalance || example.afterDeath.currentNoDeathScore !== 0) {
  report.failures.push('Purchase/death accounting invariant failed.');
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.table(report.models.map(model => ({ profile: model.profile,
  normal: model.normalPoints.mean.toFixed(2), flow: model.flowPoints.mean.toFixed(2),
  perTenLevels: model.pointsPerTenLevels.mean.toFixed(2),
  firstPaidLevels: model.skins.find(skin => skin.price > 0).estimatedNumberedLevels,
  highestStandardLevels: Math.max(...model.skins.filter(skin => skin.tier !== 'premium').map(skin => skin.estimatedNumberedLevels)),
  premiumUnlockLevels: model.premium.estimatedUnlockNumberedLevels,
  goldLevels: model.premium.estimatedGoldNumberedLevels,
  goldAfterStandardLevels: model.premium.estimatedGoldAfterStandardCollectionLevels })));
console.table(report.models[0].skins.map((skin, index) => ({ skin: skin.name, price: skin.price,
  cautious: report.models[0].skins[index].estimatedNumberedLevels,
  capable: report.models[1].skins[index].estimatedNumberedLevels,
  skilled: report.models[2].skins[index].estimatedNumberedLevels })));
console.log(`Standard prices and earnings unchanged; Premium estimates extrapolate the sampled mean and exclude earlier purchases unless shown. ${count} generated levels; ${report.failures.length} accounting/economy failures. Report: ${output}`);
if (report.failures.length) process.exitCode = 1;
