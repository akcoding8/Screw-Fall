import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { ICON_ASSETS, ICON_DIRECTORY, ICON_SOURCE, generatePwaAssets, renderIcon } from '../scripts/generate-pwa-assets.mjs';

const source = await readFile(ICON_SOURCE, 'utf8');

describe('original PWA icon assets', () => {
  it('uses a square 1024px master without rendered text, external artwork or rounded background corners', () => {
    expect(source).toContain('width="1024" height="1024" viewBox="0 0 1024 1024"');
    expect(source).toMatch(/<rect id="icon-background" width="1024" height="1024" fill="url\(#background\)"\/>/);
    expect(source).not.toMatch(/<(?:text|image|script|foreignObject)\b/i);
    expect(source).not.toMatch(/(?:href|xlink:href)\s*=/i);
    expect(source).not.toMatch(/(?:@font-face|@import|url\((?!#))/i);
  });

  it('keeps every visible foreground pixel within the central maskable safe circle', () => {
    // Remove only the full-bleed background. No test-only clipping is applied:
    // this checks that the authored column, platforms, ball and shadow fit.
    const foreground = source.replace(/<rect id="icon-background"[^>]+\/>/, '');
    const { pixels, width, height } = renderIcon(foreground, 1024);
    let visible = 0;
    let maximumRadius = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] > 0) {
          visible++;
          maximumRadius = Math.max(maximumRadius, Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2));
        }
      }
    }
    expect(visible).toBeGreaterThan(150_000);
    expect(maximumRadius).toBeLessThanOrEqual(409.6);
  });

  it('renders an opaque Apple touch icon, including every corner', () => {
    const { pixels } = renderIcon(source, 180);
    for (let offset = 3; offset < pixels.length; offset += 4) {
      if (pixels[offset] !== 255) throw new Error(`Non-opaque icon pixel at ${Math.floor(offset / 4)}`);
    }
  });

  it.each(ICON_ASSETS)('contains a genuine $size × $size PNG in $file', async ({ file, size }) => {
    const bytes = await readFile(new URL(file, ICON_DIRECTORY));
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
    expect(bytes.length).toBeGreaterThan(100);
  });

  it('includes all requested standard, maskable, Apple and favicon sizes', () => {
    expect(ICON_ASSETS.map(({ file, size }) => [file, size])).toEqual([
      ['favicon-16.png', 16], ['favicon-32.png', 32], ['apple-touch-icon-180.png', 180],
      ['pwa-192.png', 192], ['pwa-512.png', 512], ['pwa-maskable-512.png', 512], ['screw-fall-1024.png', 1024],
    ]);
  });

  it('ships the master as its SVG favicon and reproducible PNG outputs within the icon budget', async () => {
    expect(await readFile(new URL('favicon.svg', ICON_DIRECTORY), 'utf8')).toBe(source);
    const generated = await generatePwaAssets({ check: true });
    expect(generated).toHaveLength(8);
    expect(generated.reduce((sum, entry) => sum + entry.bytes, 0)).toBeLessThan(768 * 1024);
  });
});
