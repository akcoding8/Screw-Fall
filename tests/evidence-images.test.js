import { describe, expect, it, vi } from 'vitest';
import { detectEvidenceImageType, EVIDENCE_IMAGE_LIMITS, fitEvidenceDimensions, processEvidenceImage, readEvidenceDimensions } from '../src/game/EvidenceImageProcessor.js';

function png(width = 3, height = 2) {
  const bytes = new Uint8Array(36);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
function imageEnvironment({ width = 3024, height = 4032, formats = ['image/webp', 'image/jpeg', 'image/png'], size = 1000 } = {}) {
  const canvases = [], bitmap = { width, height, close: vi.fn() }, draws = [];
  const canvasFactory = () => {
    const canvas = { width: 0, height: 0 };
    canvas.getContext = () => ({ drawImage: (...args) => draws.push({ args, width: canvas.width, height: canvas.height }) });
    canvas.toBlob = vi.fn((callback, type, quality) => {
      const actualType = formats.includes(type) ? type : 'image/png';
      callback(new Blob([new Uint8Array(size)], { type: actualType }));
    });
    canvases.push(canvas); return canvas;
  };
  return { options: { createImageBitmap: vi.fn(async () => bitmap), canvasFactory }, canvases, bitmap, draws };
}

describe('local screenshot processing', () => {
  it.each([
    [png(), 'image/png'], [new Uint8Array([255, 216, 255, 224]), 'image/jpeg'],
    [new TextEncoder().encode('RIFF1234WEBP'), 'image/webp'],
  ])('accepts common screenshot signatures, independent of the filename and MIME label', async (bytes, type) => {
    expect(detectEvidenceImageType(bytes)).toBe(type);
    const env = imageEnvironment({ width: 3, height: 2 });
    const file = new Blob([bytes], { type: 'text/plain' });
    const result = await processEvidenceImage(file, env.options);
    expect(env.options.createImageBitmap).toHaveBeenCalledOnce();
    expect(env.options.createImageBitmap.mock.calls[0][0].type).toBe(type);
    expect(result.blob).toBeInstanceOf(Blob); expect(result.thumbnail).toBeInstanceOf(Blob);
    expect(result.width).toBe(3); expect(result.height).toBe(2);
  });
  it('rejects unsupported bytes even when labelled PNG', async () => {
    const env = imageEnvironment();
    await expect(processEvidenceImage(new Blob(['<svg></svg>'], { type: 'image/png' }), env.options)).rejects.toMatchObject({ code: 'image-type' });
    expect(env.options.createImageBitmap).not.toHaveBeenCalled();
  });
  it('rejects corrupt content after signature checking, without leaking a URL', async () => {
    const createImageBitmap = vi.fn(async () => { throw new Error('Decode failed'); });
    const urls = { createObjectURL: vi.fn(() => 'blob:broken'), revokeObjectURL: vi.fn() };
    class BrokenImage { set src(value) { if (value) queueMicrotask(() => this.onerror?.()); } }
    await expect(processEvidenceImage(new Blob([png()]), { createImageBitmap, Image: BrokenImage, URL: urls })).rejects.toMatchObject({ code: 'image-decode' });
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:broken');
  });
  it('rejects files above 20 MiB before reading or decoding', async () => {
    const file = { size: EVIDENCE_IMAGE_LIMITS.inputBytes + 1, arrayBuffer: vi.fn() };
    await expect(processEvidenceImage(file)).rejects.toThrow('smaller than 20 MB');
    expect(file.arrayBuffer).not.toHaveBeenCalled();
  });
  it('rejects extreme source dimensions before decoding', async () => {
    const env = imageEnvironment();
    await expect(processEvidenceImage(new Blob([png(100000, 10)]), env.options)).rejects.toMatchObject({ code: 'image-dimensions' });
    expect(env.options.createImageBitmap).not.toHaveBeenCalled();
    expect(() => fitEvidenceDimensions(9000, 9000)).toThrow('too large');
  });
  it('caps the image and thumbnail without distortion, decodes only once and releases buffers', async () => {
    const env = imageEnvironment();
    const result = await processEvidenceImage(new Blob([png(3024, 4032)]), env.options);
    expect(result).toMatchObject({ width: 1920, height: 2560, thumbnailWidth: 240, thumbnailHeight: 320, mimeType: 'image/webp' });
    expect(env.draws.map(draw => [draw.width, draw.height])).toEqual([[1920, 2560], [240, 320]]);
    expect(env.draws[1].args[0]).toBe(env.canvases[0]);
    expect(env.bitmap.close).toHaveBeenCalledOnce(); expect(env.options.createImageBitmap).toHaveBeenCalledOnce();
    expect(env.canvases.every(canvas => canvas.width === 1 && canvas.height === 1)).toBe(true);
    expect(env.canvases[0].toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.92);
  });
  it('does not upscale small screenshots and keeps an efficient PNG lossless', async () => {
    const env = imageEnvironment({ width: 3, height: 2, size: 24 });
    const result = await processEvidenceImage(new Blob([png()]), env.options);
    expect(result).toMatchObject({ width: 3, height: 2, thumbnailWidth: 3, thumbnailHeight: 2, mimeType: 'image/png' });
    expect(env.canvases[0].toBlob).toHaveBeenCalledTimes(1);
    expect(env.draws[0].args[0]).toBe(env.bitmap); // Canvas redraw, never original metadata-bearing bytes.
  });
  it('falls back to the image element when ImageBitmap is absent and revokes its URL', async () => {
    const env = imageEnvironment({ width: 200, height: 400 });
    const urls = { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() };
    class GoodImage {
      constructor() { this.naturalWidth = 200; this.naturalHeight = 400; }
      set src(value) { if (value) queueMicrotask(() => this.onload?.()); }
    }
    const result = await processEvidenceImage(new Blob([png(200, 400)]), { ...env.options, createImageBitmap: undefined, Image: GoodImage, URL: urls });
    expect(result.width).toBe(200); expect(result.thumbnailHeight).toBe(320);
    expect(urls.revokeObjectURL).toHaveBeenCalledOnce(); expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
  it('uses JPEG when WebP encoding is unsupported, preserving PNG fallback for PNG sources', async () => {
    const env = imageEnvironment({ width: 3, height: 2, formats: ['image/jpeg', 'image/png'] });
    const jpeg = new Blob([new Uint8Array([255, 216, 255, 224])]);
    const result = await processEvidenceImage(jpeg, env.options);
    expect(result.mimeType).toBe('image/jpeg');
    const pngResult = await processEvidenceImage(new Blob([png()]), env.options);
    expect(pngResult.mimeType).toBe('image/png');
  });
  it('preserves possible WebP transparency when only PNG/JPEG encoding is available', async () => {
    const env = imageEnvironment({ width: 3, height: 2, formats: ['image/jpeg', 'image/png'] });
    const webp = new Blob([new TextEncoder().encode('RIFF1234WEBP')]);
    expect((await processEvidenceImage(webp, env.options)).mimeType).toBe('image/png');
  });
  it('cleans decoded resources when canvas is unavailable', async () => {
    const env = imageEnvironment();
    await expect(processEvidenceImage(new Blob([png()]), { ...env.options, canvasFactory: () => null })).rejects.toMatchObject({ code: 'image-canvas' });
    expect(env.bitmap.close).toHaveBeenCalledOnce();
  });
  it('cancels an old selection without keeping the decoded bitmap', async () => {
    const signal = new AbortController(), bitmap = { width: 20, height: 30, close: vi.fn() };
    let resolve;
    const decoding = vi.fn(() => new Promise(done => { resolve = done; }));
    const result = processEvidenceImage(new Blob([png(20, 30)]), { createImageBitmap: decoding, signal: signal.signal });
    await vi.waitFor(() => expect(decoding).toHaveBeenCalledOnce());
    signal.abort(); resolve(bitmap);
    await expect(result).rejects.toMatchObject({ code: 'cancelled' });
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it('reads JPEG and WebP dimensions without a decoder', () => {
    const jpeg = new Uint8Array([255,216,255,192,0,17,8,2,88,3,32,3,1,0,2,0,3,0,0,0,0]);
    expect(readEvidenceDimensions(jpeg, 'image/jpeg')).toEqual({ width: 800, height: 600 });
    const webp = new Uint8Array(30); webp.set(new TextEncoder().encode('RIFF1234WEBPVP8X')); webp[24] = 255; webp[25] = 9; webp[27] = 239; webp[28] = 4;
    expect(readEvidenceDimensions(webp, 'image/webp')).toEqual({ width: 2560, height: 1264 });
  });
});
