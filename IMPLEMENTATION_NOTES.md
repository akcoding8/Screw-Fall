# Implementation notes

Screw Fall 1.0.0 adds installation, offline caching, safe updates and release tooling around the existing game. There is no backend, account service, cloud sync, analytics, advertising or automatic transfer from development storage. Gameplay changes are outside this release.

## Repository map

| Area | Responsibility |
| --- | --- |
| `src/game/Simulation.js` | Authoritative fixed-step movement, contact, death, smash and completion |
| `FrameClock.js`, `RenderTimeline.js`, `CameraRig.js`, `Viewport.js` | Frame scheduling, interpolation and viewport-aware composition |
| `LevelGenerator.js`, `FlowLevelGenerator.js`, `BritishMilestone.js` | Deterministic tower generation and cadence |
| `ScoringManager.js`, `SaveManager.js` | Earned totals, ownership persistence and save migration |
| `ProgressModel.js`, `ProgressManager.js`, `ProgressPanel.js` | Level provenance, eligible completion counting and import UI |
| `EvidenceImageProcessor.js`, `EvidenceImageStore.js`, `EvidenceViewer.js` | Local screenshot processing, binary storage and viewing |
| `SkinCatalog.js`, `SkinMeshFactory.js`, `CosmeticEffectManager.js` | Original cosmetic definitions, procedural visuals and effects |
| `src/pwa/` | Update lifecycle, install detection, public sharing and Settings presentation |
| `scripts/pwa-config.mjs`, `vite.config.js` | Manifest, deployment paths and generated service worker |
| `.github/workflows/deploy-pages.yml` | Tests, build, verification and Pages artifact deployment |

The game supplies its current state and pending work to the PWA layer at event boundaries. The PWA layer does not participate in physics or the animation loop.

## Locked game behaviour

| Setting | Value |
| --- | --- |
| Free-fall / bounce gravity | 24.5 / 28 |
| Bounce impulse / downward terminal speed | 9.058875 / 18.4 |
| Fixed timestep / max substeps / frame clamp | 1/120 s / 12 / 0.1 s |
| Ball collider radius / orbit radius | 0.275 / 2.05 world units |
| Platform spacing | 2.25 world units |
| Camera pitch / FOV / response | 35.5° / 40° / 6 |
| Contact screen anchor / downward lag bound | 43% / 2 percentage points |
| Input baseline / sensitivity | 5.2 radians per viewport / 0.5×–3.0× |
| Renderer pixel-ratio cap | 2 |

Rendering remains driven by uncapped `requestAnimationFrame`. Fixed simulation positions are interpolated for the ball, moving geometry and camera, preserving high-refresh motion. The shop's separate preview cap does not limit gameplay. All 27 cosmetic skins use the same gameplay collider and maximum visual envelope. Paint remains pooled and attached to safe platform geometry; edge clipping and smash paint do not change collisions or debris trajectories.

Normal generator v4, Flow v2 and British milestone generator v1 keep their established layouts. Every positive multiple of 100 is a British milestone; other positive multiples of ten are Flow levels. Other numbers use the normal cadence. Geometry and palette seeds remain separate.

The viewport observer reads `visualViewport` in CSS pixels and measures safe-area padding. It does not subtract an imagined Safari toolbar. The camera anchor is relative to the usable physical-inset rectangle, with the header treated as a separate exclusion zone. `100dvh`, safe-area padding, modal scrolling and the existing landscape overlay serve both browser and installed modes; no separate phone/tablet physics or camera path is introduced.

## Saves and level provenance

The release retains save schema **5** and the existing migration code. Versions 1–4 preserve valid settings and earned data while migrating to the provenance model. Legacy level N becomes starting level 1 plus N−1 locally completed levels. New saves begin at level 1.

```text
currentLevel = startingLevel + levelsCompletedHere + sum(laterImportedAdjustments.amount)
```

A confirmed starting number/date/source is immutable; later corrections append signed records with stable IDs, reasons and optional notes/source/evidence references. Evidence references can be replaced or removed independently. The current level is derived, with compatible aliases retained for the existing application. Integer parsing and safe arithmetic reject invalid/overflowing results; the supported level range is 1 through JavaScript's maximum safe integer, 9,007,199,254,740,991.

Only a matching, activated, eligible attempt reaching its real finish counts as completed, once, after the completion hold. Death, retry, imports and debug changes do not count. Imports preserve earned Points, Lifetime Points, Score, Best and skin ownership. Debug manipulation forks session-only progression and evidence; reopening restores the normal saved state.

