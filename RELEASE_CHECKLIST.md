# Release checklist

Use a fresh copy for each release. A local build does not complete the hosted/device checks.

## Code

- [ ] `npm ci` succeeds using the Node version in `.nvmrc`.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npm run verify:pwa` passes for `/` and the intended project subpath.
- [ ] `npm run verify:release` passes; manually review staged files for private material.
- [ ] `npm run generate:pwa-assets -- --check` passes.
- [ ] Level, motion and economy analyses pass.
- [ ] No secrets, personal paths, screenshots, recordings or player data are staged or built.
- [ ] Package version and changelog are correct; `package-lock.json` is included in the commit.
- [ ] Dependency audit findings are understood; no unreviewed dependency upgrade was applied.

## Game regression

- [ ] Gravity, bounce, terminal speed, collision rules and input sensitivity are unchanged.
- [ ] High-refresh smoothness, interpolation and camera composition remain correct.
- [ ] A normal tower, a Flow tower and a British milestone work.
- [ ] Points, Lifetime Points, Score and Best behave correctly through death/retry/completion.
- [ ] Standard and Premium shop purchases/equipment persist correctly.
- [ ] Paint, smash effects, audio and debris still work.
- [ ] Progress import and adjustments preserve earned totals; screenshots remain viewable.
- [ ] Closing Settings/Skins/Progress requires a fresh gameplay gesture.

## PWA

- [ ] Manifest fields and deployment scope are valid.
- [ ] App icon is clear at small size; maskable crop keeps the important artwork.
- [ ] Apple touch icon has the correct dimensions and opaque background.
- [ ] Standalone layout respects status-bar and Home-indicator safe areas.
- [ ] Service worker is registered only for the app path.
- [ ] “Ready to play offline” appears after installation completes.
- [ ] Offline launch, gameplay, skins, audio and existing evidence work.
- [ ] Active play defers updates; Later suppresses repeated prompts for this session.
- [ ] Check for updates and Update now remain available in Settings.
- [ ] An A → B update reloads once and retains progress, points, skins, settings and evidence.
- [ ] Obsolete app-file entries are cleaned within the current Screw Fall precache; player storage and sibling-app caches remain.
- [ ] Any Workbox major/cache-format change has an explicit own-prefix/exact-scope migration review; the broad legacy-container sweep stays disabled.
- [ ] Share uses the public app root without debug parameters or player data.

## GitHub — manual first setup

- [ ] Personal account and intended repository are confirmed.
- [ ] Initial files are reviewed, committed and pushed to `main`.
- [ ] Settings → Pages → Build and deployment → Source is **GitHub Actions**.
- [ ] Actions run succeeds and the `github-pages` deployment is successful.
- [ ] Public HTTPS URL loads directly and after a refresh.

## Devices — after deployment

- [ ] iPhone browser: touch, safe areas, modal scrolling and landscape overlay.
- [ ] iPhone standalone: no Safari toolbar, correct composition and fresh-gesture handling.
- [ ] iPad browser: tower scale, panels and screenshot viewer.
- [ ] iPad standalone: safe areas, rotation and high-refresh play where supported.
- [ ] Desktop: centred portrait game area, mouse and trackpad.
- [ ] Airplane Mode: reopen the installed app and test normal play.
- [ ] Reconnect and complete the safe-update test in [PWA_TESTING.md](PWA_TESTING.md).
