# 영단어 퀴즈 선생님 관리 서버

기초·중급·고급 영단어 퀴즈(`../english-*-quiz/`)가 보낸 결과를 받아 저장하고, 선생님용 관리 화면을 보여 주는 Vercel 프로젝트.

- `api/submit.js` — 학생 퀴즈 결과 받기 (POST, 누구나)
- `api/results.js` — 결과 조회·삭제 (선생님 비밀번호 필요)
- `api/health.js` — 배포 확인용
- `public/index.html` — 선생님 관리 화면

저장소는 Vercel Blob(비공개)을 쓴다. 비밀번호는 코드에 scrypt 해시로만 들어 있고, Vercel 환경 변수 `TEACHER_PASSWORD`를 넣으면 그 값이 우선한다.
폴더 이름이 `_`로 시작해서 GitHub Pages(Jekyll)에는 공개되지 않는다.
