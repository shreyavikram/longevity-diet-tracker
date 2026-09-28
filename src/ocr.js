// On-device text recognition for label photos (Tesseract, bundled in vendor/tesseract/). Nothing leaves the
// phone. The ~7 MB engine is fetched only the first time, then cached by the service worker. The engine is
// started as soon as a photo is picked and kept warm for a few minutes, so reading a label takes seconds.
const VENDOR = './vendor/tesseract/';
const MAX_SIDE = 2000;
const IDLE_MS = 3 * 60 * 1000;

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
// Small images are left as they are: upscaling them made recognition worse in testing.
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
  let workerPromise = null;
  let idleTimer = null;

  function shutDown() {
    const pending = workerPromise;
    workerPromise = null;
    pending?.then(worker => worker.terminate()).catch(() => {});
  }

  function worker() {
    clearTimeout(idleTimer);
    workerPromise ??= loadScript(documentRef, vendorUrl(documentRef, 'tesseract.min.js'))
      .then(async () => {
        const created = await globalThis.Tesseract.createWorker('eng', 1, {
          workerPath: vendorUrl(documentRef, 'worker.min.js'),
          corePath: vendorUrl(documentRef),
          langPath: vendorUrl(documentRef)
        });
        // Read row by row (mode 4). The default layout analysis splits website nutrition tables into a column of
        // names and a separate column of numbers, which loses which number belongs to which nutrient.
        await created.setParameters({ tessedit_pageseg_mode: '4' });
        return created;
      })
      .catch(error => {
        workerPromise = null;
        throw error;
      });
    return workerPromise;
  }

  async function recognizeText(image, { signal } = {}) {
    if (!image || !documentRef?.createElement) return '';
    const [ready, source] = await Promise.all([worker(), prepare(image, documentRef)]);
    const stop = () => shutDown();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      const { data } = await ready.recognize(source);
      return data?.text ?? '';
    } finally {
      signal?.removeEventListener('abort', stop);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(shutDown, IDLE_MS);
    }
  }

  // Starts the engine in the background (called when a photo is picked) so it is ready by the time it is needed.
  recognizeText.warm = () => {
    if (!documentRef?.createElement) return;
    worker().then(() => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(shutDown, IDLE_MS);
    }).catch(() => {});
  };
  return recognizeText;
}
