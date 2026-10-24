// 학생 퀴즈가 끝나면 결과를 받아 비공개 저장소에 한 건씩 저장한다.
import { put } from '@vercel/blob';
import { randomBytes } from 'node:crypto';
import { LEVELS, send, readJson, str, int, iso } from './_shared.js';

// 값이 없으면 null (세부 점수를 잴 수 없었던 경우)
const nint = (v, min, max) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : int(v, min, max);
const nnum = (v, min, max) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Math.min(max, Math.max(min, Math.round(Number(v) * 100) / 100));
const avg = (xs) => { xs = xs.filter((v) => v !== null); return xs.length ? Math.round(xs.reduce((t, v) => t + v, 0) / xs.length) : null; };

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
      // 세부 점수 (엄격 채점). 예전 페이지에서 온 기록에는 없다.
      x.first = nint(a && a.first, 0, 100);
      x.acc = nint(a && a.acc, 0, 100);
      x.flu = nint(a && a.flu, 0, 100);
      x.cla = nint(a && a.cla, 0, 100);
      x.rate = nnum(a && a.rate, 0, 20);
      x.pauses = nint(a && a.pauses, 0, 50);
      x.conf = nnum(a && a.conf, 0, 1);
      x.diff = (Array.isArray(a && a.diff) ? a.diff : []).slice(0, 40).map((m) => str(m, 90)).filter(Boolean);
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
      ...(speak ? {
        avgScore: scored.length ? Math.round(scored.reduce((t, a) => t + a.score, 0) / scored.length) : 0,
        scoredCount: scored.length,
        avgFirst: avg(scored.map((a) => a.first)),
        avgAcc: avg(scored.map((a) => a.acc)),
        avgFlu: avg(scored.map((a) => a.flu)),
        avgCla: avg(scored.map((a) => a.cla)),
      } : {}),
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
