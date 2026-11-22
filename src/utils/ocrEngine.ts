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
  confidence?: 'high' | 'medium' | 'low';
  note?: string;
  rawText: string;
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
          : null,
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
