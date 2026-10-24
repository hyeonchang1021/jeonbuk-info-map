// 학생 퀴즈가 끝나면 결과를 받아 비공개 저장소에 한 건씩 저장한다.
import { put } from '@vercel/blob';
import { randomBytes } from 'node:crypto';
import { LEVELS, send, readJson, str, int, iso } from './_shared.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function validate(b) {
  if (!b || typeof b !== 'object') return { error: '보낸 내용이 없습니다.' };
  const name = str(b.name, 30).trim();
  if (!name) return { error: '이름이 없습니다.' };
  if (!LEVELS.includes(b.level)) return { error: '단계가 올바르지 않습니다.' };
  const speak = b.level === '발음';
  const answers = (Array.isArray(b.answers) ? b.answers : []).slice(0, 600).map((a) => {
    const x = {
      w: str(a && a.w, speak ? 300 : 80),
      ko: str(a && a.ko, 200),
      picked: str(a && a.picked, speak ? 400 : 160),
      ok: !!(a && a.ok),
      cat: str(a && a.cat, 60),
      pos: str(a && a.pos, 16),
    };
    if (speak) {
      x.score = int(a && a.score, 0, 100);
      x.missed = (Array.isArray(a && a.missed) ? a.missed : []).slice(0, 40).map((m) => str(m, 40)).filter(Boolean);
      x.tries = int(a && a.tries, 0, 99);
      x.skipped = !!(a && a.skipped);
      x.ok = !x.skipped && x.score >= 90;
    }
    return x;
  }).filter((a) => a.w);
  const planned = int(b.planned, answers.length, 1000);
  const scored = answers.filter((a) => speak && !a.skipped);
  return {
    rec: {
      name,
      level: b.level,
      topic: str(b.topic, 40) || '전체 주제',
      mode: speak ? 'speaking' : b.mode === 'instant' ? 'instant' : 'check',
      kind: b.kind === 'retry' ? 'retry' : 'new',
      planned,
      answered: answers.length,
      score: answers.filter((a) => a.ok).length,
      ...(speak ? { avgScore: scored.length ? Math.round(scored.reduce((t, a) => t + a.score, 0) / scored.length) : 0, scoredCount: scored.length } : {}),
      completed: answers.length >= planned && answers.length > 0,
      startedAt: iso(b.startedAt),
      finishedAt: iso(b.finishedAt),
      durationSec: int(b.durationSec, 0, 86400),
      page: str(b.page, 200),
      answers,
    },
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    return res.end();
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'POST 요청만 받습니다.' }, CORS);

  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error: '요청 형식이 올바르지 않습니다.' }, CORS); }
  const v = validate(body);
  if (v.error) return send(res, 400, { error: v.error }, CORS);

  const receivedAt = new Date().toISOString();
  const id = `${receivedAt.replace(/[:.]/g, '-')}-${randomBytes(5).toString('hex')}`;
  const record = { id, receivedAt, ...v.rec };
  try {
    await put(`attempts/${id}.json`, JSON.stringify(record), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
  } catch (e) {
    console.error('save failed', e && e.message);
    return send(res, 500, { error: '결과를 저장하지 못했습니다.' }, CORS);
  }
  return send(res, 201, { ok: true, id }, CORS);
}
