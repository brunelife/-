import Tesseract from 'tesseract.js';
import type { PhotoKind } from '../types/billing';

export interface OcrParseResult {
  amount?: number | null;
  usage?: number | null;
  meterValue?: number | null;
  rawText: string;
}

/**
 * Grayscale + contrast boost preprocessing for sharper meter and bill digit OCR.
 */
export function preprocessImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 1400;
        let w = img.width;
        let h = img.height;
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
          reject(new Error('Canvas context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const contrasted = Math.min(255, Math.max(0, (gray - 128) * 1.38 + 128));
          d[i] = d[i + 1] = d[i + 2] = contrasted;
        }
        ctx.putImageData(imgData, 0, 0);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };
    img.src = objectUrl;
  });
}

/**
 * Parses Korean water utility bill OCR output for billed amount (KRW) and water usage (m3).
 * Fixed regex quantifiers ({0,12}, {4,7}, {1,3}) compared to the original HTML prototype.
 */
export function parseBillText(text: string): { amount: number | null; usage: number | null } {
  const clean = text.replace(/,/g, '').replace(/\s+/g, ' ');
  let amount: number | null = null;
  let usage: number | null = null;

  const amtPatterns = [
    /(?:납기내\s*금액|납부하실\s*금액|합\s*계|당월\s*요금|청구\s*금액)[^\d]{0,16}(\d{4,7})/g,
    /(\d{4,7})\s*원/g,
  ];

  for (const pat of amtPatterns) {
    const matches = [...clean.matchAll(pat)];
    if (matches.length > 0) {
      const nums = matches
        .map((m) => Number(m[1]))
        .filter((n) => Number.isFinite(n) && n >= 5000 && n <= 2000000);
      if (nums.length > 0) {
        amount = nums[0];
        break;
      }
    }
  }

  const usagePatterns = [
    /사용량[^\d]{0,12}(\d{1,3}(?:\.\d)?)/,
    /(\d{1,3}(?:\.\d)?)\s*(?:㎥|m3|톤)/i,
  ];
  for (const pat of usagePatterns) {
    const m = clean.match(pat);
    if (m) {
      const val = Number(m[1]);
      if (Number.isFinite(val) && val > 0 && val <= 500) {
        usage = val;
        break;
      }
    }
  }

  return { amount, usage };
}

/**
 * Extracts the most plausible water meter reading near prevRef.
 * Fixed regex quantifier (\d{3,5}) compared to the original HTML prototype.
 */
export function parseMeterText(text: string, prevRef: number): number | null {
  const cleaned = text.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');
  const digits = cleaned.match(/\d{3,5}/g) || [];
  const candidates = digits
    .map((d) => Number(d))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 100000);

  if (candidates.length === 0) return null;

  if (prevRef > 0) {
    const plausible = candidates.filter((n) => n >= prevRef && n <= prevRef + 250);
    if (plausible.length > 0) {
      plausible.sort((a, b) => a - prevRef - (b - prevRef));
      return plausible[0];
    }
    const nearPrev = candidates.filter((n) => Math.abs(n - prevRef) <= 500);
    if (nearPrev.length > 0) {
      nearPrev.sort((a, b) => Math.abs(a - prevRef) - Math.abs(b - prevRef));
      return nearPrev[0];
    }
  }

  const fourDigit = candidates.filter((n) => n >= 100 && n <= 9999);
  return fourDigit.length > 0 ? fourDigit[0] : candidates[0];
}

export async function runPhotoOcr(
  file: File,
  kind: PhotoKind,
  prevRef: number,
  onProgress?: (pct: number) => void
): Promise<OcrParseResult> {
  const dataUrl = await preprocessImage(file);
  const lang = kind === 'bill' ? 'kor+eng' : 'eng';

  const result = await Tesseract.recognize(dataUrl, lang, {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(Math.round(m.progress * 100));
      }
    },
  });

  const rawText = result.data.text || '';

  if (kind === 'bill') {
    const parsed = parseBillText(rawText);
    return {
      amount: parsed.amount,
      usage: parsed.usage,
      rawText,
    };
  }

  const meterValue = parseMeterText(rawText, prevRef);
  return {
    meterValue,
    rawText,
  };
}
