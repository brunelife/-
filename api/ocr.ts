import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export type OcrPhotoKind = 'meter201' | 'meter202' | 'meterTot' | 'bill' | 'auto';

export interface OcrAnalyzeRequest {
  kind: OcrPhotoKind;
  imageBase64: string;
  mimeType: string;
  prevRef?: number;
}

export interface OcrAnalyzeResponse {
  kind: OcrPhotoKind;
  /** True visual document type detected from the pixels ("meter" or "bill"), even if uploaded to the wrong slot */
  detectedType: 'meter' | 'bill';
  /** Number of black integer roller drums on a water meter (4 for "천 백 십 일" sub-meters, 5 for "만 천 백 십 일" main meters) */
  meterDigitCount?: number | null;
  meterValue?: number | null;
  alternateValue?: number | null;
  rawDigits?: string | null;
  rotationDegrees?: number | null;
  /** Exact clockwise rotation (0 | 90 | 180 | 270) to apply to the original image so text/digits read upright left-to-right */
  uprightRotateCw: 0 | 90 | 180 | 270;
  /** Normalized [ymin, xmin, ymax, xmax] (0..1000) bounding box on the ORIGINAL unrotated image around the key digits/table */
  counterBox?: [number, number, number, number] | null;
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
  'auto',
]);

const VALID_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const MAX_BASE64_CHARS = 16 * 1024 * 1024;
export const PRIMARY_GEMINI_MODEL = 'gemini-3.1-flash-lite';
export const FALLBACK_GEMINI_MODEL = 'gemini-4-hydrogen';
const PRIMARY_TIMEOUT_MS = 14_000;
const FALLBACK_TIMEOUT_MS = 22_000;

let cachedClient: GoogleGenAI | null = null;
let cachedApiKey: string | undefined;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new OcrServiceError(
      500,
      'MISSING_API_KEY',
      '서버에 GEMINI_API_KEY가 설정되지 않았습니다. Vercel Settings > Environment Variables에 GEMINI_API_KEY를 넣고 Redeploy 해주세요.'
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
      '사진 인식 API 키 인증에 실패했습니다. Settings > Secrets 또는 Vercel 환경변수의 GEMINI_API_KEY를 확인해 주세요.'
    );
  }

  if (status === 429 || upper.includes('RESOURCE_EXHAUSTED')) {
    return new OcrServiceError(
      429,
      'RATE_LIMITED',
      '잠시 사진 인식 요청이 많습니다. 몇 초 뒤 다시 시도해 주세요.'
    );
  }

  if (status === 404 || upper.includes('NOT_FOUND')) {
    return new OcrServiceError(
      502,
      'MODEL_NOT_FOUND',
      '사진 인식 모델을 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.'
    );
  }

  if (status === 504 || upper.includes('TIMEOUT') || upper.includes('TIMED OUT')) {
    return new OcrServiceError(
      504,
      'UPSTREAM_TIMEOUT',
      '사진 분석 응답이 지연되었습니다. 잠시 후 다시 시도하거나 다음 화면에서 숫자를 직접 적어주세요.'
    );
  }

  return new OcrServiceError(
    502,
    'UPSTREAM_ERROR',
    `사진 분석 서버 연결이 잠시 불안정합니다 (${status ?? 'NET'}). 다시 시도하거나 다음 화면에서 숫자를 직접 적어주세요.`
  );
}

