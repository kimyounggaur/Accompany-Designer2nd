# 반주 디자이너 2

> 공식 주소: **(확정 전)** — Vercel 프로젝트를 연결한 뒤 이 줄에 하나만 적습니다. ([결정 0001](docs/decisions/0001-official-url.md), [운영 설정 체크리스트](docs/ops-checklist.md))

## 무엇인가

브라우저에서 반주 음원을 자르고 섞고, 노래를 녹음하는 음악 수업용 편집기입니다. 설치 없이 크롬에서 열어 쓰고, 작업은 브라우저에 자동으로 저장됩니다.

## 주요 기능

- **음원 올리기**: mp3, wav, m4a 등 브라우저가 읽을 수 있는 오디오. 올리면 파형이 보입니다.
- **여러 트랙 타임라인**: 클립 이동(트랙 사이 이동 포함), 양쪽 끝 자르기, 가르기, 복사·붙여넣기, 삭제(실행 취소로 복원). 트랙 추가·삭제·순서 변경.
- **템포 맞추기**: 프로젝트 BPM, 박자 맞춤(스냅), 확대·축소, 원본 BPM 감지, 재생 속도 맞춤.
- **믹싱**: 트랙 볼륨·팬·뮤트·솔로, 이펙트(5밴드 EQ, 컴프레서, 딜레이, 리버브), 레벨 미터와 스펙트럼.
- **녹음**: 마이크 녹음, 카운트인(0~8박)·메트로놈, 입력 모니터링. 장치 지연을 자동으로 맞추고, 어긋나면 "지연 보정(ms)"(−200~+200)으로 직접 맞춥니다. 녹음 중에는 임시 파형만 보이고, 끝나면 클립이 한 번에 생겨 실행 취소 한 번으로 지워집니다.
- **실행 취소·다시 실행**.
- **믹스 WAV 내보내기**: 샘플레이트(44.1/48 kHz)와 비트 수(16/24)를 고르고, 진행률을 보며 취소할 수 있습니다. 재생할 때와 같은 소리 부품(마스터 리미터 −1 dBFS 포함)으로 만들어서 같은 문서는 늘 같은 파일이 됩니다. 곡 끝의 딜레이·리버브 꼬리까지 담깁니다.

## 저장 방식

- **자동 저장**: 편집이 멈추면 1.2초 뒤(탭을 숨기거나 떠날 때는 바로) 브라우저(IndexedDB)에 음원까지 함께 저장하고, 새로고침하면 복구합니다. 같은 음원은 한 번만 저장하고, 최근 프로젝트 5개를 남깁니다. 상태 줄 오른쪽에 "자동 저장됨 02:41"처럼 보이고, 저장하지 못하면 [프로젝트 파일로 저장] 단추가 나옵니다. 브라우저 데이터를 지우면 함께 사라지니 중요한 작업은 프로젝트 파일로도 보관하세요.
- **프로젝트 파일**: 상단의 저장·불러오기로 음원이 담긴 파일을 내보내고 불러옵니다. 다른 기기로 옮기거나 백업할 때 씁니다. 지금은 JSON 한 파일(`{ format: "accompany-designer-project", schemaVersion: 2, doc, audio }`)이고, 새 형식 `.adproj`(zip)는 [설계서](docs/refactoring-design.md) P4-2에서 도입합니다. 6월 파일과 11월 파일도 그대로 열립니다. 불러올 때는 검사기 하나(`domain/project/parseProject.ts`)가 값의 자료형과 범위를 보고, 범위를 벗어난 값은 가까운 값으로 고친 뒤 "값 N개를 허용 범위로 고쳤습니다"라고 알려 줍니다.

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

### 개발용 주소 (화면에 보이는 단추는 없음)

