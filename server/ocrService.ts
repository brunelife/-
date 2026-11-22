import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export type OcrPhotoKind = 'meter201' | 'meter202' | 'meterTot' | 'bill';

export interface OcrAnalyzeRequest {
  kind: OcrPhotoKind;
  imageBase64: string;
  mimeType: string;
  prevRef?: number;
}

export interface OcrAnalyzeResponse {
  kind: OcrPhotoKind;
  meterValue?: number | null;
  alternateValue?: number | null;
  rawDigits?: string | null;
  rotationDegrees?: number | null;
  amount?: number | null;
  usage?: number | null;
  billingYm?: string | null;
  billPrevReading?: number | null;
  billCurrReading?: number | null;
  confidence: 'high' | 'medium' | 'low';
  note: string;
}

export class OcrServiceError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'OcrServiceError';
    this.status = status;
    this.code = code;
  }
}

const VALID_KINDS = new Set<OcrPhotoKind>([
  'meter201',
  'meter202',
  'meterTot',
  'bill',
]);

const VALID_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const MAX_BASE64_CHARS = 16 * 1024 * 1024; // ~12MB decoded image
const PRIMARY_GEMINI_MODEL = 'gemini-4-hydrogen';
const FALLBACK_GEMINI_MODEL = 'gemini-3.1-flash-lite';

let cachedClient: GoogleGenAI | null = null;
let cachedApiKey: string | undefined;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new OcrServiceError(
      500,
      'MISSING_API_KEY',
      '서버에 사진 인식 API 키(GEMINI_API_KEY)가 설정되지 않았습니다. 환경변수를 확인해 주세요.'
    );
  }
  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedApiKey = apiKey;
  }
  return cachedClient;
}

function normalizeMimeType(mimeType: string): string {
  const clean = mimeType.toLowerCase().split(';')[0].trim();
  if (clean === 'image/jpg') return 'image/jpeg';
  return clean;
}

function stripDataUrlPrefix(base64OrDataUrl: string): string {
  const commaIdx = base64OrDataUrl.indexOf(',');
  if (base64OrDataUrl.startsWith('data:') && commaIdx !== -1) {
    return base64OrDataUrl.slice(commaIdx + 1).trim();
  }
  return base64OrDataUrl.trim();
}

