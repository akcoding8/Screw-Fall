/** Screenshot processing runs only after a file selection, never in a frame loop. */
export const EVIDENCE_IMAGE_LIMITS = Object.freeze({
  inputBytes: 20 * 1024 * 1024,
  decodedPixels: 48 * 1024 * 1024,
  decodedLongEdge: 16384,
  longEdge: 2560,
  thumbnailEdge: 320,
  quality: 0.92,
});

export class EvidenceImageError extends Error {
  constructor(message, code = 'image-unavailable') { super(message); this.name = 'EvidenceImageError'; this.code = code; }
}

export function fitEvidenceDimensions(width, height, longEdge = EVIDENCE_IMAGE_LIMITS.longEdge) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > EVIDENCE_IMAGE_LIMITS.decodedLongEdge || height > EVIDENCE_IMAGE_LIMITS.decodedLongEdge
    || width * height > EVIDENCE_IMAGE_LIMITS.decodedPixels) {
    throw new EvidenceImageError('This image is too large to process. Choose a smaller screenshot.', 'image-dimensions');
  }
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** File extensions and MIME labels are advisory; the bytes and decoder decide. */
export function detectEvidenceImageType(bytes) {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

// Read dimensions before decoding when the format provides them. This prevents
// a tiny compressed file from asking the decoder for an enormous pixel buffer.
export function readEvidenceDimensions(bytes, type) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'image/png' && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (type === 'image/jpeg') {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) return null;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {
        return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += length;
    }
  }
  if (type === 'image/webp' && bytes.length >= 30) {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8X') return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
    if (chunk === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      return { width: view.getUint16(26, true) & 16383, height: view.getUint16(28, true) & 16383 };
    }
    if (chunk === 'VP8L' && bytes[20] === 47) return {
      width: 1 + bytes[21] + ((bytes[22] & 63) << 8),
      height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10),
    };
  }
  return null;
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new EvidenceImageError('Screenshot selection cancelled.', 'cancelled');
}