function shouldFailoverToFallback(err: unknown): boolean {
  if (err instanceof OcrServiceError) {
    return (
      err.code === 'UPSTREAM_TIMEOUT' ||
      err.status === 429 ||
      err.status === 502 ||
      err.status === 503 ||
      err.status === 504
    );
  }
  const status = getErrorStatus(err);
  if (status === 400 || status === 401 || status === 403) {
    return false;
  }
  if (
    status === 404 ||
    status === 408 ||
    status === 429 ||
    (status !== null && status >= 500)
  ) {
    return true;
  }
  const msg = getErrorMessage(err).toUpperCase();
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('TIMEOUT') ||
    msg.includes('TIMED OUT') ||
    msg.includes('FETCH FAILED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('NETWORK')
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  modelName: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new OcrServiceError(
              504,
              'UPSTREAM_TIMEOUT',
              `사진 분석 모델(${modelName}) 응답이 시간 초과되었습니다.`
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

const UNIFIED_WATER_SYSTEM_INSTRUCTION = `You are a specialist computer-vision reader for South Korean water billing: BOTH mechanical water meters (수도계량기) AND municipal water utility bills (상·하수도 요금 및 물이용부담금 고지서 / 영수증).

STEP 0 — FIRST CLASSIFY THE ACTUAL IMAGE ("detectedType"):
- Users (especially elderly users) sometimes upload a water bill into a meter slot, or a water meter into the bill slot, or upload all photos at once.
- ALWAYS inspect the actual pixels and set "detectedType" to:
  * "bill": if the image is a paper/screen utility bill / receipt (고지서/영수증 with 납기내금액, 사용량, 상수도/하수도 table).
  * "meter": if the image is a mechanical water meter dial (수도계량기 with black rolling integer drums and red circular pointer dials).

=== IF detectedType === "meter" ===
1. ORIENTATION FIRST:
   - Photos are frequently taken rotated 90° CW, 90° CCW, or 180° upside-down.
   - Locate "만 천 백 십 일" (5-digit main meter) or "천 백 십 일" (4-digit sub-meter) and the "m³" mark. Mentally orient upright so "만"/"천" is LEFT and "일" is RIGHT before reading digits left-to-right!
2. READ ONLY THE BLACK MECHANICAL ROLLER WINDOW:
   - Read ONLY the row of 4 or 5 white digits on black (dark) rolling drums inside the rectangular counter window.
   - Leading zeros exist on the drums (e.g., "0778" -> meterValue: 778, meterDigitCount: 4; "00060" -> meterValue: 60, meterDigitCount: 5; "02870" -> meterValue: 2870, meterDigitCount: 5; "1316" -> meterValue: 1316, meterDigitCount: 4).
   - Set "meterDigitCount" to the exact count of black integer drums (4 if "천 백 십 일", 5 if "만 천 백 십 일").
   - Return "rawDigits" with exact leading zeros (e.g., "00060", "0778", "1316") and "meterValue" as the integer.
3. STRICTLY IGNORE DISTRACTING NUMBERS:
   - Ignore red circular pointer dials (×0.1, ×0.01, ×0.001, ×0.0001) and printed specs (Q3, Q2/Q1, 15mm, 20mm, 1.0MPa, serial numbers on brass rim).
4. ROLLING / TRANSITIONING RIGHTMOST DIGIT ("일" place):
   - Many Korean meters have a taller/notched window on the rightmost digit ("일") where TWO consecutive digits (N and N+1) are visibly stacked as the drum rolls (e.g., 2→3, 6→7, 8→9).
   - IMPORTANT USER RULE: Whenever TWO consecutive digits (N and N+1) are visibly stacked in the rightmost ("일") column, ALWAYS pick the NEXT / HIGHER integer (N+1) as "meterValue" and set "alternateValue" to N!
   - Example: "0778" with "9" entering below "8" -> meterValue: 779, alternateValue: 778, note: "끝자리 8→9 넘어가는 중 (779 자동 적용)".
   - Example: "1316" with "7" entering below "6" -> meterValue: 1317, alternateValue: 1316, note: "끝자리 6→7 넘어가는 중 (1317 자동 적용)".
   - If cleanly settled with only a single digit centered, set alternateValue to null.
5. DO NOT HALLUCINATE FROM PREVIOUS READING:
   - ALWAYS trust what is physically printed on the black drums in the photo (even if a meter was replaced or uploaded to the wrong slot!).
6. AUTOMATIC UPRIGHT ORIENTATION ("counterBox", "redDialsBox", "placeLabelsSide"):
   - ALL boxes use [ymin, xmin, ymax, xmax] in 0..1000 normalized coordinates on the ORIGINAL UNROTATED image (ymin=0 top, ymax=1000 bottom, xmin=0 left, xmax=1000 right).
   - "counterBox": tight box around ONLY the black rectangular digit drum window.
   - "redDialsBox": box enclosing the cluster of RED circular pointer dials (or the Korean 만/천/백/십/일 label strip if red dials are cropped out).
   - "placeLabelsSide": looking directly at the ORIGINAL UNROTATED image, which side of the black digit window do the red circular dials and Korean 만/천/백/십/일 labels sit on? ("BELOW", "RIGHT", "ABOVE", or "LEFT").
   - Set bill fields (amount, usage, billingYm, billPrevReading, billCurrReading, textTopDirection) to null.

=== IF detectedType === "bill" ===
1. ORIENTATION ("textTopDirection") & SUMMARY BOX ("counterBox"):
   - "textTopDirection": which edge of the ORIGINAL bill image the top of the printed Korean letters points toward ("UP", "DOWN", "LEFT", or "RIGHT").
   - "counterBox": [ymin, xmin, ymax, xmax] (0..1000) on the ORIGINAL image enclosing the main summary table showing "납기내금액" and "사용량".
2. AMOUNT ("amount" - integer KRW):
   - Extract the on-time total billed amount ("납기내금액", "납부하실 금액", or "합계", e.g., 56060 or 149930). Do NOT pick "납기후금액".
3. USAGE ("usage" - number in m³):
   - Extract billed water consumption labeled "사용량" (e.g., 22 or 61). Distinguish from 당월지침, 전월지침, 건수.
4. BILLING YEAR-MONTH ("billingYm"):
   - Extract "YYYY-MM" if clearly printed (e.g., "2026년 11월 고지분" -> "2026-11"), else null.
5. METER READINGS ON BILL ("billPrevReading", "billCurrReading"):
   - Extract "전월지침" and "당월지침" if printed, else null.
   - Set meter fields (meterValue, alternateValue, rawDigits, meterDigitCount, redDialsBox, placeLabelsSide) to null.

OUTPUT STYLE:
- Keep "note" very short and warm in plain Korean suitable for a 65-year-old user (under 32 Korean characters).`;

const UNIFIED_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    detectedType: {
      type: Type.STRING,
      description: 'Actual image type: "meter" (water meter dial) or "bill" (water utility bill).',
    },
    meterValue: {
      type: Type.INTEGER,
      nullable: true,
      description:
        'If detectedType is "meter": integer m3 reading from the black roller window (leading zeros stripped), else null.',
    },
    alternateValue: {
      type: Type.INTEGER,
      nullable: true,
      description:
        'If rightmost rolling drum is mid-transition between N and N+1, the adjacent integer value; else null.',
    },
    rawDigits: {
      type: Type.STRING,
      nullable: true,
      description:
        'Exact digits visible in the black counter window including leading zeros, e.g. "0778", "00060", "1316"; else null.',
    },
    meterDigitCount: {
      type: Type.INTEGER,
      nullable: true,
      description:
        'Count of black integer drums on the water meter: 4 for "천 백 십 일" sub-meter, 5 for "만 천 백 십 일" main meter; else null.',
    },
    counterBox: {
      type: Type.ARRAY,
      items: { type: Type.INTEGER },
      nullable: true,
      description:
        'Bounding box [ymin, xmin, ymax, xmax] in 0..1000 on ORIGINAL unrotated image: tightly around ONLY the black digit drum window (for meter) or around 납기내금액/사용량 table (for bill).',
    },
    redDialsBox: {
      type: Type.ARRAY,
      items: { type: Type.INTEGER },
      nullable: true,
      description:
        'For meter: bounding box [ymin, xmin, ymax, xmax] in 0..1000 on ORIGINAL unrotated image enclosing the red circular pointer dials (or Korean 만/천/백/십/일 label strip). Null for bill.',
    },
    placeLabelsSide: {
      type: Type.STRING,
      nullable: true,
      description:
        'For meter: in the ORIGINAL unrotated image, which side of the black digit window the red dials and Korean 만/천/백/십/일 labels sit on: "BELOW", "ABOVE", "RIGHT", or "LEFT". Null for bill.',
    },
    amount: {
      type: Type.INTEGER,
      nullable: true,
      description: 'If detectedType is "bill": on-time total amount in KRW (납기내금액 / 합계); else null.',
    },
    usage: {
      type: Type.NUMBER,
      nullable: true,
      description: 'If detectedType is "bill": billed water usage in m3 (사용량); else null.',
    },
    billingYm: {
      type: Type.STRING,
      nullable: true,
      description: 'If detectedType is "bill": billing year-month YYYY-MM if visible; else null.',
    },
    billPrevReading: {
      type: Type.INTEGER,
      nullable: true,
      description: 'If detectedType is "bill": previous meter reading (전월지침) if printed; else null.',
    },
    billCurrReading: {
      type: Type.INTEGER,
      nullable: true,
      description: 'If detectedType is "bill": current meter reading (당월지침) if printed; else null.',
    },
    textTopDirection: {
      type: Type.STRING,
      nullable: true,
      description:
        'For bill: which edge of the ORIGINAL image the top of the Korean text points toward: "UP", "DOWN", "LEFT", or "RIGHT". Null for meter.',
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
  required: [
    'detectedType',
    'counterBox',
    'confidence',
    'note',
  ],
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

function mapTextTopDirectionToRotateCw(val: unknown): 0 | 90 | 180 | 270 {
  if (typeof val === 'string') {
    const dir = val.trim().toUpperCase();
    if (dir === 'LEFT') return 90;
    if (dir === 'DOWN') return 180;
    if (dir === 'RIGHT') return 270;
    if (dir === 'UP') return 0;
  }
  return 0;
}

function mapPlaceLabelsSideToRotateCw(val: unknown): 0 | 90 | 180 | 270 | null {
  if (typeof val === 'string') {
    const side = val.trim().toUpperCase();
    if (side === 'BELOW' || side === 'BOTTOM' || side === 'DOWN') return 0;
    if (side === 'RIGHT') return 90;
    if (side === 'ABOVE' || side === 'TOP' || side === 'UP') return 180;
    if (side === 'LEFT') return 270;
  }
  return null;
}

function resolveMeterRotateCw(
  counterBox: [number, number, number, number] | null,
  redDialsBox: [number, number, number, number] | null,
  placeLabelsSide: unknown
): 0 | 90 | 180 | 270 {
  if (counterBox && redDialsBox) {
    const counterCy = (counterBox[0] + counterBox[2]) / 2;
    const counterCx = (counterBox[1] + counterBox[3]) / 2;
    const dialsCy = (redDialsBox[0] + redDialsBox[2]) / 2;
    const dialsCx = (redDialsBox[1] + redDialsBox[3]) / 2;
    const dx = dialsCx - counterCx;
    const dy = dialsCy - counterCy;
    if (Math.hypot(dx, dy) >= 35) {
      if (Math.abs(dy) >= Math.abs(dx)) {
        return dy >= 0 ? 0 : 180;
      }
      return dx >= 0 ? 90 : 270;
    }
  }
  return mapPlaceLabelsSideToRotateCw(placeLabelsSide) ?? 0;
}

function sanitizeCounterBox(
  val: unknown
): [number, number, number, number] | null {
  if (!Array.isArray(val) || val.length !== 4) return null;
  const nums = val.map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [rawY1, rawX1, rawY2, rawX2] = nums;
  const ymin = Math.max(0, Math.min(1000, Math.round(Math.min(rawY1, rawY2))));
  const ymax = Math.max(0, Math.min(1000, Math.round(Math.max(rawY1, rawY2))));
  const xmin = Math.max(0, Math.min(1000, Math.round(Math.min(rawX1, rawX2))));
  const xmax = Math.max(0, Math.min(1000, Math.round(Math.max(rawX1, rawX2))));
  if (ymax - ymin < 20 || xmax - xmin < 20) return null;
  return [ymin, xmin, ymax, xmax];
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

  const userPrompt =
    '이 사진이 한국 수도계량기인지 수도세 고지서(영수증)인지 먼저 판별(detectedType)하세요. 수도계량기라면 만·천·백·십·일 자릿수(4자리 또는 5자리)와 검은색 회전 숫자창의 실제 정수 숫자, 그리고 counterBox·redDialsBox·placeLabelsSide를 정확히 읽으세요. 수도세 고지서라면 납기내금액(원), 사용량(㎥), 고지 연월(YYYY-MM), 전월지침, 당월지침, textTopDirection, counterBox를 정확히 읽어 JSON으로 반환하세요. 사용자가 다른 칸에 잘못 올렸을 수도 있으니 오직 사진 속 실제 내용만 그대로 읽으세요.';

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
        systemInstruction: UNIFIED_WATER_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: UNIFIED_RESPONSE_SCHEMA,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
      },
    });

  try {
    let response;
    try {
      response = await withTimeout(
        callVisionModel(PRIMARY_GEMINI_MODEL),
        PRIMARY_TIMEOUT_MS,
        PRIMARY_GEMINI_MODEL
      );
    } catch (primaryErr) {
      if (shouldFailoverToFallback(primaryErr)) {
        const primaryStatus = getErrorStatus(primaryErr);
        console.warn(
          `[OCR] ${PRIMARY_GEMINI_MODEL} failed (${primaryStatus ?? 'ERR'}), switching immediately to ${FALLBACK_GEMINI_MODEL}`
        );
        try {
          response = await withTimeout(
            callVisionModel(FALLBACK_GEMINI_MODEL),
            FALLBACK_TIMEOUT_MS,
            FALLBACK_GEMINI_MODEL
          );
        } catch (fallbackErr) {
          if (shouldFailoverToFallback(fallbackErr)) {
            console.warn(
              `[OCR] ${FALLBACK_GEMINI_MODEL} also failed, retrying ${PRIMARY_GEMINI_MODEL} once`
            );
            response = await withTimeout(
              callVisionModel(PRIMARY_GEMINI_MODEL),
              PRIMARY_TIMEOUT_MS,
              PRIMARY_GEMINI_MODEL
            );
          } else {
            throw fallbackErr;
          }
        }
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

    const rawDetectedType =
      typeof parsed.detectedType === 'string'
        ? parsed.detectedType.trim().toLowerCase()
        : '';
    const detectedType: 'meter' | 'bill' =
      rawDetectedType === 'bill'
        ? 'bill'
        : rawDetectedType === 'meter'
          ? 'meter'
          : req.kind === 'bill'
            ? 'bill'
            : 'meter';
    const isBill = detectedType === 'bill';

    const confidence = sanitizeConfidence(parsed.confidence);
    const counterBox = sanitizeCounterBox(parsed.counterBox);
    const redDialsBox = !isBill ? sanitizeCounterBox(parsed.redDialsBox) : null;
    const uprightRotateCw = isBill
      ? mapTextTopDirectionToRotateCw(parsed.textTopDirection)
      : resolveMeterRotateCw(counterBox, redDialsBox, parsed.placeLabelsSide);
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
        detectedType: 'bill',
        meterDigitCount: null,
        amount,
        usage,
        billingYm,
        billPrevReading,
        billCurrReading,
        uprightRotateCw,
        counterBox,
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
    alternateValue = null;

    const rawDigits =
      typeof parsed.rawDigits === 'string' && parsed.rawDigits.trim().length > 0
        ? parsed.rawDigits.trim().slice(0, 12)
        : null;

    const digitsOnlyLen = rawDigits ? rawDigits.replace(/\D/g, '').length : 0;
    const explicitDigitCount = toFiniteIntOrNull(parsed.meterDigitCount, 3, 6);
    const meterDigitCount =
      explicitDigitCount === 4 || explicitDigitCount === 5
        ? explicitDigitCount
        : digitsOnlyLen === 4 || digitsOnlyLen === 5
          ? digitsOnlyLen
          : null;

    return {
      kind: req.kind,
      detectedType: 'meter',
      meterDigitCount,
      meterValue,
      alternateValue,
      rawDigits,
      rotationDegrees: uprightRotateCw,
      uprightRotateCw,
      counterBox,
      confidence,
      note: finalNote,
    };
  } catch (err) {
    throw classifyGeminiError(err);
  }
}

/* ============================================================================
 * Vercel Serverless Function Handler (self-contained: zero local file imports)
 * ============================================================================ */

interface NodeLikeRequest extends AsyncIterable<Uint8Array | string> {
  method?: string;
  body?: unknown;
  readableEnded?: boolean;
}

interface NodeLikeResponse {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (chunk?: string) => void;
  status?: (code: number) => NodeLikeResponse;
  json?: (payload: unknown) => void;
}

function sendJson(res: NodeLikeResponse, statusCode: number, data: unknown) {
  if (typeof res.status === 'function') {
    const nextRes = res.status(statusCode);
    if (typeof nextRes.json === 'function') {
      nextRes.json(data);
      return;
    }
  }
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

async function readJsonBody(req: NodeLikeRequest): Promise<unknown> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        throw new OcrServiceError(400, 'INVALID_JSON', '요청 형식이 올바르지 않습니다.');
      }
    }
    return req.body;
  }
  if (req.readableEnded) {
    return {};
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new OcrServiceError(400, 'INVALID_JSON', '요청 본문을 해석하지 못했습니다.');
  }
}

