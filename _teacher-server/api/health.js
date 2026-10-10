// 배포 확인용. 비밀 값은 돌려주지 않고 설정이 되어 있는지만 알려 준다.
import { send } from './_shared.js';

export default function handler(req, res) {
  send(res, 200, {
    ok: true,
    storage: !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID),
  }, { 'Access-Control-Allow-Origin': '*' });
}
