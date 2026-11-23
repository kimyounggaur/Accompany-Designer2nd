# 반주 디자이너 2

> 공식 주소: **(확정 전)** — Vercel 프로젝트를 연결한 뒤 이 줄에 하나만 적습니다. ([결정 0001](docs/decisions/0001-official-url.md), [운영 설정 체크리스트](docs/ops-checklist.md))

## 무엇인가

브라우저에서 반주 음원을 자르고 섞고, 노래를 녹음하는 음악 수업용 편집기입니다. 설치 없이 크롬에서 열어 쓰고, 작업은 브라우저에 자동으로 저장됩니다.

## 주요 기능

- **음원 올리기**: mp3, wav, m4a 등 브라우저가 읽을 수 있는 오디오. 올리면 파형이 보입니다.
- **여러 트랙 타임라인**: 클립 이동(트랙 사이 이동 포함), 양쪽 끝 자르기, 가르기, 복사·붙여넣기, 삭제(실행 취소로 복원). 트랙 추가·삭제·순서 변경.
- **템포 맞추기**: 프로젝트 BPM, 박자 맞춤(스냅), 확대·축소, 원본 BPM 감지, 재생 속도 맞춤.
- **믹싱**: 트랙 볼륨·팬·뮤트·솔로, 이펙트(5밴드 EQ, 컴프레서, 딜레이, 리버브), 레벨 미터와 스펙트럼.
- **녹음**: 마이크 녹음, 카운트인, 입력 모니터링.
- **실행 취소·다시 실행**과 **믹스 WAV 내보내기**.

## 저장 방식

- **자동 저장**: 편집이 멈추면 잠시 뒤 브라우저(IndexedDB)에 음원까지 함께 저장하고, 새로고침하면 복구합니다. 브라우저 데이터를 지우면 함께 사라집니다.
- **프로젝트 파일**: 상단의 저장·불러오기로 음원이 담긴 파일을 내보내고 불러옵니다. 다른 기기로 옮기거나 백업할 때 씁니다. (형식: `format: "accompany-designer-project"`, 버전 1. 새 형식 `.adproj`는 [설계서](docs/refactoring-design.md) 4단계에서 도입합니다.)

## 지원 브라우저

크롬·엣지 최신 버전에서 확인했습니다. 사파리·파이어폭스는 아직 확인하지 않았습니다. 화면은 노트북(너비 1280px 이상)을 먼저 지원합니다([결정 0002](docs/decisions/0002-supported-screens.md)).

## 개발

Node 22 이상이 필요합니다(`.nvmrc`).

```bash
npm ci               # 설치
npm run dev          # 개발 서버 (http://127.0.0.1:5173)
npm run build        # 타입 검사 + 빌드
npm run check        # 타입 검사만
npm test             # 단위 테스트 (node:test)
npm run test:e2e     # 회귀 테스트 (Playwright, 처음에는 npx playwright install chromium)
```

`npm run test:e2e`는 설치된 크롬을 쓰려면 `CHROME_PATH=<크롬 경로>`를 붙입니다. 상태 줄 오른쪽 끝의 `빌드 xxxxxxx`는 이 화면이 어느 커밋에서 만들어졌는지 보여 줍니다.

## 폴더 구조

```text
src/
  App.tsx, main.tsx   화면 조립과 진입점
  components/         화면 부품
  audio/              소리 엔진, 녹음, 이펙트
  store/              상태(Zustand)
  storage/            자동 저장과 프로젝트 파일
  utils/              계산·인코딩 함수
tests/                단위 테스트 (node:test)
e2e/                  회귀 테스트 (Playwright)
docs/                 설계서, 결정 기록, 측정 기준선, 진행 상황(PHASES.md)
```

리팩토링이 끝났을 때의 목표 구조는 [설계서 §4.2](docs/refactoring-design.md)에 있습니다.

## 기여 규칙

- 브랜치 이름에 작업 단위 번호를 넣습니다(`refactor/p3-2-transport`). **PR 하나는 작업 단위 하나**입니다.
- 병합 조건: CI(`check`, `e2e`) 통과, 미리보기 주소에서 헤드폰으로 재생·편집·녹음 3분 점검, PR 템플릿의 측정 표 작성.
- 문제가 생기면 Vercel에서 이전 배포로 되돌리고 원인 PR을 되돌립니다(revert).
- 진행 상황은 [docs/PHASES.md](docs/PHASES.md), 지금까지의 측정은 [docs/baseline-2026-11.md](docs/baseline-2026-11.md)에 있습니다.
