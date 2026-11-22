import {
  analyzeWaterPhoto,
  OcrServiceError,
  type OcrAnalyzeRequest,
} from '../server/ocrService';

interface VercelLikeRequest {
  method?: string;
  body?: unknown;
}

interface VercelLikeResponse {
  status: (code: number) => VercelLikeResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

export const maxDuration = 30;

export default async function handler(
  req: VercelLikeRequest,
  res: VercelLikeResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'POST 요청만 지원합니다.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  try {
    let payload: OcrAnalyzeRequest;
    if (typeof req.body === 'string') {
      payload = JSON.parse(req.body) as OcrAnalyzeRequest;
    } else {
      payload = req.body as OcrAnalyzeRequest;
    }
    const result = await analyzeWaterPhoto(payload);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof OcrServiceError) {
      res.status(err.status).json({
        error: err.message,
        code: err.code,
      });
      return;
    }
    console.error('[Vercel /api/ocr] Unexpected error:', err);
    res.status(500).json({
      error: '사진 분석 중 예상치 못한 오류가 발생했습니다.',
      code: 'INTERNAL_ERROR',
    });
  }
}
