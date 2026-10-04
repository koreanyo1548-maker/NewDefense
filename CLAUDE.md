# CLAUDE.md

## 브랜치 규칙

- `main` 브랜치가 최종 확정본이다.
- 작업은 별도 작업 브랜치에서 하고, 완료되면 `main`에 머지한다.
- GitHub Pages는 `main` 브랜치의 루트(`/`)에서 배포된다.

## 구조

- `index.html`(마크업) · `css/style.css` · `js/data.js`(콘텐츠 테이블·TUNING) · `js/game.js`(엔진) · `assets/`
- 기획 원칙과 규칙 정의는 `docs/design.md`. 새 콘텐츠는 가능하면 `js/data.js` 테이블만 늘려서 추가한다.
- 명중 규칙(키워드·적 특성)은 `js/game.js`의 `onHit`/`dealHit` 한 곳에만 둔다.
