// 선생님 화면에서 쓰는 API. 비밀번호가 맞을 때만 응시 기록을 돌려주거나 지운다.
import { list, get, del } from '@vercel/blob';
import { send, isTeacher, ID_RE } from './_shared.js';

const MAX_LIST = 5000;   // 저장소에서 훑는 최대 건수
const MAX_READ = 2000;   // 화면에 돌려주는 최대 건수 (최신순)

async function readOne(pathname) {
  try {
    const r = await get(pathname, { access: 'private' });
    if (!r || r.statusCode !== 200) return null;
    return JSON.parse(await new Response(r.stream).text());
  } catch (e) {
    console.error('read failed', pathname, e && e.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (!isTeacher(req)) return send(res, 401, { error: '비밀번호가 맞지 않습니다.' });

  if (req.method === 'GET') {
    // since=<가장 최근에 받은 id> 를 주면 그보다 새로운 기록만 읽어 온다 (저장소 읽기 횟수를 아끼려고).
    const since = String((req.query && req.query.since) || '');
    if (since && !ID_RE.test(since)) return send(res, 400, { error: '요청 형식이 올바르지 않습니다.' });
    const blobs = [];
    let cursor;
    do {
      const r = await list({ prefix: 'attempts/', cursor, limit: 1000 });
      blobs.push(...r.blobs);
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor && blobs.length < MAX_LIST);

    const idOf = (b) => b.pathname.slice('attempts/'.length).replace(/\.json$/, '');
    blobs.sort((a, b) => b.pathname.localeCompare(a.pathname)); // 이름이 받은 시각으로 시작해서 최신순이 된다
    const ids = blobs.map(idOf);
    const pick = (since ? blobs.filter((b) => idOf(b) > since) : blobs).slice(0, MAX_READ);
    const attempts = [];
    for (let i = 0; i < pick.length; i += 16) {
      const part = await Promise.all(pick.slice(i, i + 16).map((b) => readOne(b.pathname)));
      attempts.push(...part.filter(Boolean));
    }
    return send(res, 200, { attempts, ids: ids.slice(0, MAX_READ), incremental: !!since, stored: blobs.length, truncated: blobs.length > MAX_READ });
  }

  if (req.method === 'DELETE') {
    const id = String((req.query && req.query.id) || '');
    if (!ID_RE.test(id)) return send(res, 400, { error: '지울 기록을 찾지 못했습니다.' });
    try {
      await del(`attempts/${id}.json`);
    } catch (e) {
      console.error('delete failed', id, e && e.message);
      return send(res, 500, { error: '기록을 지우지 못했습니다.' });
    }
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: '지원하지 않는 요청입니다.' });
}
