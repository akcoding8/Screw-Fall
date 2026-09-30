import { resolveBase } from './pwa-config.mjs';
process.stdout.write(`${resolveBase({ base: process.env.SCREW_FALL_BASE, repository: process.env.GITHUB_REPOSITORY })}\n`);
