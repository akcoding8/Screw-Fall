# Deploy Screw Fall to GitHub Pages

These instructions are manual. The implementation does not initialise Git, create a repository, set a remote, commit, push or deploy for you.

## Check the local release

Open Terminal in the project folder. On macOS, type `cd `, drag the Screw Fall folder into Terminal, then press Return. Use Node from `.nvmrc` and run:

```sh
npm ci
npm test
npm run build
npm run verify:pwa
npm run verify:release
npm run preview
```

Open the printed preview address. Inspect the icon and Settings, then follow [PWA_TESTING.md](PWA_TESTING.md). Stop the preview with Control-C when finished.

## Create the personal repository

1. Sign in to your **personal** GitHub account and check the account avatar/name.
2. Select **New repository**, with yourself as the owner. `screw-fall` is a useful name, but another repository name works too.
3. Choose visibility appropriate for your account's Pages availability. For a public release, review the source files before making them public.
4. Leave **Add a README**, **Add .gitignore** and **Choose a licence** unselected. The project already contains its documentation and ignore file, and no project licence is being added.
5. Create the empty repository. Keep its HTTPS or SSH URL available.

## Review and push the local source

Run these commands only when ready to create the local Git repository:

```sh
git init
git add .
git status --short
git diff --cached --stat
```

Review the staged list. It should include source, tests, scripts, icons, documentation, `.github`, `.nvmrc`, `package.json` and `package-lock.json`. It should exclude `node_modules`, `dist`, `.tools`, local environment files, analysis artifacts, recordings, private screenshots and player exports. `.gitignore` helps with known locations; the review catches files copied elsewhere.

Create the initial commit and use `main`:

```sh
git commit -m "Prepare Screw Fall 1.0.0 PWA release"
git branch -M main
```

If Git requests your author identity, configure your preferred name and verified GitHub email (or GitHub's private commit email) for this repository, then retry the commit. Do not paste passwords or access tokens into tracked files.

Add **one** remote. Replace both placeholders with your actual personal account and repository name before running a command; do not type the angle brackets literally.

HTTPS example:

```sh
git remote add origin https://github.com/<PERSONAL-GITHUB-USERNAME>/<REPOSITORY-NAME>.git
```

SSH alternative, only if SSH authentication is already configured for that personal account:

```sh
git remote add origin git@github.com:<PERSONAL-GITHUB-USERNAME>/<REPOSITORY-NAME>.git
```

Use only one of those two `git remote add` commands. Check it and push:

```sh
git remote -v
git push -u origin main
```

Follow GitHub's normal authentication flow if prompted. This workflow does not need a custom deployment token or API key.

## Enable Pages

1. Open the repository on GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.
4. Open **Actions → Deploy Screw Fall to GitHub Pages**.
5. Wait for the push-triggered run, or choose **Run workflow → main → Run workflow**. If the first push ran before Pages was enabled and failed, run the workflow again after enabling it.
6. Wait for the whole job to finish successfully. Failed tests, assets, builds or verification prevent deployment.
7. Open the deployment URL shown in the run's `github-pages` environment or on Settings → Pages.
8. Load the public HTTPS URL directly, refresh it, inspect Settings → About and follow [PWA_INSTALL.md](PWA_INSTALL.md).

GitHub documents the [Actions publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) and [custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## How the workflow chooses the URL path

Local builds default to `/`. In Actions, the resolver reads `GITHUB_REPOSITORY` automatically. A normal project repository uses `/<repository-name>/`, preserving the repository name's case; a user-site repository ending in `.github.io` uses `/`. The workflow passes that one resolved output as `SCREW_FALL_BASE` to the production build, `verify:pwa` and `verify:release`. The same normalized base supplies asset paths, manifest identity/start/scope, worker scope and the public share link. No username or repository name is embedded in the application.

The optional `SCREW_FALL_BASE` environment variable overrides the automatic path. A repository Actions **variable** of the same name can supply that override to the workflow; normally leave it unset. A future custom domain served from its root would require `/` and a separate review of hosting and storage implications. This project does not configure a custom domain.

Each deployment uses Node from `.nvmrc`, `npm ci`, tests, icon validation, the production build and PWA/release verification. Official checkout, setup-node and Pages actions are pinned to verified release commits. It uploads `dist` as an artifact; it does not commit built output or push a `gh-pages` branch. A newer run cancels an obsolete Pages run.

## Future releases

Make the change locally, update the changelog and bump the version. For a patch release without an automatic Git tag/commit:

```sh
npm version patch --no-git-tag-version
npm test
npm run build
npm run verify:pwa
npm run verify:release
git add .
git diff --cached --stat
git commit -m "Describe the release change"
git push
```

Review before committing. The push to `main` rebuilds and redeploys automatically. Check Actions and complete the A → B update test in [PWA_TESTING.md](PWA_TESTING.md). Installed players choose when to restart after an update is ready.

The hosted origin starts with fresh storage. Development saves do not transfer automatically. Existing **hosted** data survives app updates on the same origin; each device/browser has separate data. Settings → Progress can record a chosen starting level without importing points, scores or skins.
