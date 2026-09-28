// On-device text recognition for label photos (Tesseract, bundled in vendor/tesseract/). Nothing leaves the
// phone. The ~11 MB engine is fetched only the first time a photo is read, then cached by the service worker.
const VENDOR = './vendor/tesseract/';
const MAX_SIDE = 2000;

function vendorUrl(documentRef, file = '') {
  return new URL(`${VENDOR}${file}`, documentRef.baseURI).href;
}

function loadScript(documentRef, src) {
  return new Promise((resolve, reject) => {
    const script = documentRef.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Text recognition could not be loaded.'));
    documentRef.head.append(script);
  });
}

// Large phone photos are scaled down (text recognition gets slow and no more accurate above ~2000 px).
async function prepare(image, documentRef) {
  if (typeof createImageBitmap !== 'function') return image;
  const bitmap = await createImageBitmap(image);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = documentRef.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

export function createTextRecognizer({ documentRef = globalThis.document } = {}) {
  let loading = null;

  return async function recognizeText(image, { signal } = {}) {
    if (!image || !documentRef?.createElement) return '';
    loading ??= loadScript(documentRef, vendorUrl(documentRef, 'tesseract.min.js')).catch(error => {
      loading = null;
      throw error;
    });
    await loading;
    const source = await prepare(image, documentRef);
    const worker = await globalThis.Tesseract.createWorker('eng', 1, {
      workerPath: vendorUrl(documentRef, 'worker.min.js'),
      corePath: vendorUrl(documentRef),
      langPath: vendorUrl(documentRef)
    });
    const stop = () => worker.terminate();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      const { data } = await worker.recognize(source);
      return data?.text ?? '';
    } finally {
      signal?.removeEventListener('abort', stop);
      await worker.terminate().catch(() => {});
    }
  };
}