async function decodeImage(blob, environment, signal) {
  if (typeof environment.createImageBitmap === 'function') {
    try {
      const bitmap = await environment.createImageBitmap(blob);
      if (signal?.aborted) { bitmap.close?.(); abortIfNeeded(signal); }
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
    } catch (error) {
      if (error instanceof EvidenceImageError) throw error;
      // Some Safari versions cannot decode a format via ImageBitmap but can
      // decode the same image with the normal image element.
    }
  }
  if (!environment.Image || !environment.URL?.createObjectURL) {
    throw new EvidenceImageError('This browser could not read the screenshot. Try PNG or JPEG.', 'image-decode');
  }
  let url;
  try {
    url = environment.URL.createObjectURL(blob);
    const image = new environment.Image();
    await new Promise((resolve, reject) => {
      const finish = callback => {
        image.onload = null; image.onerror = null; signal?.removeEventListener('abort', cancelled); callback();
      };
      const cancelled = () => finish(() => reject(new EvidenceImageError('Screenshot selection cancelled.', 'cancelled')));
      image.onload = () => finish(resolve);
      image.onerror = () => finish(() => reject(new EvidenceImageError('This file could not be read as a screenshot. Try PNG, JPEG or WebP.', 'image-decode')));
      signal?.addEventListener('abort', cancelled, { once: true });
      image.src = url;
      if (signal?.aborted) cancelled();
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, release: () => { image.src = ''; } };
  } finally { if (url) environment.URL.revokeObjectURL(url); }
}

function makeCanvas(environment, width, height) {
  const canvas = environment.canvasFactory ? environment.canvasFactory() : environment.document?.createElement('canvas');
  if (!canvas) throw new EvidenceImageError('This browser cannot prepare screenshots. You can continue without one.', 'image-canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    canvas.width = 1; canvas.height = 1;
    throw new EvidenceImageError('This browser cannot prepare screenshots. You can continue without one.', 'image-canvas');
  }
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

async function encodeCanvas(canvas, mimeType, quality) {
  try {
    if (typeof canvas.convertToBlob === 'function') return await canvas.convertToBlob({ type: mimeType, quality });
    if (typeof canvas.toBlob === 'function') return await new Promise(resolve => canvas.toBlob(resolve, mimeType, quality));
  } catch { /* The next format is the fallback. */ }
  return null;
}

async function encodedImage(canvas, sourceType, sourceBytes) {
  // Canvas always strips source metadata. PNG stays lossless when it is already
  // efficient, and preserves transparent screenshots if WebP is unavailable.
  const png = sourceType === 'image/png' ? await encodeCanvas(canvas, 'image/png') : null;
  if (png?.type === 'image/png' && png.size > 0 && png.size <= 2 * 1024 * 1024 && png.size <= sourceBytes * 1.25) return png;
  const webp = await encodeCanvas(canvas, 'image/webp', EVIDENCE_IMAGE_LIMITS.quality);
  if (webp?.type === 'image/webp' && webp.size > 0) return png && png.size < webp.size ? png : webp;
  if (png?.size > 0) return png;
  // A source WebP can contain transparency too; avoid flattening it into JPEG
  // when this browser can decode WebP but cannot encode it.
  if (sourceType === 'image/webp') {
    const transparentFallback = await encodeCanvas(canvas, 'image/png');
    if (transparentFallback?.type === 'image/png' && transparentFallback.size > 0) return transparentFallback;
  }
  const jpeg = await encodeCanvas(canvas, 'image/jpeg', EVIDENCE_IMAGE_LIMITS.quality);
  if (jpeg?.type === 'image/jpeg' && jpeg.size > 0) return jpeg;
  const fallback = await encodeCanvas(canvas, 'image/png');
  if (fallback?.type === 'image/png' && fallback.size > 0) return fallback;
  throw new EvidenceImageError('This browser could not prepare the screenshot. You can continue without one.', 'image-encode');
}

/** Decode once, redraw once at readable size, then make a thumbnail from that canvas. */
export async function processEvidenceImage(file, options = {}) {
  const environment = {
    document: globalThis.document, createImageBitmap: globalThis.createImageBitmap?.bind(globalThis),
    Image: globalThis.Image, URL: globalThis.URL, ...options,
  };
  const signal = options.signal;
  abortIfNeeded(signal);
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size < 1) {
    throw new EvidenceImageError('Choose a PNG, JPEG or WebP screenshot.', 'image-type');
  }
  if (file.size > EVIDENCE_IMAGE_LIMITS.inputBytes) {
    throw new EvidenceImageError('Choose a screenshot smaller than 20 MB.', 'image-size');
  }
  // The bounded source buffer is discarded after this call. No original bytes,
  // metadata or filename enter the save or evidence database.
  let bytes;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch { throw new EvidenceImageError('This screenshot could not be read. Please choose it again.', 'image-read'); }
  abortIfNeeded(signal);
  const sourceType = detectEvidenceImageType(bytes);
  if (!sourceType) throw new EvidenceImageError('Choose a PNG, JPEG or WebP screenshot. This file type is not supported.', 'image-type');
  const sourceDimensions = readEvidenceDimensions(bytes, sourceType);
  if (sourceDimensions) fitEvidenceDimensions(sourceDimensions.width, sourceDimensions.height);
  const typedBlob = new Blob([bytes], { type: sourceType });
  bytes = null;
  let decoded, main, thumb;
  try {
    decoded = await decodeImage(typedBlob, environment, signal);
    abortIfNeeded(signal);
    const dimensions = fitEvidenceDimensions(decoded.width, decoded.height);
    main = makeCanvas(environment, dimensions.width, dimensions.height);
    main.context.drawImage(decoded.image, 0, 0, dimensions.width, dimensions.height);
    decoded.release(); decoded = null;
    const blob = await encodedImage(main.canvas, sourceType, file.size);
    abortIfNeeded(signal);
    const thumbnailDimensions = fitEvidenceDimensions(dimensions.width, dimensions.height, EVIDENCE_IMAGE_LIMITS.thumbnailEdge);
    thumb = makeCanvas(environment, thumbnailDimensions.width, thumbnailDimensions.height);
    thumb.context.drawImage(main.canvas, 0, 0, thumbnailDimensions.width, thumbnailDimensions.height);
    const thumbnail = await encodedImage(thumb.canvas, blob.type, blob.size);
    abortIfNeeded(signal);
    return { blob, thumbnail, ...dimensions, thumbnailWidth: thumbnailDimensions.width,
      thumbnailHeight: thumbnailDimensions.height, mimeType: blob.type, originalBytes: file.size };
  } catch (error) {
    if (error instanceof EvidenceImageError) throw error;
    throw new EvidenceImageError('This file could not be read as a screenshot. Try PNG, JPEG or WebP.', 'image-decode');
  } finally {
    decoded?.release();
    // Drop potentially large canvas backing buffers as soon as encoded blobs exist.
    if (main) { main.canvas.width = 1; main.canvas.height = 1; }
    if (thumb) { thumb.canvas.width = 1; thumb.canvas.height = 1; }
  }
}
