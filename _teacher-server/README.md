# 영단어 퀴즈 선생님 관리 서버

**관리 화면 주소: <https://english-quiz-teacher.vercel.app/>**

기초·중급·고급 영단어 퀴즈(`../english-*-quiz/`)가 보낸 결과를 받아 저장하고, 선생님용 관리 화면을 보여 주는 Vercel 프로젝트.

- `api/submit.js` — 학생 퀴즈 결과 받기 (POST, 누구나)
- `api/results.js` — 결과 조회·삭제·메모 (비밀번호 없음: 주소를 아는 사람은 누구나 볼 수 있다)
- `api/health.js` — 배포 확인용
- `public/index.html` — 선생님 관리 화면

저장소는 Vercel Blob(비공개)을 쓴다. 관리 화면은 비밀번호 없이 바로 열린다(2026-11 선생님 요청으로 없앰). 검색 엔진에는 나오지 않도록 noindex를 걸어 두었다.
폴더 이름이 `_`로 시작해서 GitHub Pages(Jekyll)에는 공개되지 않는다.
