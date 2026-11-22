import type { PhotoKind } from '../types/billing';

export interface OcrParseResult {
  amount?: number | null;
  usage?: number | null;
  billingYm?: string | null;
  billPrevReading?: number | null;
  billCurrReading?: number | null;
  meterValue?: number | null;
  alternateValue?: number | null;
  rawDigits?: string | null;
  rotationDegrees?: number | null;
  uprightRotateCw: 0 | 90 | 180 | 270;
  counterBox?: [number, number, number, number] | null;
  confidence?: 'high' | 'medium' | 'low';
  note?: string;
  rawText: string;
}

export interface AlignedPhotoPreviews {
  uprightUrl: string;
  focusedUrl: string | null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('사진 파일을 열지 못했습니다.'));
    img.src = src;
  });
}

function canvasToObjectUrl(
  canvas: HTMLCanvasElement,
  quality = 0.9
): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('이미지 변환에 실패했습니다.'));
          return;
        }
        resolve(URL.createObjectURL(blob));
      },
      'image/jpeg',
      quality
    );
  });
}

function renderRotatedCanvas(
  img: HTMLImageElement,
  rotateCw: 0 | 90 | 180 | 270,
  maxDim = 1600
): HTMLCanvasElement {
  let srcW = img.naturalWidth || img.width;
  let srcH = img.naturalHeight || img.height;
  if (Math.max(srcW, srcH) > maxDim) {
    const scale = maxDim / Math.max(srcW, srcH);
    srcW = Math.round(srcW * scale);
    srcH = Math.round(srcH * scale);
  }

  const swapAxes = rotateCw === 90 || rotateCw === 270;
  const outW = swapAxes ? srcH : srcW;
  const outH = swapAxes ? srcW : srcH;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('이미지 처리 화면을 준비하지 못했습니다.');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, outW, outH);
  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((rotateCw * Math.PI) / 180);
  ctx.drawImage(img, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx.restore();

  return canvas;
}

function mapNormalizedPointAfterRotateCw(
  x: number,
  y: number,
  rotateCw: 0 | 90 | 180 | 270
): [number, number] {
  if (rotateCw === 90) return [1 - y, x];
  if (rotateCw === 180) return [1 - x, 1 - y];
  if (rotateCw === 270) return [y, 1 - x];
  return [x, y];
}

/**
 * Automatically rotates the photo upright using `uprightRotateCw` and produces:
 * - `uprightUrl`: full upright photo (for Step 1 & Zoom Modal)
 * - `focusedUrl`: upright zoomed-in crop centered on the meter digits / bill table (for Step 2 comparison)
 */
export async function createAlignedPhotoPreviews(
  sourceUrl: string,
  uprightRotateCw: 0 | 90 | 180 | 270,
  counterBox: [number, number, number, number] | null | undefined,
  kind: PhotoKind
): Promise<AlignedPhotoPreviews> {
  const img = await loadImage(sourceUrl);
  const rotatedCanvas = renderRotatedCanvas(img, uprightRotateCw, 1600);
  const uprightUrl = await canvasToObjectUrl(rotatedCanvas, 0.9);

  if (!counterBox) {
    return { uprightUrl, focusedUrl: null };
  }

  const [ymin, xmin, ymax, xmax] = counterBox;
  const [x1, y1] = mapNormalizedPointAfterRotateCw(
    xmin / 1000,
    ymin / 1000,
    uprightRotateCw
  );
  const [x2, y2] = mapNormalizedPointAfterRotateCw(
    xmax / 1000,
    ymax / 1000,
    uprightRotateCw
  );

  let uMinX = Math.min(x1, x2);
  let uMaxX = Math.max(x1, x2);
  let uMinY = Math.min(y1, y2);
  let uMaxY = Math.max(y1, y2);

  const boxW = uMaxX - uMinX;
  const boxH = uMaxY - uMinY;
  if (boxW < 0.04 || boxH < 0.03) {
    return { uprightUrl, focusedUrl: null };
  }

  // Add generous breathing room so every digit + Korean label stays completely visible
  const padX = Math.max(kind === 'bill' ? 0.05 : 0.06, boxW * (kind === 'bill' ? 0.12 : 0.28));
  const padY = Math.max(kind === 'bill' ? 0.05 : 0.06, boxH * (kind === 'bill' ? 0.16 : 0.45));

  uMinX = Math.max(0, uMinX - padX);
  uMaxX = Math.min(1, uMaxX + padX);
  uMinY = Math.max(0, uMinY - padY);
  uMaxY = Math.min(1, uMaxY + padY);

  const cropX = Math.round(uMinX * rotatedCanvas.width);
  const cropY = Math.round(uMinY * rotatedCanvas.height);
  const cropW = Math.max(40, Math.round((uMaxX - uMinX) * rotatedCanvas.width));
  const cropH = Math.max(40, Math.round((uMaxY - uMinY) * rotatedCanvas.height));

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const cropCtx = cropCanvas.getContext('2d');
  if (!cropCtx) {
    return { uprightUrl, focusedUrl: null };
  }

  cropCtx.drawImage(
    rotatedCanvas,
    cropX,
    cropY,
    cropW,
    cropH,
    0,
    0,
    cropW,
    cropH
  );

  const focusedUrl = await canvasToObjectUrl(cropCanvas, 0.92);
  return { uprightUrl, focusedUrl };
}

