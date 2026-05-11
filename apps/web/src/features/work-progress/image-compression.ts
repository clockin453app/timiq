/**
 * Client-side resize/compress for site progress uploads.
 * Backend Pillow pass remains authoritative for security and final optimisation.
 */

const CLIENT_MAX_LONG_EDGE = 1600;
/** 0.78–0.82 range per product note */
const CLIENT_JPEG_QUALITY_PRIMARY = 0.8;
const CLIENT_JPEG_QUALITY_FALLBACK = 0.78;

export type PreparedSiteProgressUpload = {
  /** Original filename for display / server metadata */
  displayName: string;
  /** The file the user picked (for retry staging if upload fails) */
  originalFile: File;
  /** File sent to the API (JPEG, .jpg name when compressed) */
  uploadFile: File;
  originalBytes: number;
  uploadBytes: number;
  /** False when original was uploaded under safe size (compression failed) */
  usedClientCompression: boolean;
};

function stemFilename(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

function jpgUploadName(originalName: string): string {
  return `${stemFilename(originalName || "photo")}.jpg`;
}

function detectMagicImageKind(buf: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    if (buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
      return "webp";
    }
  }
  return null;
}

export function isSupportedSiteProgressMime(file: File): boolean {
  const t = file.type.toLowerCase();
  return t === "image/jpeg" || t === "image/png" || t === "image/webp";
}

export async function validateSiteProgressImageFile(file: File): Promise<void> {
  if (!isSupportedSiteProgressMime(file)) {
    throw new Error("Only JPEG, PNG, or WebP images are allowed.");
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const magic = detectMagicImageKind(head);
  if (magic == null) {
    throw new Error("File does not look like a valid JPEG, PNG, or WebP image.");
  }
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
}

async function encodeCanvasToJpegUnderLimit(
  canvas: HTMLCanvasElement,
  maxBytes: number,
): Promise<Blob> {
  let blob = await canvasToJpegBlob(canvas, CLIENT_JPEG_QUALITY_PRIMARY);
  if (blob && blob.size <= maxBytes) {
    return blob;
  }
  blob = await canvasToJpegBlob(canvas, CLIENT_JPEG_QUALITY_FALLBACK);
  if (blob && blob.size <= maxBytes) {
    return blob;
  }
  if (blob) {
    throw new Error("Compressed image is still too large. Try a smaller or simpler photo.");
  }
  throw new Error("Could not encode image as JPEG in this browser.");
}

async function drawSourceToJpegBlob(
  source: CanvasImageSource,
  width: number,
  height: number,
  maxUploadBytes: number,
): Promise<Blob> {
  const longest = Math.max(width, height);
  const scale = longest > CLIENT_MAX_LONG_EDGE ? CLIENT_MAX_LONG_EDGE / longest : 1;
  const nw = Math.max(1, Math.round(width * scale));
  const nh = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    throw new Error("Could not prepare image (canvas unsupported).");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, nw, nh);
  ctx.drawImage(source, 0, 0, nw, nh);

  return encodeCanvasToJpegUnderLimit(canvas, maxUploadBytes);
}

async function loadWithCreateImageBitmap(file: File): Promise<ImageBitmap | null> {
  try {
    if (typeof createImageBitmap !== "function") {
      return null;
    }
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

async function loadWithHtmlImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    const done = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not decode image."));
    });
    img.src = url;
    await done;
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Resize longest edge to ~1600px, JPEG ~0.8, white background (transparency flattened).
 * On failure: use original file only if size <= maxOriginalBytes; otherwise throw.
 */
export async function prepareSiteProgressPhotoUpload(
  file: File,
  maxOriginalBytes: number,
  options?: { onStatus?: (message: string) => void; signal?: AbortSignal },
): Promise<PreparedSiteProgressUpload> {
  const onStatus = options?.onStatus;
  const signal = options?.signal;
  const throwIfAborted = () => {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
  };

  await validateSiteProgressImageFile(file);
  throwIfAborted();

  const originalBytes = file.size;
  const displayName = file.name || "photo";

  onStatus?.(`Compressing ${displayName}…`);

  let disposable: ImageBitmap | null = null;
  try {
    let source: CanvasImageSource;
    let sw: number;
    let sh: number;

    const bmp = await loadWithCreateImageBitmap(file);
    throwIfAborted();
    if (bmp) {
      disposable = bmp;
      source = bmp;
      sw = bmp.width;
      sh = bmp.height;
    } else {
      const img = await loadWithHtmlImage(file);
      throwIfAborted();
      source = img;
      sw = img.naturalWidth || img.width;
      sh = img.naturalHeight || img.height;
    }

    const blob = await drawSourceToJpegBlob(source, sw, sh, maxOriginalBytes);
    throwIfAborted();
    const uploadFile = new File([blob], jpgUploadName(displayName), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    return {
      displayName,
      originalFile: file,
      uploadFile,
      originalBytes,
      uploadBytes: blob.size,
      usedClientCompression: true,
    };
  } catch (err) {
    if (originalBytes <= maxOriginalBytes) {
      onStatus?.(`${displayName}: using original (compression unavailable in browser).`);
      return {
        displayName,
        originalFile: file,
        uploadFile: file,
        originalBytes,
        uploadBytes: originalBytes,
        usedClientCompression: false,
      };
    }
    const msg =
      err instanceof Error
        ? err.message
        : "Could not compress image in this browser. Try a smaller file or another photo.";
    throw new Error(
      `${msg} This file is over the ${Math.round(maxOriginalBytes / (1024 * 1024))} MB limit, so the original cannot be uploaded without compression.`,
    );
  } finally {
    disposable?.close();
  }
}

const DEFAULT_UPLOAD_CONCURRENCY = 3;

/**
 * Run async tasks with limited concurrency; preserves result order by index.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));

  const runners = Array.from({ length: items.length ? limit : 0 }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) {
        break;
      }
      results[i] = await worker(items[i]!, i);
    }
  });

  await Promise.all(runners);
  return results;
}

export const SITE_PROGRESS_UPLOAD_CONCURRENCY = DEFAULT_UPLOAD_CONCURRENCY;