export const maxDuration = 60;

export default async function handler(
  req: NodeLikeRequest,
  res: NodeLikeResponse
) {
  if (req.method === 'GET') {
    const key = process.env.GEMINI_API_KEY?.trim();
    sendJson(res, 200, {
      ok: true,
      hasApiKey: Boolean(key && key !== 'MY_GEMINI_API_KEY'),
      primaryModel: PRIMARY_GEMINI_MODEL,
      fallbackModel: FALLBACK_GEMINI_MODEL,
      maxDuration,
    });
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, {
      error: 'POST 요청만 지원합니다.',
      code: 'METHOD_NOT_ALLOWED',
    });
    return;
  }

  try {
    const payload = (await readJsonBody(req)) as OcrAnalyzeRequest;
    const result = await analyzeWaterPhoto(payload);
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof OcrServiceError) {
      sendJson(res, err.status, {
        error: err.message,
        code: err.code,
      });
      return;
    }
    console.error('[Vercel /api/ocr] Unexpected error:', err);
    const detail = err instanceof Error ? err.message.slice(0, 120) : '';
    sendJson(res, 500, {
      error: detail
        ? `사진 분석 중 서버 오류가 발생했습니다 (${detail}).`
        : '사진 분석 중 예상치 못한 오류가 발생했습니다.',
      code: 'INTERNAL_ERROR',
    });
  }
}
