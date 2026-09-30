import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listFiles, parseVerificationArguments, verifyPwa } from './verify-pwa.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REQUIRED_IGNORES = ['node_modules/package/index.js', 'dist/index.html', 'coverage/report.html',
  'test-results/result.png', 'playwright-report/index.html', '.tools/baseline/package.json', 'artifacts/capture.png',
  '.npm-cache/index', '.env', '.env.production', '.DS_Store', 'session.log', 'temp/draft.js',
  'backups/old.js', 'recordings/demo.mp4', 'references/sample.png', 'screenshots/private.png',
  'captures/debug.png', 'save-exports/save.json', 'player.screw-fall-save.json'];
const PUBLIC_ASSETS = new Set(['icons/screw-fall-icon-source.svg', 'icons/favicon.svg',
  'icons/favicon-16.png', 'icons/favicon-32.png', 'icons/apple-touch-icon-180.png',
  'icons/pwa-192.png', 'icons/pwa-512.png', 'icons/pwa-maskable-512.png', 'icons/screw-fall-1024.png', 'third-party-notices.txt']);
const TEXT_EXTENSIONS = /\.(?:js|mjs|cjs|json|md|txt|html|css|svg|webmanifest|ya?ml)$/i;
const REQUIRED_DOCUMENTS = ['README.md', 'IMPLEMENTATION_NOTES.md', 'DEPLOYMENT.md', 'PWA_INSTALL.md',
  'PWA_TESTING.md', 'RELEASE_CHECKLIST.md', 'CHANGELOG.md'];

/** The repository uses simple ignore rules. Support their ordered negations,
 * basename globs and directory rules without loading Git or changing Git state. */
export function createIgnoreMatcher(source) {
  const rules = source.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
    const include = line.startsWith('!');
    const raw = include ? line.slice(1) : line;
    const directory = raw.endsWith('/');
    const pattern = raw.replace(/^\//, '').replace(/\/$/, '');
    const anchored = pattern.includes('/') || raw.startsWith('/');
    let regex = '';
    for (let index = 0; index < pattern.length; index++) {
      const char = pattern[index];
      if (char === '*' && pattern[index + 1] === '*') { regex += '.*'; index++; }
      else if (char === '*') regex += '[^/]*';
      else if (char === '?') regex += '[^/]';
      else regex += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return { include, regex: new RegExp(`${anchored ? '^' : '(?:^|/)'}${regex}${directory ? '(?:/|$)' : '$'}`) };
  });
  return path => {
    let ignored = false;
    for (const rule of rules) if (rule.regex.test(path)) ignored = !rule.include;
    return ignored;
  };
}

