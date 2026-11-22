import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  analyzeWaterPhoto,
  OcrServiceError,
  type OcrAnalyzeRequest,
} from './api/ocr.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/ocr', (_req, res) => {
    const key = process.env.GEMINI_API_KEY?.trim();
    res.json({
      ok: true,
      hasApiKey: Boolean(key && key !== 'MY_GEMINI_API_KEY'),
    });
  });

  app.post('/api/ocr', async (req, res) => {
    try {
      const body = req.body as OcrAnalyzeRequest;
      const result = await analyzeWaterPhoto(body);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof OcrServiceError) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
        });
        return;
      }
      console.error('[POST /api/ocr] Unexpected error:', err);
      res.status(500).json({
        error: '사진 분석 중 예상치 못한 오류가 발생했습니다.',
        code: 'INTERNAL_ERROR',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