function getErrorStatus(err: unknown): number | null {
  if (typeof err === 'object' && err !== null) {
    if ('status' in err && typeof (err as { status: unknown }).status === 'number') {
      return (err as { status: number }).status;
    }
    if ('code' in err && typeof (err as { code: unknown }).code === 'number') {
      return (err as { code: number }).code;
    }
  }
  return null;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function classifyGeminiError(err: unknown): OcrServiceError {
  if (err instanceof OcrServiceError) return err;

  const status = getErrorStatus(err);
  const rawMsg = getErrorMessage(err);
  const upper = rawMsg.toUpperCase();

  if (
    status === 403 ||
    upper.includes('PERMISSION_DENIED') ||
    upper.includes('API_KEY_INVALID') ||
    (status === 400 && upper.includes('API KEY'))
  ) {
    return new OcrServiceError(
      status === 400 ? 400 : 403,
      'API_KEY_ERROR',
      '사진 인식 서비스 인증에 실패했습니다. Settings > Secrets(또는 서버 환경변수)의 API 키를 확인해 주세요.'
    );
  }

  if (status === 429 || upper.includes('RESOURCE_EXHAUSTED')) {
    return new OcrServiceError(
      429,
      'RATE_LIMITED',
      '잠시 사진 인식 요청이 많습니다. 몇 초 뒤 다시 찍기 버튼을 눌러주세요.'
    );
  }

  if (status === 404 || upper.includes('NOT_FOUND')) {
    return new OcrServiceError(
      502,
      'MODEL_NOT_FOUND',
      '사진 인식 모델을 찾을 수 없습니다. 관리자에게 문의해 주세요.'
    );
  }

  return new OcrServiceError(
    502,
    'UPSTREAM_ERROR',
    '사진 분석 서버 연결이 잠시 불안정합니다. 다시 시도하거나 다음 화면에서 숫자를 직접 적어주세요.'
  );
}

function isRetryableError(err: unknown): boolean {
  const status = getErrorStatus(err);
  if (status !== null) {
    return status >= 500 || status === 408 || status === 429;
  }
  const msg = getErrorMessage(err).toUpperCase();
  return (
    msg.includes('FETCH FAILED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('NETWORK') ||
    msg.includes('UNAVAILABLE')
  );
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryableError(err)) {
        throw err;
      }
      const status = getErrorStatus(err);
      const delayMs = status === 429 ? 2000 : 500 * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

const METER_SYSTEM_INSTRUCTION = `You are a specialist computer-vision reader for South Korean residential and commercial mechanical water meters (수도계량기).
Your sole job is to read the exact integer cubic-meter (m³) reading from the black mechanical roller drum counter window.

CRITICAL RULES FOR KOREAN WATER METERS:
1. ORIENTATION FIRST:
   - Photos are frequently taken rotated 90° clockwise, 90° counter-clockwise, or 180° upside-down.
   - Locate the Korean place-value labels above the counter window: "만 천 백 십 일" (5-digit main meter) or "천 백 십 일" (4-digit sub-meter), plus the "m³" or "㎥" unit label and brand markings.
   - Mentally rotate the image upright so "만"/"천" is on the LEFT and "일" is on the RIGHT, and every digit is right-side-up before reading left-to-right!
   - NEVER misread an upside-down "02870" or sideways "1316" / "0778" / "00060" / "1264" / "0772".

2. READ ONLY THE BLACK MECHANICAL ROLLER WINDOW:
   - The true reading is ALWAYS the row of 4 or 5 white digits on black (or dark) rolling drums inside the rectangular counter window.
   - Leading zeros exist on the drums (e.g., "0778" -> meterValue: 778, "00060" -> meterValue: 60, "02870" -> meterValue: 2870).
   - Return rawDigits with exact leading zeros (e.g., "0778", "00060", "1316") and meterValue as the integer value (e.g., 778, 60, 1316).

3. STRICTLY IGNORE DISTRACTING NUMBERS:
   - Ignore red circular pointer dials (×0.1, ×0.01, ×0.001, ×0.0001).
   - Ignore printed technical specs on the white dial face: Q3: 1.6m³/h, Q2/Q1: 4-2/100, Q1: 0.016-5/100, 15mm, 20mm, 1.0MPa, MPI-1-07-46, serial numbers on the brass rim.

4. ROLLING / TRANSITIONING RIGHTMOST DIGIT ("일" place):
   - Many Korean meters have a slightly taller/notched window on the rightmost digit ("일" place) where two consecutive digits can be seen as the wheel rolls (e.g., "8" with "9" peeking underneath, "6" with "7" peeking, or "2" with "3" peeking).
   - IMPORTANT USER RULE: Whenever the rightmost drum is visibly rolling/transitioning between N and N+1 (i.e., the next digit N+1 is already visibly entering the window), ALWAYS pick the NEXT / HIGHER integer (N+1) as "meterValue"!
   - Example: if "0778" shows "9" entering below "8", return meterValue: 779, alternateValue: 778, note: "끝자리 8→9 넘어가는 중 (779 자동 적용)".
   - Example: if "1316" shows "7" entering below "6", return meterValue: 1317, alternateValue: 1316, note: "끝자리 6→7 넘어가는 중 (1317 자동 적용)".
   - If the rightmost digit is cleanly settled with no next digit rolling in, return that exact integer as meterValue and set alternateValue to null.

5. DO NOT HALLUCINATE FROM PREVIOUS READING:
   - A previous month reference number may be provided only as weak context.
   - Water meters are sometimes replaced with a brand-new meter starting near 0 (e.g., previous was 2870, new meter reads 00060). ALWAYS trust what is physically printed on the black drums in the photo.

6. OUTPUT STYLE:
   - Keep "note" very short and warm in plain Korean suitable for a 65-year-old user (under 32 Korean characters, e.g., "검은 숫자창 0778 확인", "끝자리 6→7 넘어가는 중").`;

const BILL_SYSTEM_INSTRUCTION = `You are a specialist reader for South Korean municipal water & sewage utility bills (상·하수도 요금 및 물이용부담금 고지서 / 영수증, such as 화성특례시, 서울시, 경기도 시군 수도요금 고지서).

CRITICAL EXTRACTION RULES:
1. ORIENTATION: Mentally orient the bill upright even if rotated or angled.
2. AMOUNT ("amount" - integer KRW):
   - Extract the on-time total billed amount: "납기내금액", "납부하실 금액", or the grand total "합계" (e.g., 56060).
   - Cross-verify across multiple places on the bill: the top-left summary ("납기내금액 1건, 56,060원"), the center breakdown table ("납기내금액 ... 56,060 원" and "합계 56,060"), and the bottom OCR/GIRO strip where the amount is often encoded.
   - Do NOT pick "납기후금액" (late fee amount) when "납기내금액" is present.
3. USAGE ("usage" - number in m³):
   - Extract the billed water consumption labeled "사용량" (e.g., 22).
   - Distinguish "사용량" carefully from "당월지침" (current meter reading), "전월지침" (previous meter reading), and "건수" (1건).
4. BILLING YEAR-MONTH ("billingYm"):
   - If the header clearly states the billing month (e.g., "2026년 10월 고지분" -> "2026-10"), return "YYYY-MM". Otherwise null.
5. METER READINGS ON BILL ("billPrevReading", "billCurrReading"):
   - Extract "전월지침" and "당월지침" if printed on the bill, otherwise null.
6. OUTPUT STYLE:
   - Keep "note" very short and clear in plain Korean (under 32 Korean characters, e.g., "납기내금액 56,060원 · 사용량 22㎥ 확인").`;

const METER_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    meterValue: {
      type: Type.INTEGER,
      nullable: true,
      description:
        'Primary integer m3 reading from the black roller window (leading zeros stripped), or null if unreadable.',
    },
    alternateValue: {
      type: Type.INTEGER,
      nullable: true,
      description:
        'If the rightmost rolling drum is mid-transition between two digits, provide the adjacent integer value; otherwise null.',
    },
    rawDigits: {
      type: Type.STRING,
      nullable: true,
      description:
        'Exact digits visible in the black counter window including leading zeros, e.g. "0778" or "00060".',
    },
    rotationDegrees: {
      type: Type.INTEGER,
      nullable: true,
      description:
        'Detected rotation of the meter in the photo in clockwise degrees: 0, 90, 180, or 270.',
    },
    confidence: {
      type: Type.STRING,
      description: 'Confidence level: "high", "medium", or "low".',
    },
    note: {
      type: Type.STRING,
      description:
        'Very short plain Korean summary for an elderly user (max 32 chars).',
    },
  },
  required: ['meterValue', 'alternateValue', 'rawDigits', 'confidence', 'note'],
};