/** Report locations and categories, never echo a possible credential value. */
export function scanReleaseText(text, path) {
  const findings = [];
  const rules = [
    ['absolute-user-path', /(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+\//g],
    ['filesystem-link', /file:\/\/[^\s"'`<>]+/g],
    ['OpenAI-style-key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
    ['GitHub-style-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g],
    ['AWS-style-key', /\bAKIA[A-Z0-9]{16}\b/g],
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ['credential-assignment', /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'`][A-Za-z0-9_+/=.:-]{24,}["'`]/gi],
  ];
  for (const [kind, pattern] of rules) for (const match of text.matchAll(pattern)) {
    findings.push({ path, line: text.slice(0, match.index).split('\n').length, kind });
  }
  // Private URLs are useful in test fixtures and local-preview instructions.
  // They must never become a game/runtime dependency or a public app asset.
  if (/^(?:src|public)\//.test(path) || path === 'index.html') {
    const privateUrl = /https?:\/\/(?:localhost(?=[:/"'`\s]|$)|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[::1\])/gi;
    for (const match of text.matchAll(privateUrl)) findings.push({ path, line: text.slice(0, match.index).split('\n').length, kind: 'private-runtime-url' });
  }
  return findings;
}

export async function verifyRelease({ root = PROJECT_ROOT, directory = resolve(root, 'dist'), base } = {}) {
  root = resolve(root);
  const report = { ok: false, packageVersion: null, nodeVersion: null, scannedSourceFiles: 0,
    productionDependencies: [], ignoredPrivateDirectories: [], findings: [], errors: [], warnings: [] };
  const check = (condition, message) => { if (!condition) report.errors.push(message); };
  const read = path => readFile(resolve(root, path), 'utf8');
  let ignore, files, pkg, lock;
  try {
    ignore = createIgnoreMatcher(await read('.gitignore'));
    for (const path of REQUIRED_IGNORES) check(ignore(path), `.gitignore does not exclude ${path}.`);
    check(!ignore('.env.example'), '.gitignore should keep the safe .env.example template visible.');
    files = await listFiles(root, { skip: (path, isDirectory) => {
      if (path === '.git' || path.startsWith('.git/')) return true;
      if (ignore(path)) {
        if (isDirectory && !['node_modules', 'dist', '.npm-cache'].includes(path)) report.ignoredPrivateDirectories.push(path);
        return true;
      }
      return false;
    } });
    pkg = JSON.parse(await read('package.json'));
    lock = JSON.parse(await read('package-lock.json'));
    report.packageVersion = pkg.version;
    report.nodeVersion = (await read('.nvmrc')).trim();
  } catch (error) { report.errors.push(`Cannot inspect release source: ${error.code || error.message}`); return report; }
  check(pkg.name === 'screw-fall', 'Package name must remain screw-fall.');
  check(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version || ''), 'Package version must be a semantic version.');
  check(pkg.version === lock.version && pkg.version === lock.packages?.['']?.version, 'Package and lockfile root versions disagree.');
  check(pkg.name === lock.name && pkg.name === lock.packages?.['']?.name, 'Package and lockfile names disagree.');
  check(/^24(?:\.\d+(?:\.\d+)?)?$/.test(report.nodeVersion), '.nvmrc must select the chosen Node 24 LTS release.');
  check(pkg.engines?.node?.includes('24'), 'Package engines must support the documented Node 24 release.');
  for (const name of ['vite-plugin-pwa', '@resvg/resvg-js']) {
    check(Boolean(pkg.devDependencies?.[name]) && !pkg.dependencies?.[name], `${name} must be development/build tooling.`);
  }
  for (const command of ['test', 'build', 'preview', 'generate:pwa-assets', 'verify:pwa', 'verify:release']) check(Boolean(pkg.scripts?.[command]), `Missing release npm script: ${command}`);
  for (const section of ['dependencies', 'devDependencies']) {
    const declared = pkg[section] || {};
    const locked = lock.packages?.['']?.[section] || {};
    check(Object.keys(declared).length === Object.keys(locked).length
      && Object.entries(declared).every(([name, version]) => locked[name] === version), `package-lock does not match package ${section}.`);
  }
  for (const [name, range] of Object.entries(pkg.dependencies || {})) {
    try {
      const metadata = JSON.parse(await read(`node_modules/${name}/package.json`));
      report.productionDependencies.push({ name, range, installedVersion: metadata.version, licence: metadata.license || null });
      check(typeof metadata.license === 'string' && metadata.license.length > 0, `Production dependency has no declared licence: ${name}`);
      if (name !== 'three') report.warnings.push(`Additional production dependency requires manual runtime/privacy review: ${name}`);
    } catch (error) { report.errors.push(`Cannot inspect installed production dependency ${name}: ${error.code || 'invalid metadata'}`); }
  }
  const byPath = new Map(files.map(file => [file.path, file]));
  for (const document of REQUIRED_DOCUMENTS) check(byPath.has(document), `Missing release documentation: ${document}`);
  check(!files.some(file => /^(?:LICEN[CS]E|COPYING)(?:\.|$)/i.test(file.path)), 'A project licence file was added although this release does not request one.');
  for (const file of files) {
    if (/\.(?:mp4|mov|webm|screw-fall-save\.json)$/i.test(file.path)
      || /(?:^|\/)(?:screenshots|recordings|references|uploads|save-exports|backups|debug-captures)\//.test(file.path)) {
      report.errors.push(`Private development material is not ignored: ${file.path}`);
    }
    if (file.path.startsWith('public/')) check(PUBLIC_ASSETS.has(file.path.slice(7)), `Unreviewed public asset: ${file.path}`);
    if (TEXT_EXTENSIONS.test(file.path) || /^\.(?:npmrc|nvmrc|gitignore)$/.test(file.path)) {
      if (file.bytes > 4 * 1024 * 1024) { report.errors.push(`Source text is unexpectedly large: ${file.path}`); continue; }
      report.scannedSourceFiles++;
      const contents = await readFile(file.absolute, 'utf8');
      report.findings.push(...scanReleaseText(contents, file.path));
      if (file.path === 'README.md') check(!/\b(?:open[ -]source|clone)\b/i.test(contents), 'README must not claim open-source licensing or describe the game as a clone.');
      if (file.path === '.npmrc') check(!/(?:_authToken|_auth|password)\s*=/.test(contents), '.npmrc contains authentication configuration.');
    }
  }
  for (const finding of report.findings) report.errors.push(`Potential ${finding.kind}: ${finding.path}:${finding.line}`);
  try {
    const workflow = await read('.github/workflows/deploy-pages.yml');
    const actions = [...workflow.matchAll(/\buses:\s*([^\s#]+)/g)].map(([, value]) => value);
    const expected = ['checkout', 'setup-node', 'configure-pages', 'upload-pages-artifact', 'deploy-pages'];
    for (const action of expected) check(actions.some(value => new RegExp(`^actions/${action}@[a-f0-9]{40}$`).test(value)), `Pages workflow needs official SHA-pinned actions/${action}.`);
    check(actions.every(value => /^actions\/[a-z-]+@[a-f0-9]{40}$/.test(value)), 'Pages workflow contains an unpinned or non-official action.');
    for (const command of ['npm ci', 'npm test', 'npm run build', 'npm run verify:pwa', 'npm run verify:release']) check(workflow.includes(command), `Pages workflow omits ${command}.`);
    check(/pages:\s*write/.test(workflow) && /id-token:\s*write/.test(workflow), 'Pages workflow permissions are incomplete.');
    check(!/\bgit\s+(?:init|commit|push|remote)\b/.test(workflow), 'Pages workflow must not initialise, commit, push or reconfigure Git.');
  } catch (error) { report.errors.push(`Cannot inspect Pages workflow: ${error.code || error.message}`); }
  report.pwa = await verifyPwa({ directory, base });
  if (!report.pwa.ok) report.errors.push('Production PWA verification failed; see pwa.errors.');
  report.warnings.push('Static scanning cannot prove that no private material exists; review the staged file list before the first public push.');
  report.ok = report.errors.length === 0;
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseVerificationArguments(process.argv.slice(2), { allowRoot: true });
    const report = await verifyRelease(options);
    if (!options.json) console.log(`Release verification ${report.ok ? 'passed' : 'failed'}: version ${report.packageVersion || 'unknown'}, ${report.scannedSourceFiles} source files scanned.`);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