/**
 * Manually rotates an existing preview image 90° clockwise (1-tap fallback helper).
 */
export async function rotatePhotoUrlCw90(sourceUrl: string): Promise<string> {
  const img = await loadImage(sourceUrl);
  const rotatedCanvas = renderRotatedCanvas(img, 90, 1600);
  return canvasToObjectUrl(rotatedCanvas, 0.9);
}

/**
 * Resizes and compresses a smartphone photo in full color (JPEG) so the server-side
 * vision model can clearly distinguish white-on-black meter rollers from red sub-dials
 * while keeping mobile upload payload fast (~150-400KB).
 */
export function prepareColorPhotoForOcr(
  file: File
): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 1600;
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (Math.max(w, h) > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('이미지 처리 화면을 준비하지 못했습니다.'));
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        URL.revokeObjectURL(objectUrl);

        const commaIdx = dataUrl.indexOf(',');
        const base64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
        resolve({ base64, mimeType: 'image/jpeg' });
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('사진 파일을 열지 못했습니다. 다시 찍어주세요.'));
    };
    img.src = objectUrl;
  });
}

function normalizeRotateCw(val: unknown): 0 | 90 | 180 | 270 {
  if (val === 90 || val === 180 || val === 270) return val;
  return 0;
}

function parseCounterBox(val: unknown): [number, number, number, number] | null {
  if (!Array.isArray(val) || val.length !== 4) return null;
  const nums = val.map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0], nums[1], nums[2], nums[3]];
}

export async function runPhotoOcr(
  file: File,
  kind: PhotoKind,
  prevRef: number,
  onProgress?: (pct: number) => void
): Promise<OcrParseResult> {
  onProgress?.(15);
  const { base64, mimeType } = await prepareColorPhotoForOcr(file);
  onProgress?.(38);

  let currentPct = 38;
  const timer = window.setInterval(() => {
    currentPct = Math.min(90, currentPct + 8);
    onProgress?.(currentPct);
  }, 450);

  try {
    const response = await fetch('/api/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind,
        imageBase64: base64,
        mimeType,
        prevRef: prevRef > 0 ? prevRef : undefined,
      }),
    });

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const payload = isJson ? await response.json() : null;

    if (!response.ok) {
      const serverMsg =
        payload && typeof payload.error === 'string' && payload.error.trim()
          ? payload.error.trim()
          : `사진 분석 서버 오류 (${response.status})`;
      throw new Error(serverMsg);
    }

    onProgress?.(100);

    if (!payload || typeof payload !== 'object') {
      throw new Error('사진 분석 결과를 받지 못했습니다.');
    }

    const uprightRotateCw = normalizeRotateCw(payload.uprightRotateCw);

    return {
      amount: typeof payload.amount === 'number' ? payload.amount : null,
      usage: typeof payload.usage === 'number' ? payload.usage : null,
      billingYm: typeof payload.billingYm === 'string' ? payload.billingYm : null,
      billPrevReading:
        typeof payload.billPrevReading === 'number'
          ? payload.billPrevReading
          : null,
      billCurrReading:
        typeof payload.billCurrReading === 'number'
          ? payload.billCurrReading
          : null,
      meterValue:
        typeof payload.meterValue === 'number' ? payload.meterValue : null,
      alternateValue:
        typeof payload.alternateValue === 'number'
          ? payload.alternateValue
          : null,
      rawDigits: typeof payload.rawDigits === 'string' ? payload.rawDigits : null,
      rotationDegrees:
        typeof payload.rotationDegrees === 'number'
          ? payload.rotationDegrees
          : uprightRotateCw,
      uprightRotateCw,
      counterBox: parseCounterBox(payload.counterBox),
      confidence: payload.confidence,
      note: typeof payload.note === 'string' ? payload.note : '',
      rawText:
        typeof payload.rawDigits === 'string'
          ? payload.rawDigits
          : typeof payload.note === 'string'
            ? payload.note
            : '',
    };
  } finally {
    window.clearInterval(timer);
  }
}