const BILL_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    amount: {
      type: Type.INTEGER,
      nullable: true,
      description: 'On-time billed total amount in KRW (납기내금액 / 합계).',
    },
    usage: {
      type: Type.NUMBER,
      nullable: true,
      description: 'Billed water usage in cubic meters (사용량).',
    },
    billingYm: {
      type: Type.STRING,
      nullable: true,
      description: 'Billing year-month in YYYY-MM format if clearly visible.',
    },
    billPrevReading: {
      type: Type.INTEGER,
      nullable: true,
      description: 'Previous meter reading printed on bill (전월지침), if present.',
    },
    billCurrReading: {
      type: Type.INTEGER,
      nullable: true,
      description: 'Current meter reading printed on bill (당월지침), if present.',
    },
    confidence: {
      type: Type.STRING,
      description: 'Confidence level: "high", "medium", or "low".',
    },
    note: {
      type: Type.STRING,
      description:
        'Very short plain Korean summary for an elderly user (max 32 chars).',
    },
  },
  required: ['amount', 'usage', 'billingYm', 'confidence', 'note'],
};

function sanitizeConfidence(val: unknown): 'high' | 'medium' | 'low' {
  if (val === 'high' || val === 'medium' || val === 'low') return val;
  return 'medium';
}

function toFiniteIntOrNull(val: unknown, min: number, max: number): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

