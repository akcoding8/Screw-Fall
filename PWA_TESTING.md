# PWA testing

Development, localhost production preview and the hosted app answer different questions. Keep those origins separate when comparing saves: different hosts or ports have different storage.

## Development gameplay

```sh
npm run dev -- --host
```

Use Vite's Network address for a phone on the same Wi-Fi. This is useful for controls, layout, audio and gameplay. Normal dev mode does not register a production service worker, so edits are not hidden by an old offline cache. Plain HTTP on a LAN address is not the final secure iPhone/iPad install environment.

An explicit developer-only opt-in is available:

```sh
VITE_PWA_DEV=true npm run dev
```

Use that only for targeted worker diagnostics at localhost. It is not the release acceptance path. To return to ordinary development, stop the server and restart without the flag. In browser developer tools, find the Service Workers/Application area for that exact local app URL, unregister only Screw Fall's worker and delete only its Screw Fall cache entries. Close the app's tabs and reopen. Do **not** use a blanket “Clear site data” action if you want to keep localStorage saves and IndexedDB screenshots. Do not unregister other projects' workers or delete their caches on a shared origin.

## Production build and localhost preview

From the project folder:

```sh
npm ci
npm test
npm run build
npm run verify:pwa
npm run verify:release
npm run preview
```

Open the printed localhost URL on the same computer. Localhost is a browser secure-context exception and supports production service-worker testing. The same preview served to a phone over LAN HTTP is not equivalent to GitHub Pages HTTPS.

1. Open Settings → About and record the version/build identifier.
2. In developer tools, confirm the manifest loads, required icons resolve and the worker is registered under this app's base path.
3. Wait for **Ready to play offline**, then reload once online so the worker controls the page.
4. Disable the network using the browser's network/offline tooling. Reload the page normally; do not use a hard reload that bypasses the worker. Confirm the game loads.
5. Play, open Skins and Settings, inspect a British milestone in a temporary debug session if desired, and test existing screenshot evidence offline.
6. Restore online mode. Check for console errors, failed asset requests and accidental external runtime requests.
7. Inspect Cache Storage. Entries should belong to Screw Fall's base; localStorage and IndexedDB remain separate player-data stores. Repeat at root and project bases with an unrelated test-app cache present, and confirm the unrelated cache remains.

Use a disposable browser profile for destructive storage tests. Debug manipulation forks session-only progress; reloading returns to the real save. Never clear genuine player data merely to test installation.

## Root and project-subpath builds

The default local base is `/`. Exercise root, lowercase and case-preserving project paths, passing the same exact base to every command:

```sh
SCREW_FALL_BASE=/ npm run build
SCREW_FALL_BASE=/ npm run verify:pwa
SCREW_FALL_BASE=/ npm run verify:release
SCREW_FALL_BASE=/screw-fall/ npm run build
SCREW_FALL_BASE=/screw-fall/ npm run verify:pwa
SCREW_FALL_BASE=/screw-fall/ npm run verify:release
SCREW_FALL_BASE=/Screw-Fall/ npm run build
SCREW_FALL_BASE=/Screw-Fall/ npm run verify:pwa
SCREW_FALL_BASE=/Screw-Fall/ npm run verify:release
SCREW_FALL_BASE=/Screw-Fall/ npm run preview
```

For that final preview, open the printed origin with `/Screw-Fall/` appended. Refresh and repeat the offline check there. Its manifest start URL, manifest scope, app identity and worker scope must all stay under `/Screw-Fall/`; visiting a sibling path must not return this game's cached shell.

Pure path tests also cover arbitrary mixed-case repository names, a `.github.io` user-site repository, explicit override, duplicate slashes and missing trailing slashes. Workflow regression tests check that build and both verifier CLIs receive the resolver output, including when the repository override variable is empty. If finishing with an ordinary root preview, rebuild at `/` first. `verify:pwa` checks an existing `dist` build; it does not rebuild it silently.

The production verifier checks manifest fields, dimensions, references, worker/precache presence, base-path consistency, private/local asset dependencies and file-size limits. It prints total build/precache sizes and the largest asset. Static verification is useful evidence, but it cannot prove iOS installation or an actual offline launch.

## Responsive and standalone checks

Exercise these representative CSS viewports in browser responsive tools, then repeat the important checks on physical devices after deployment:

| Device class | Portrait viewport |
| --- | --- |
| Smaller phone | 375 × 812 |
| Standard phone | 390 × 844 |
| Large phone | 430 × 932 |
| iPad mini | 744 × 1133 |
| 11-inch iPad | 834 × 1194 |
| 13-inch iPad | 1024 × 1366 |
| Desktop landscape | 1440 × 900, with centred portrait game area |

Confirm the tower remains centred and the ball/contact anchor stays at the same relative height. Check top UI below the status-bar inset, bottom actions above the Home indicator, platform edges, large imported level numbers and scrollable Settings/Skins/Progress. Open and zoom an evidence image, then close it and require a fresh gesture. Return from the keyboard and file picker; resize and rotate. Touch landscape should show the existing rotate-device overlay.

Display-mode emulation can exercise detection and styling, but cannot reproduce all Safari status-bar, safe-area or Home Screen lifecycle behaviour. Observe sustained smoothness, audio, high-refresh rendering, heat and battery on real hardware. PWA logic is event-driven and does not run on every gameplay frame.

## Hosted iPhone/iPad acceptance

The deployed GitHub Pages HTTPS URL is the authoritative test for Home Screen installation. Follow [PWA_INSTALL.md](PWA_INSTALL.md), verify the actual project scope and complete the Airplane Mode test. Confirm separate browser/device storage expectations instead of assuming a development save will appear there.

## Safe update: Version A → Version B

This test requires a deployed app and is completed after the initial local-only implementation.

1. Deploy Version A. Open/install it, complete a level and create saved points, settings and skin ownership. Attach an evidence screenshot if testing evidence persistence.
2. Record the visible totals and version. Keep Version A open.
3. Make a harmless visible change and run `npm version patch --no-git-tag-version` to create Version B. Update the changelog, test/build/verify, commit and push using [DEPLOYMENT.md](DEPLOYMENT.md).
4. Wait for deployment. Return to Version A online, or reopen it. Use **Check for updates** if needed; repeated checks are throttled.
5. If actively playing when B arrives, confirm no update prompt covers play and no reload occurs during falling, smash, death/completion animation or transition.
6. Reach a settled holding state. Choose **Later** and confirm it stays dismissed for that session while Settings still offers **Update now**.
7. In a safe state, choose **Restart now** or **Update now**. The current save must be written and read back successfully, pending evidence work must finish, and the final save must be verified again before activation. Do not close the app while a screenshot operation is still running.
8. Confirm exactly one restart into Version B. Verify the saved level, Points, Lifetime Points, Score, Best, selected/owned skins, settings and screenshot evidence.
9. Inspect Cache Storage after activation. Workbox should remove obsolete asset URL/revision entries inside the current Screw Fall precache without clearing localStorage, IndexedDB or a sibling app's cache. The current cache container can remain and be reused between builds; its removal is not the expected success condition.
10. Reopen B offline and confirm normal play still works.

Also exercise **Offline** and **Could not check** update states, and an activation failure using the automated mocked registration tests. Failure must leave saved data intact and let the existing version continue. Unsupported service workers should leave ordinary online play available.

The automated save/update tests simulate unavailable storage, rejected writes, silent write loss and a failure after an evidence reference changes. In each case, confirm that no worker activation or reload occurs, the in-memory progress/evidence remain available, and the UI asks the player to keep the game open. Restore working storage and retry: the complete latest save must be verified before one activation/reload. Ordinary gameplay retains its existing in-memory fallback; an update must never turn that fallback into an avoidable loss of current progress. Use mocks or a disposable test profile for these failure cases, never a genuine player save.

## Cache-format changes

The broad `cleanupOutdatedCaches` legacy-container sweep is disabled because its scope substring matching can include sibling caches when this app is deployed at the origin root. Standard generated precache activation still removes obsolete app-file entries from Screw Fall’s exact namespaced current cache. This first release has no older PWA cache format to migrate. Before a future Workbox major/cache-format upgrade, inspect the old and new names and design/test a migration restricted to Screw Fall’s prefix and exact scope. Do not enable a blanket cache sweep or clear all Cache Storage to make an update test pass.

## Release boundaries

A local build can verify generated assets and exercise localhost service workers. It cannot honestly establish a successful GitHub deployment, iPhone/iPad Home Screen installation or physical-device performance. Record those as pending until tested. Use [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) to separate local checks from hosted/device acceptance.
