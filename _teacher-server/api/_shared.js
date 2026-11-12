// 여러 API가 함께 쓰는 도구. 파일 이름이 _ 로 시작하면 Vercel이 주소로 노출하지 않는다.
export const LEVELS = ['기초', '중급', '고급', '발음', '회화']; // 발음 = 현장 영어 발음 연습

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}


// 퀴즈는 미리 확인 요청(preflight)이 없도록 text/plain 으로 JSON을 보낸다. 어떤 형태로 와도 읽는다.
export async function readJson(req, limit = 400000) {
  let raw = req.body;
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw !== 'string') {
    raw = await new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  if (raw.length > limit) throw new Error('too large');
  return JSON.parse(raw);
}

export const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
export const int = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; };
export const iso = (v) => { const d = new Date(typeof v === 'string' ? v : NaN); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

// 저장 파일 이름에 쓰는 id: 받은 시각 + 무작위 10자리
export const ID_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9-]+Z-[0-9a-f]{10}$/;