function toFiniteNumOrNull(val: unknown, min: number, max: number): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return Math.round(n * 10) / 10;
}

export async function analyzeWaterPhoto(
  req: OcrAnalyzeRequest
): Promise<OcrAnalyzeResponse> {
  if (!req || !VALID_KINDS.has(req.kind)) {
    throw new OcrServiceError(
      400,
      'INVALID_KIND',
      '지원하지 않는 사진 종류입니다.'
    );
  }

  if (typeof req.imageBase64 !== 'string' || req.imageBase64.trim().length < 32) {
    throw new OcrServiceError(
      400,
      'INVALID_IMAGE',
      '사진 데이터가 올바르지 않습니다. 다시 찍어주세요.'
    );
  }

  const rawBase64 = stripDataUrlPrefix(req.imageBase64);
  if (rawBase64.length > MAX_BASE64_CHARS) {
    throw new OcrServiceError(
      413,
      'IMAGE_TOO_LARGE',
      '사진 파일 크기가 너무 큽니다. 다시 찍어주세요.'
    );
  }

  const mimeType = normalizeMimeType(req.mimeType || 'image/jpeg');
  if (!VALID_MIME_TYPES.has(mimeType)) {
    throw new OcrServiceError(
      400,
      'INVALID_MIME_TYPE',
      '지원하지 않는 이미지 형식입니다. 일반 카메라 사진으로 시도해 주세요.'
    );
  }

  const ai = getGeminiClient();
  const isBill = req.kind === 'bill';

  const meterLabelMap: Record<Exclude<OcrPhotoKind, 'bill'>, string> = {
    meter201: '201호 세대 수도계량기 (보통 4자리 천·백·십·일 검은 숫자창)',
    meter202: '202호 세대 수도계량기 (보통 4자리 천·백·십·일 검은 숫자창)',
    meterTot: '건물 전체 메인 수도계량기 (보통 5자리 만·천·백·십·일 검은 숫자창)',
  };

  const prevRefHint =
    !isBill && typeof req.prevRef === 'number' && Number.isFinite(req.prevRef) && req.prevRef > 0
      ? `참고용 지난달 지침은 ${req.prevRef}입니다. 단, 계량기가 새것으로 교체되어 0 근처부터 다시 시작할 수도 있으니 반드시 사진 속 검은 숫자창의 실제 숫자만 그대로 읽으세요.`
      : '';

  const userPrompt =
    req.kind === 'bill'
      ? '이 한국 수도세 고지서(영수증) 사진에서 납기내금액(원), 사용량(㎥), 고지 연월(YYYY-MM), 전월지침, 당월지침을 정확히 읽어 JSON으로 반환하세요.'
      : `이 사진은 ${meterLabelMap[req.kind]}입니다. 먼저 "만 천 백 십 일" 또는 "천 백 십 일" 글자와 m³ 표시 방향을 보고 사진을 똑바로 세운 뒤, 검은색 회전 숫자창의 흰색 정수 숫자만 왼쪽에서 오른쪽으로 정확히 읽어 JSON으로 반환하세요. ${prevRefHint}`;

  const callVisionModel = (model: string) =>
    ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: rawBase64,
            },
          },
          { text: userPrompt },
        ],
      },
      config: {
        systemInstruction: isBill
          ? BILL_SYSTEM_INSTRUCTION
          : METER_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: isBill ? BILL_RESPONSE_SCHEMA : METER_RESPONSE_SCHEMA,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
      },
    });

  try {
    let response;
    try {
      response = await withRetry(() => callVisionModel(PRIMARY_GEMINI_MODEL), 2);
    } catch (primaryErr) {
      const primaryStatus = getErrorStatus(primaryErr);
      const primaryMsg = getErrorMessage(primaryErr).toUpperCase();
      if (primaryStatus === 429 || primaryMsg.includes('RESOURCE_EXHAUSTED')) {
        console.warn(
          `[OCR] ${PRIMARY_GEMINI_MODEL} rate-limited (429), switching to ${FALLBACK_GEMINI_MODEL}`
        );
        response = await withRetry(
          () => callVisionModel(FALLBACK_GEMINI_MODEL),
          2
        );
      } else {
        throw primaryErr;
      }
    }

    const jsonText = (response.text ?? '').trim();
    if (!jsonText) {
      throw new OcrServiceError(
        502,
        'EMPTY_RESPONSE',
        '사진에서 숫자를 읽지 못했습니다. 다시 찍거나 직접 입력해 주세요.'
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      throw new OcrServiceError(
        502,
        'PARSE_ERROR',
        '사진 분석 결과를 해석하지 못했습니다. 다시 시도해 주세요.'
      );
    }

    const confidence = sanitizeConfidence(parsed.confidence);
    const note =
      typeof parsed.note === 'string' && parsed.note.trim().length > 0
        ? parsed.note.trim().slice(0, 80)
        : '';

    if (isBill) {
      const amount = toFiniteIntOrNull(parsed.amount, 1000, 10000000);
      const usage = toFiniteNumOrNull(parsed.usage, 0, 10000);
      const rawYm =
        typeof parsed.billingYm === 'string' ? parsed.billingYm.trim() : '';
      const billingYm = /^[0-9]{4}-[0-9]{2}$/.test(rawYm) ? rawYm : null;
      const billPrevReading = toFiniteIntOrNull(parsed.billPrevReading, 0, 999999);
      const billCurrReading = toFiniteIntOrNull(parsed.billCurrReading, 0, 999999);

      return {
        kind: req.kind,
        amount,
        usage,
        billingYm,
        billPrevReading,
        billCurrReading,
        confidence,
        note,
      };
    }

    let meterValue = toFiniteIntOrNull(parsed.meterValue, 0, 999999);
    let alternateValue = toFiniteIntOrNull(parsed.alternateValue, 0, 999999);
    if (
      alternateValue !== null &&
      meterValue !== null &&
      (alternateValue === meterValue || Math.abs(alternateValue - meterValue) > 2)
    ) {
      alternateValue = null;
    }

    let finalNote = note;
    // Deterministically auto-promote to the higher integer when a rolling transition is detected
    if (
      meterValue !== null &&
      alternateValue !== null &&
      alternateValue === meterValue + 1
    ) {
      const prevDigit = meterValue % 10;
      const nextDigit = alternateValue % 10;
      meterValue = alternateValue;
      finalNote = `끝자리 ${prevDigit}→${nextDigit} 넘어가는 중 (${meterValue} 자동 적용)`;
    }
    // Never show a separate alternate picker button once auto-applied
    alternateValue = null;

    const rawDigits =
      typeof parsed.rawDigits === 'string' && parsed.rawDigits.trim().length > 0
        ? parsed.rawDigits.trim().slice(0, 12)
        : null;
    const rotationDegrees = toFiniteIntOrNull(parsed.rotationDegrees, 0, 360);

    return {
      kind: req.kind,
      meterValue,
      alternateValue,
      rawDigits,
      rotationDegrees,
      confidence,
      note: finalNote,
    };
  } catch (err) {
    throw classifyGeminiError(err);
  }
}
