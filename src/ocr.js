// On-device text recognition for label photos (Tesseract, bundled in vendor/tesseract/). Nothing leaves the
// phone. The ~7 MB engine is fetched only the first time, then cached by the service worker. The engine is
// started as soon as a photo is picked and kept warm for a few minutes, so reading a label takes seconds.
const VENDOR = './vendor/tesseract/';
const MAX_SIDE = 2000;
const DETECTION_SIDE = 800;
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

function longestDarkRun(data, width, height, x) {
  let bestStart = 0;
  let bestLength = 0;
  let start = 0;
  let length = 0;
  const first = Math.round(height * 0.03);
  const last = Math.round(height * 0.97);
  for (let y = first; y < last; y += 1) {
    const offset = (y * width + x) * 4;
    const luminance = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
    if (luminance < 150) {
      if (!length) start = y;
      length += 1;
      if (length > bestLength) {
        bestStart = start;
        bestLength = length;
      }
    } else length = 0;
  }
  return { start: bestStart, end: bestStart + bestLength, length: bestLength };
}

// Most US Nutrition Facts panels have a tall dark border. Finding that border before recognition removes
// ingredients, instructions, and page chrome that otherwise split values away from their nutrient names.
function nutritionPanel(bitmap, documentRef) {
  const scale = Math.min(1, DETECTION_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = documentRef.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const lines = [];
  for (let x = 1; x < canvas.width - 1; x += 1) {
    const run = longestDarkRun(pixels, canvas.width, canvas.height, x);
    if (run.length < canvas.height * 0.35) continue;
    const previous = lines.at(-1);
    if (previous && x === previous.lastX + 1) {
      previous.lastX = x;
      if (run.length > previous.length) Object.assign(previous, run, { x });
    } else lines.push({ ...run, x, firstX: x, lastX: x });
  }
  let best = null;
  for (let leftIndex = 0; leftIndex < lines.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < lines.length; rightIndex += 1) {
      const left = lines[leftIndex];
      const right = lines[rightIndex];
      // A wide dark page margin can also form one uninterrupted run; it is not a border line.
      if (left.lastX - left.firstX > canvas.width * 0.02 || right.lastX - right.firstX > canvas.width * 0.02) continue;
      const top = Math.max(left.start, right.start);
      const bottom = Math.min(left.end, right.end);
      const height = bottom - top;
      const width = right.x - left.x;
      const aspect = width / height;
      if (height < canvas.height * 0.3 || width < canvas.width * 0.15 || aspect < 0.25 || aspect > 1.25) continue;
      const score = height * width;
      if (!best || score > best.score) best = { left: left.x, right: right.x, top, bottom, score };
    }
  }
  if (!best) return null;
  const padding = Math.max(2, Math.round((best.right - best.left) * 0.015));
  return {
    x: Math.max(0, best.left - padding) / scale,
    y: Math.max(0, best.top - padding) / scale,
    width: Math.min(canvas.width, best.right + padding) / scale - Math.max(0, best.left - padding) / scale,
    height: Math.min(canvas.height, best.bottom + padding) / scale - Math.max(0, best.top - padding) / scale
  };
}

// Large phone photos are scaled down (text recognition gets slow and no more accurate above ~2000 px).
// A detected label is enlarged after cropping because its fine-print decimals would otherwise be only a few pixels.
async function prepare(image, documentRef, { detectPanel = true } = {}) {
  if (typeof createImageBitmap !== 'function') return { source: image, cropped: false };
  const bitmap = await createImageBitmap(image);
  const panel = detectPanel ? nutritionPanel(bitmap, documentRef) : null;
  const source = panel ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  const scale = Math.min(panel ? 3 : 1, MAX_SIDE / Math.max(source.width, source.height));
  const canvas = documentRef.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext('2d').drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return { source: canvas, cropped: Boolean(panel) };
}

function completeLabelText(text) {
  if (!/nutrition\s+facts|supplement\s+facts|nutritional\s+information/i.test(text)) return false;
  const signals = [/serving\s+size/i, /calories\s*:?[\s\d]/i, /total\s+fat/i, /sodium/i,
    /carb(?:ohydrate|s?\b)/i, /protein/i, /vitamin|calcium|iron|potassium/i];
  return signals.filter(pattern => pattern.test(text)).length >= 4;
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
    const [ready, prepared] = await Promise.all([worker(), prepare(image, documentRef)]);
    const stop = () => shutDown();
    signal?.addEventListener('abort', stop, { once: true });
    try {
      const { data } = await ready.recognize(prepared.source);
      const text = data?.text ?? '';
      if (!prepared.cropped || completeLabelText(text)) return text;
      // Geometry can resemble a label border. A partial crop is retried as a whole image so useful text is
      // never silently discarded; the crop remains appended as a secondary source for any fine print it read.
      const full = await prepare(image, documentRef, { detectPanel: false });
      const { data: fullData } = await ready.recognize(full.source);
      return `${fullData?.text ?? ''}\n${text}`;
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