Point awards update memory immediately and coalesce persistence within the existing 350 ms timer. Landing, smash, death, completion, purchase, equipment, settings closure and page lifecycle boundaries flush data. An abrupt browser process termination before a flush can still lose that short pending window. Save failures leave the in-memory game usable.

## Screenshot evidence

Evidence is optional, player-provided and unverified. The save JSON contains only image IDs. IndexedDB keeps image blobs and metadata in separate stores, so large binary data does not inflate localStorage.

The processor checks actual PNG/JPEG/WebP signatures and decoding. Input limits are 20 MiB, 48 × 1024 × 1024 decoded pixels and 16,384 pixels on the long edge. Stored images are resized to at most 2,560 pixels, with 320-pixel thumbnails and a 0.92 quality target for lossy output. The store caps evidence at 256 images and 128 MiB, subject to the browser's actual quota. Missing storage or a rejected image does not block progress entry without a screenshot.

Processing and IndexedDB work are asynchronous and tracked until idle. Cancellation tokens stop a closed/replaced operation from attaching a stale image. New image writes complete before a save references them; replaced/removed blobs are cleaned explicitly. Viewer object URLs are revoked when no longer needed. A temporary debug store never deletes real evidence. These operations are awaited before a requested app restart.

## Storage inventory

| API | Name | Purpose |
| --- | --- | --- |
| localStorage | `screw-fall:save` | Schema 5 player save |
| localStorage | `screw-fall:pwa-offline:<base>` | Last version/build that showed the offline-ready toast |
| IndexedDB | `screw-fall-evidence`, version 1 | `images` and `metadata` object stores |
| Cache Storage | `screw-fall-<encoded-base>-…` | Workbox's app-file precache, with deployment base encoded into its prefix |
| Session-only memory | No storage key | Debug progression, debug evidence, dismissed-update state |

There are no sessionStorage or BroadcastChannel keys. Existing save/evidence names were already Screw Fall-specific, so no generic-key rename was needed. Cache identifiers include every character of the normalized base encoded as hexadecimal code units; sibling project paths cannot share the same prefix. Workbox also includes its normal cache-purpose/scope components.

The generated precache activation removes obsolete app-file entries only within its current, explicitly namespaced cache. It does not clear localStorage, IndexedDB, screenshots, scores, skins or unrelated app storage. Save/database names intentionally remain stable for existing same-origin data. The broad legacy-container sweep is disabled for the shared-origin reason explained below.

A hosted GitHub Pages origin starts fresh. The app does not read other origins, copy a local development save or grant earned assets from an imported level. Different browsers/devices keep independent data. The existing Progress import can record a chosen starting level. There is no backup/import bundle or cross-origin migration tool in this release. Moving to another origin later would require an explicitly designed migration/backup feature, including both save JSON and evidence blobs if preservation were wanted.

## Build versions and Node

The package name remains `screw-fall`; version moves from 0.1.0 to **1.0.0**. `.nvmrc` pins **24.21.0**, a maintained Node 24 LTS release; `engines.node` accepts the compatible 24.x line. GitHub Actions reads that exact file. The initial local baseline used Node 24.19.0 and npm 12.0.2. Vite 8.2.2, Vitest 5.0.0 and Three.js 0.186.0 remain the existing application/test stack.

PWA tooling is the build dependency `vite-plugin-pwa` 1.3.0. `@resvg/resvg-js` 2.6.2 is a development-only deterministic SVG rasterizer. Workbox code needed by the generated worker and registration adapter is bundled locally. Package-lock records the complete install; `npm ci` uses that lock.

Settings → About shows the package version, installed/browser status and the first eight characters of a validated `GITHUB_SHA`, or `local` when unavailable. Build metadata contains no secrets and does not use a visible gameplay timestamp.

## Deployment paths and manifest

`resolveBase` selects an explicit `SCREW_FALL_BASE`, otherwise the repository name from `GITHUB_REPOSITORY`, otherwise `/`. A repository ending in `.github.io` uses `/`; an ordinary repository uses `/<name>/`. Normalization adds boundary slashes, collapses duplicate slashes and rejects hostnames, queries, backslashes and traversal components. Browser code receives the resolved `import.meta.env.BASE_URL`.

The manifest is generated once from the same path configuration:

| Field | Value |
| --- | --- |
| `name`, `short_name` | Screw Fall |
| `description` | A smooth endless falling-tower arcade game. |
| `lang`, `dir` | `en-GB`, `ltr` |
| `display`, `orientation` | `standalone`, `portrait-primary` |
| `id`, `start_url`, `scope` | Normalized deployment base, without a version or tracking query |
| `background_color` | `#e9efeb`, the restrained light launch background |
| `theme_color` | `#233c37`, a dark green from the visual identity |
| `categories` | games, entertainment |
| `prefer_related_applications` | false |
| Icons | 192/512 PNG purpose `any`, 512 PNG purpose `maskable` |

