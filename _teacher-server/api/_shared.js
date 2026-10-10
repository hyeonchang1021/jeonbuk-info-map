// 여러 API가 함께 쓰는 도구. 파일 이름이 _ 로 시작하면 Vercel이 주소로 노출하지 않는다.
import { timingSafeEqual, scryptSync } from 'node:crypto';

export const LEVELS = ['기초', '중급', '고급'];

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

// 선생님 비밀번호 확인. 비밀번호 자체는 어디에도 저장하지 않고 scrypt 해시만 둔다.
// 환경 변수 TEACHER_PASSWORD 가 있으면 그 값을 우선한다 (Vercel 설정에서 비밀번호를 바꾸고 싶을 때).
const PW_SALT = '022e6c7f6317565dbe2836091e982c57';
const PW_HASH = '6e8eaebccaadd7386d78a5d4b67942e362a2d6123233feddda07fdd6af39ec45';
const okCache = new Map(); // 같은 비밀번호를 매번 다시 계산하지 않도록 (서버 인스턴스 안에서만)
function sameBytes(a, b) { return a.length === b.length && timingSafeEqual(a, b); }
export function isTeacher(req) {
  const got = String(req.headers['x-teacher-key'] || '');
  if (!got || got.length > 200) return false;
  const env = process.env.TEACHER_PASSWORD || '';
  if (env) return sameBytes(Buffer.from(env, 'utf8'), Buffer.from(got, 'utf8'));
  if (okCache.has(got)) return okCache.get(got);
  const h = scryptSync(got, PW_SALT, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const ok = sameBytes(h, Buffer.from(PW_HASH, 'hex'));
  if (okCache.size > 50) okCache.clear();
  okCache.set(got, ok);
  return ok;
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
