# Screw Fall

Screw Fall is an original, mobile-first 3D arcade game. Rotate a tower to guide a bouncing ball through its gaps, build a clean drop streak and find the next opening.

The game runs in modern phone, iPad and desktop browsers. Its installable PWA can launch offline after one complete online load. There are no ads, analytics, accounts or real-money purchases.

## Play

Drag left or right on the play area to rotate the tower. Mouse and trackpad dragging work too. The ball bounces automatically. Safe tops bounce; ribbed hazard tops and walls are dangerous. Clear three platforms without landing to prepare a smash: the next platform top shatters and the ball rebounds. Walls remain lethal even when smash-ready.

Normal towers vary their openings and obstacles. Every tenth level is a hazard-free Flow tower, except multiples of 100, which are distinct British milestone challenges. After a death, release any held finger and make a fresh tap when **Tap to retry** appears.

Points buy cosmetics in the optional Skins collection: 20 Standard skins and seven Premium skins. Premium access unlocks at 100,000 Lifetime Points. Every skin uses the same gameplay collider. The current no-death Score continues across towers; death resets Score while preserving Best, spendable Points and Lifetime Points.

Settings includes sensitivity from 0.5× to 3.0×, Soft/Vivid/Mixed palettes, sound, Stats, progress history, install help and update controls. Touch play uses portrait orientation; landscape shows a rotate-device reminder. Desktop uses a centred portrait play area.

## Progress and privacy

Progress, points, skins, settings and optional screenshot evidence stay in this device/browser. There is no account, cloud sync or gameplay-data upload. Hosting still involves ordinary requests for the app's static files. Clearing site data can remove progress and screenshots; browser storage is not a backup.

A newly hosted GitHub Pages copy starts with its own local data. Local development progress does not automatically transfer, and separate devices/browsers have separate progress. Use **Settings → Progress → Continue from another game** to enter a chosen starting level if desired. This changes level provenance, never awards points, scores or skins. Later updates on the same hosted origin preserve its existing saved data.

## Run locally

Install the Node 24 LTS version pinned in `.nvmrc`. If using nvm, run `nvm install` and `nvm use` in the project folder. Then:

```sh
npm ci
npm run dev
```

For gameplay testing on a phone on the same Wi-Fi:

```sh
npm run dev -- --host
```

Open the Network address printed by Vite and keep the development server running. Normal development does not register a service worker. Phone LAN testing is separate from installation/offline acceptance on HTTPS.

| Command | Purpose |
| --- | --- |
| `npm test` | Gameplay, persistence, rendering invariants and PWA tests |
| `npm run build` | Production app in `dist/` |
| `npm run preview` | Serve that build locally |
| `npm run verify:pwa` | Validate the existing production manifest, paths, assets and precache |
| `npm run verify:release` | Check release files and production-output hygiene |
| `npm run generate:pwa-assets` | Reproduce icons from the original SVG master |
| `npm run generate:pwa-assets -- --check` | Verify generated icons are current |
| `npm run analyze:levels` | Deterministic level validation and distribution analysis |
| `npm run analyze:motion` | Fixed-step/render/camera checks across frame schedules |
| `npm run analyze:economy` | Synthetic earning and cosmetic-price analysis |

Build before running the output verification commands. Generated `dist/`, dependencies, private captures and local analysis reports are excluded from Git.

## Install, deploy and update

- [Deployment](DEPLOYMENT.md): create a personal GitHub repository and enable GitHub Pages manually.
- [Install](PWA_INSTALL.md): add Screw Fall to an iPhone/iPad Home Screen and check offline play.
- [PWA testing](PWA_TESTING.md): root/subpath builds, local preview, device checks and safe updates.
- [Release checklist](RELEASE_CHECKLIST.md): checks before and after publishing.
- [Implementation notes](IMPLEMENTATION_NOTES.md): architecture, storage, icons and PWA lifecycle.
- [Changelog](CHANGELOG.md): player-facing release changes.

The included GitHub Actions workflow tests, builds and verifies future pushes to `main`, then deploys `dist` to Pages. Updates wait for a safe state and ask before restarting. **Later** keeps the current session running; **Update now** remains in Settings. Installation is optional.

## Project status and assets

Version 1.0.0 prepares the game for its first hosted PWA release. GitHub setup, publication and physical iPhone/iPad acceptance are separate manual steps; local implementation alone does not establish those results.

The app icon is an original project-local SVG with reproducible PNG outputs. Tower geometry, skins, flags, textures and effects are generated by local code; sound is synthesised with Web Audio. No reference recordings, external fonts, CDN textures or remote gameplay services are required. See [third-party notices](THIRD_PARTY_NOTICES.md) for the libraries distributed with the app.
