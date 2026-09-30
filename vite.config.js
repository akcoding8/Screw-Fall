import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { resolveBase, createManifest, workboxOptions, buildInformation } from './scripts/pwa-config.mjs';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const base = resolveBase({ base: env.SCREW_FALL_BASE, repository: env.GITHUB_REPOSITORY });
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const info = buildInformation({ version, commit: env.GITHUB_SHA });
  return {
    base,
    define: { __APP_VERSION__: JSON.stringify(info.version), __APP_BUILD__: JSON.stringify(info.build),
      __PWA_DEV__: JSON.stringify(env.VITE_PWA_DEV === 'true') },
    optimizeDeps: { entries: ['index.html'] },
    server: { host: '127.0.0.1', watch: { ignored: ['**/.tools/**', '**/artifacts/**', '**/.npm-cache/**'] } },
    build: { sourcemap: false },
    plugins: [VitePWA({
      strategies: 'generateSW', registerType: 'prompt', injectRegister: null,
      base, scope: base, filename: 'sw.js', manifest: createManifest(base),
      includeAssets: ['third-party-notices.txt'], includeManifestIcons: false,
      workbox: workboxOptions(base),
      devOptions: { enabled: env.VITE_PWA_DEV === 'true', navigateFallback: base },
    })],
    test: { include: ['tests/**/*.test.js'] },
  };
});