HTML references Vite-managed base-aware favicon and Apple icon URLs. It uses `lang="en-GB"`, `viewport-fit=cover`, standalone compatibility metadata and a default iOS status-bar style. The page respects safe-area insets instead of drawing controls beneath the status bar. The worker, manifest and app assets live inside the same base directory. Navigation fallback accepts only that app root or its `index.html`, optionally with query parameters. It does not answer sibling or nested app paths, including when Screw Fall is deployed at the origin root.

## Original icon and generation

The master vector is `public/icons/screw-fall-icon-source.svg`, with a 1024 × 1024 design space. It uses an original descending glossy coral ball, a central column and clean offset platform arcs, with an opaque background. It has no text, external image, font, logo, pre-rounded corners or third-party reference artwork. Important content stays inside the central maskable safe circle.

Run `npm run generate:pwa-assets` after changing the source. `--check` rerenders in memory and compares bytes without rewriting assets. Rasterization disables system fonts and uses the pinned renderer; time, network and machine paths do not enter the outputs.

| Output in `public/icons/` | Dimensions / purpose |
| --- | --- |
| `favicon-16.png` | 16 × 16 favicon |
| `favicon-32.png` | 32 × 32 favicon |
| `favicon.svg` | Vector favicon derived from the master |
| `apple-touch-icon-180.png` | 180 × 180, opaque Apple icon |
| `pwa-192.png` | 192 × 192 standard PWA icon |
| `pwa-512.png` | 512 × 512 standard PWA icon |
| `pwa-maskable-512.png` | 512 × 512 maskable icon |
| `screw-fall-1024.png` | 1024 × 1024 high-resolution export |

PNG outputs are real rasterizations at those sizes. The same composition is suitable for both 512 purposes because the master itself respects the safe zone. Generation occurs during development, with CI verification; no runtime rasterization is needed. The editable master and 1024 export are available in the repository/build but excluded from the offline precache because gameplay does not need them.

## Offline service worker

The plugin uses **generateSW** and explicit **prompt** registration. There is no hand-written service worker, backend cache or runtime CDN dependency. Ordinary `npm run dev` leaves registration disabled; `VITE_PWA_DEV=true` is the explicit diagnostic opt-in. Debug mode does not initiate production registration. Production builds generate a local `sw.js` and local Workbox code.

The generated precache contains the app shell, hashed JavaScript/CSS, manifest and required icons/static assets. Gameplay geometry, textures and Web Audio sounds are generated from bundled code, so there are no external audio or texture requests to satisfy offline. Existing evidence remains in IndexedDB and can be viewed offline independently of the worker cache.

`skipWaiting` is false. A newly downloaded worker waits until activation is requested. `clientsClaim` lets the activated worker control its scope, and the navigation fallback serves the app shell only within that scope. Workbox’s standard `precacheAndRoute` activation automatically removes obsolete previous-build URLs/revisions from the current app cache. No custom runtime-caching rules fetch external data. The default per-file precache ceiling remains **2 MiB**; release verification also enforces a **5 MiB** total budget. No oversized default limit was introduced to hide bundle growth.

The separate `cleanupOutdatedCaches` option is deliberately **false** at every base. That helper deletes legacy Workbox-format cache containers using a scope substring match rather than the app prefix. For a root-scope app on a shared origin, a sibling app’s cache name can contain the same root URL. Disabling that broad sweep avoids deleting another app’s cache. Ordinary old-build asset cleanup remains enabled inside the exact current Screw Fall cache; no custom service worker is needed. This first PWA release has no incompatible older cache format to migrate. A future Workbox major upgrade or cache-format change must review a migration restricted to the Screw Fall prefix and exact scope, rather than enabling the blanket legacy sweep.

Offline support means a successful complete online installation can subsequently serve the app without network access. It does not prevent browser/OS storage eviction or make private/incognito sessions persistent. Opening online again restores the cache when necessary.

## Update lifecycle and input safety

`PwaUpdateManager` wraps the plugin's registration callbacks and activation function. First installation announces **Ready to play offline** with a short nonmodal toast. The version/build marker suppresses repeats for that build where storage is available; About retains the status.

