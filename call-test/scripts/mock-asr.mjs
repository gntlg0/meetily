#!/usr/bin/env node
/**
 * Minimal OpenAI-compatible ASR server, for exercising the `custom` provider
 * and the compare view without a real self-hosted model.
 *
 *   pnpm mock-asr
 *   # then in .env.local:
 *   CUSTOM_ASR_BASE_URL=http://127.0.0.1:3399/v1
 *
 * It ignores the uploaded audio and returns a canned Mongolian transcript with
 * per-segment timings (verbose_json), which is exactly the shape whisper.cpp /
 * faster-whisper / vLLM emit.
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_ASR_PORT ?? 3399);
/** Stall the response, to test crash-during-transcription recovery. */
const DELAY_MS = Number(process.env.MOCK_ASR_DELAY_MS ?? 0);

const CANNED = [
  [0.0, 4.1, 'Сайн байна уу, банкны зээлийн ажилтан ярьж байна.'],
  [4.3, 8.9, 'Тийм ээ, сайн байна уу. Би сонсож байна.'],
  [9.2, 15.6, 'Таны зээлийн төлбөр гурван хоног хоцорсон байна, шалгаж үзсэн үү?'],
  [15.9, 23.4, 'Уучлаарай, цалин хойшилсон юм. Ирэх Баасан гарагт багтааж төлнө.'],
  [23.7, 28.0, 'Ойлголоо. Баасан гарагт төлнө гэж тэмдэглэлээ. Баярлалаа.'],
];

const body = {
  task: 'transcribe',
  language: 'mongolian',
  duration: CANNED[CANNED.length - 1][1],
  text: CANNED.map(([, , t]) => t).join(' '),
  segments: CANNED.map(([start, end, text], id) => ({ id, start, end, text })),
};

const server = http.createServer((req, res) => {
  // Drain the multipart upload; we don't care about its contents.
  req.resume();

  req.on('end', () => {
    if (req.method !== 'POST' || !req.url?.endsWith('/audio/transcriptions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Only POST /v1/audio/transcriptions' }));
      return;
    }
    console.log(`[mock-asr] ${req.method} ${req.url} -> 200 (delay ${DELAY_MS}ms)`);
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    }, DELAY_MS);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-asr] listening on http://127.0.0.1:${PORT}/v1/audio/transcriptions`);
});