- `?probe=1` — 스피커로 나가는 신호를 직접 재서 `window.__probe`(`jumps` 튐·`gaps` 끊김·`peak`·`longestGapMs`·`jumpLog` 튄 지점 앞 8개, 0.1초마다 갱신)에 둡니다. 재생 직전에 `window.__probeReset()`으로 0으로 되돌립니다. 회귀 시험이 이 값을 읽습니다.
- `?engine=v1` — 옛 재생 엔진으로 되돌립니다. 기본은 새 재생 엔진(재생 시계·예약기·트랙 경로·마스터 리미터·내보내기가 모두 같은 소리 부품, 3단계)입니다. 같은 값을 `localStorage["ad.engine"] = "v1"`로 저장해 두면 주소 없이도 옛 엔진을 쓰고, 주소의 `?engine=…`은 언제나 저장소 값보다 우선하며 알 수 없는 값은 무시합니다. 어느 쪽이 켜졌는지는 `<html data-engine>`에 보입니다. 옛 엔진은 기본을 바꾼 1주 뒤 별도 PR로 지울 예정이라, 그때 이 주소 옵션도 사라집니다. 회귀 시험은 `E2E_ENGINE=v1`로 전체를 옛 엔진에서 돌릴 수 있습니다(3단계 시험까지 옛 엔진으로 돌리려면 `E2E_P32_ENGINE=v1`을 함께).
- `?crash=1` — 그리는 즉시 오류를 내서 "문제가 생겼습니다" 안내 화면을 확인합니다.

## 폴더 구조

```text
src/
  App.tsx, main.tsx   화면 조립과 진입점
  app/                화면 틀(AppShell), 사용자 동작(actions), 앱 시작(bootstrap), 엔진 연결(engineSync), 녹음 연결(recording · recordingHost: 어느 트랙에 놓을지·저장·안내)
  ui/                 화면 부품: 안내·확인창·자동 저장 표시(feedback), 상단 바, 인스펙터
  components/         화면 부품(타임라인 등, 순차적으로 ui/로 이동 중)
  i18n/               화면 문구(ko.ts)
  services/           안내(notify)·오류 변환(errors)·확인창, 저장(persistence/: 자동 저장 · 프로젝트 파일 읽기·쓰기 · 음원 원본 기억), 파형 점 보관소(peaksCache)
  audio/              소리 엔진: 옛 엔진(audioEngine.ts) · 새 엔진(engine/AudioEngine.ts: 재생 시계 Transport · 예약기 Scheduler · 클립 재생 단위 ClipVoice · 트랙 경로 TrackStrip · 마스터 길 MasterBus(볼륨 → 선읽기 리미터 → 분석기 → 스피커) · 모니터 길 MonitorBus(메트로놈·입력 모니터, 믹스에 안 섞임)) · 리미터(worklets/limiter.worklet.ts, 계산은 limiterCore.ts) · 이펙트 부품(effects/: 공통 약속 EffectNode · EQ · 컴프레서 · 딜레이 · 리버브 · 같은 설정은 같은 잔향 impulse · 꼬리 길이 tail) · 엔진 고르기(currentEngine.ts) · 바뀐 트랙만 고르는 계획(engine/syncPlan.ts) · 예약 타이머(workers/tick.worker.ts) · 녹음(recording/RecordingController.ts: 대기 → 준비 → 카운트인 → 녹음 → 마무리 상태 기계 · recording/Recorder.ts: 마이크 받기 · worklets/recorder.worklet.ts: 4,096 샘플씩 조각과 파형 최대값을 보냄, 계산은 recorderCore.ts) · 메트로놈·카운트인(Metronome.ts: 오디오 시계로 미리 예약)
  domain/             화면·소리 없이 시험할 수 있는 순수 계산(timeline/clipMath.ts: 클립을 어떻게 재생할지 정하는 planVoice · master/volume.ts: 마스터 볼륨 범위·dB 변환 · recording/latency.ts: 녹음 지연 보정 · types.ts: 문서 형식 v2의 자료형 · project/: 문서 검사기 parseProject·parsePreset, 옛 형식 이전 migrations, 기본값 defaults, 값의 범위 ranges)
  store/, state/      상태: 프로젝트 문서(state/projectStore.ts, immer로 불변 갱신) · 편집 함수(state/commands/) · 이력(state/history.ts) / 화면 상태(store/useDawStore.ts, 문서를 거울처럼 비춤) / 녹음 상태(state/recordingStore.ts: 진행·임시 파형·설정, 문서에는 안 들어감) / 안내·확인창·자동 저장 상태
  styles/             화면 틀·안내·글자 가독성 CSS
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