A waiting worker sets update-ready state. The prompt is deferred while ACTIVE, DYING, COMPLETING, TRANSITIONING, hidden, context-lost or busy. The implementation uses the settled HOLDING/DEAD_WAITING states and conservatively waits for Skins, Progress and the evidence viewer to close; Settings can expose the action safely. Screenshot processing/writes and editing prevent activation. **Later** suppresses the prompt for the session, while Settings retains **Update now**.

Restart is explicitly requested by the player. It blocks gameplay input, pauses the game and makes competing controls inert. `SaveManager.flushForUpdate()` writes the complete current JSON when necessary and reads it back to verify persistence. The manager performs this check before waiting for tracked evidence work and again after those operations settle, so a newly committed screenshot reference is included before activation. This is stricter than the unchanged best-effort flush used during ordinary play.

If browser storage is unavailable, full, silently drops a write or returns a different save, activation and reload are refused. The current in-memory game remains open, controls are restored and the error asks the player to keep it open until storage is available. A later retry verifies the whole current save again, even if an earlier ordinary flush cleared its pending flag.

Once persistence is verified, the plugin's standard waiting-worker activation is requested. The update manager owns the reload callback and reloads once. A worker activated by another tab does not force this tab to reload during gameplay or an edit. Activation failure keeps the current version open and offers another attempt in Settings. Closing an update/install interaction invalidates the current gameplay gesture.

Registration performs the normal launch check. Manual **Check for updates** is throttled to once per 60 seconds. Returning to the foreground permits a further check after an hour. There is no polling interval and no PWA work inside the gameplay frame loop. Status messages distinguish checking, current, ready, offline and failed checks. Unsupported workers leave the online game functional.

## Install and public sharing

Installed mode is detected from display-mode media queries and iOS's standalone compatibility property. A captured `beforeinstallprompt` produces an Install button only when the browser provides one; calling it requires a trusted user action. iPhone/iPad users receive short Share → Add to Home Screen guidance when the programmatic prompt is unavailable. Installation is optional and never prompts automatically over gameplay.

Share Screw Fall uses the production HTTPS origin plus the resolved app-root base. It strips debug parameters and hashes by constructing a fresh canonical URL, and includes no scores or personal data. Local/private origins disable the public-share action. Web Share is preferred; clipboard and selectable-link fallbacks handle unsupported or denied sharing.

## GitHub Pages workflow and public release

The workflow runs on pushes to `main` and manual dispatch. It uses Node from `.nvmrc`, restores the npm cache, installs from the lockfile, tests, verifies icon generation, resolves the base, builds and verifies production output before upload/deployment. Output checks run after the build because they inspect `dist`. A failure stops subsequent steps. The Pages environment exposes the deployment URL; a single `pages` concurrency group cancels superseded runs.

Only official GitHub actions are used, pinned to verified release commits: checkout 7.0.1, setup-node 7.0.0, configure-pages 6.0.0, upload-pages-artifact 5.0.0 and deploy-pages 5.0.1. Permissions are contents read, pages write and id-token write. No custom secret, generated deployment branch or `gh-pages` package is needed. See [DEPLOYMENT.md](DEPLOYMENT.md) for exact manual setup and future pushes.

`.gitignore` excludes dependencies, builds, coverage, local environment files, backups, capture/reference folders, recordings and player-export files. Source and build verification look for secrets, personal filesystem paths, private runtime dependencies and unintended development assets. Pattern checks are guardrails: a staged-file review still matters. Third-party MIT notices are retained in `THIRD_PARTY_NOTICES.md` and distributed as `public/third-party-notices.txt`; no licence is assigned to the project itself.

## Verification and remaining device work

The pre-PWA build total was **912,043 bytes**, with a largest JavaScript asset of **869,087 bytes**. The initial suite had 1,284 passing tests and one pre-existing British-column texture-tiling expectation mismatch; the reviewed 2 × 96 texture repeat is retained and that stale assertion is corrected without changing rendering. Existing level, motion and economy analyses provide the behavioural baseline.

For current counts and byte sizes, run the commands in [PWA_TESTING.md](PWA_TESTING.md); verification reports the built output instead of relying on a stale hand-maintained size. PWA tests cover manifest/paths/assets, install/share logic, update deferral and one-time activation/reload, pending writes, verified save persistence before activation, namespacing and built-output checks. Existing gameplay and save tests remain part of the same suite.

Physical iPhone/iPad installation, actual GitHub Pages scope, Airplane Mode launches and A → B hosted updates require the manual checks after deployment. Desktop viewport simulation does not establish those results, sustained phone performance or thermal/battery behaviour. Follow [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) before declaring device acceptance complete.
