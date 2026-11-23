# 개발 단계

기준 문서: [`refactoring-design.md`](refactoring-design.md) (리팩토링 설계서). 작업 단위 하나 = 브랜치 하나(`refactor/p3-2-transport`처럼 번호를 넣음). 통합 브랜치는 `refactor/v2`이고, 단위마다 병합 커밋으로 들어갑니다. 측정 기준은 [`baseline-2026-11.md`](baseline-2026-11.md), 결정은 [`decisions/`](decisions/), 대시보드에서 직접 해야 하는 설정은 [`ops-checklist.md`](ops-checklist.md)입니다.

범례: ✅ 끝남 · 🟡 코드는 끝났고 사람이 할 일이 남음 · ⬜ 아직 · 🚧 진행 중

## 리팩토링 단계

### 0단계. 출발점 고정
- ✅ P0-1 codex 브랜치 병합 (결정 7)
- ✅ P0-2 결정 기록 10개
- ✅ P0-3 회귀 측정 스위트

### 1단계. 배포와 저장소 정리
- 🟡 P1-1 빌드 표시 (대시보드: Production Branch, 시스템 환경 변수, Node 버전)
- 🟡 P1-2 GitHub Pages 정리 (대시보드: Pages 끄기)
- ✅ P1-3 저장소 청소 (선택 항목인 과거 이력 정리는 실행하지 않음)
- 🟡 P1-4 의존성 관리 (업데이트 PR이 주 1회 올라오는지는 GitHub에서 확인)
- 🟡 P1-5 CI (워크플로 작성·로컬 검증 완료. GitHub에서 실제 실행 확인과 브랜치 보호는 사람이)
- ✅ P1-6 사이트 기본 정보 (공식 주소가 정해지면 `og:image`를 절대 주소로: ops-checklist)

### 2단계. 화면 틀과 데이터 보호
- ✅ P2-1 화면 틀(AppShell): 상단 바 107px(1280~1599px)·59px(1600px 이상), 1280×720에서 트랙 3개 보임, 오른쪽 패널 칸별 접기
  - 설계와 다르게 한 점 ① 오른쪽 패널 최소 폭을 288px가 아니라 **320px**로 둠: 딜레이·리버브·EQ 장비 화면이 288px에서 잘리거나 글자가 깨짐(기존 고정 폭도 320px). 장비 화면이 폭에 맞춰 줄어들게 하는 일은 P5-0.
  - ② 클립 칸에 이미 있던 소스 BPM·스트레치·속도 표시는 상단 바의 WARP 묶음(원본 BPM·WARP·배속)과 같은 값이라 하나로 합침(라벨은 "원본 BPM").
  - ③ "화면 배치가 바뀌었습니다" 한 번 안내는 안내 통로가 필요하므로 P2-2에서 함.
  - 알려진 기존 문제: 패널 폭 346px 이하에서 딜레이 장비의 5번째 노브가 오른쪽에서 잘림(P5-0).
- ✅ P2-2 안내 통로 하나: `commandMessage` 50곳·`setStatus` 26곳·`window.confirm` 2곳 → 0건. 오류(빨강·닫을 때까지)·경고(8초)·완료(3초)는 토스트, 정보는 상태 줄만, 도구·스냅 같은 상태 표시는 안내 없음. 같은 안내가 연달아 오면 ×N.
  - 스토어 함수는 문구 대신 `CommandResult`를 돌려주고, 문구는 `src/app/actions.ts`가 정해 `notify()`로 보냄. 새 확인창(`ConfirmDialog`)이 트랙 삭제·프로젝트 불러오기의 브라우저 기본 확인창을 대체.
  - 설계와 다르게 한 점 ① 결과 반환을 `state/commands/*`(P3-1) 대신 지금의 `useDawStore` 안에서 함(P3-1에서 그대로 옮김). ② "화면 배치가 바뀌었습니다"는 `notify` 통로가 아니라 별도 1회 카드(`LayoutNotice`)로 구현: 상태 줄의 복구 안내를 덮지 않기 위해. [닫기]=이번만 숨김, [다시 보지 않기]=기억.
  - 덧붙인 개선: 복사할 클립이 없을 때 "클립 0개 복사됨" 대신 안내, 여러 파일 중 일부가 실패했을 때 "N개 파일 업로드 완료"라고 거짓 안내하던 것을 경고로 바꿈.
  - 남은 일: 문구가 아직 `app/actions.ts`·`App.tsx`에 있음 → P2-3에서 `i18n/ko.ts`로. 영어 오류 원문 변환도 P2-3.
- ✅ P2-3 사용자 문구를 한곳에: 화면 글자의 영어 라벨 47곳 → 0곳(검사 스크립트가 `npm run check`·CI에서 지킴). 안내·확인창·오류 문구는 `src/i18n/ko.ts`로 모으고, 브라우저 영어 오류는 `src/services/errors.ts`의 `toUserMessage`가 한국어로 바꿈(원문은 토스트의 접힌 "자세히 보기"에만).
  - 라벨 교체: 트랙 믹스·음소거·솔로·볼륨·팬, 이퀄라이저(저음·중저음·중고음·고음·프레즌스), 컴프레서(기준 음량·압축 비율·반응 시간·회복 시간), 이펙트 랙(이퀄라이저·컴프레서·딜레이·리버브, 켜짐/꺼짐), 리버브·딜레이 장비 화면, 레벨 미터, 트랙 머리(녹음 대기·음소거·솔로·볼륨).
  - 설계와 다르게 한 점 ① `ko.ts`에는 안내·확인창·오류 문구와 예전에 영어였던 라벨을 모았고, JSX에 이미 한국어로 적힌 정적 글자(단추 이름 등 수백 곳)는 그대로 둠. 새 영어가 들어오지 못하게 검사 스크립트가 지킴. ② 검사 범위를 `.tsx`만이 아니라 `src/**/*.ts(x)` 전체(JSX 글자, `aria-label`·`title`·`placeholder`·`alt`, 객체의 `label`·`title`·`description` 값)로 넓힘. 허용: eq·bpm·wav·mp3·rms·warp(두 글자 단위 dB·Hz·ms·L·R은 세 글자 기준에 걸리지 않음). ③ 변환표에 두 줄 추가(프로젝트 파일 JSON 문법 오류, 프로젝트 안 음원 해독 오류). 이 앱이 던진 한국어 사유는 "○○ 실패: 사유"로 그대로 보이고, 알 수 없는 오류는 "○○ 실패: 예상하지 못한 문제가 생겼습니다."(무엇이 실패했는지 앞에 붙임). ④ 트랙 머리의 "녹음 대기·음소거·솔로"는 12px로 줄여 220px 머리 안에 한 줄로 들어가서(아이콘+이름표로 바꿀 필요 없음) 글자만 씀.
  - 덧붙인 개선: 이펙트 랙이 따로 갖고 있던 메시지 줄을 공용 안내 통로로 합침. 카운트인 취소를 영어 문자열 비교 대신 전용 오류 클래스로. 배경과 같은 색이라 안 보이던 글자(이펙트 랙 이름 대비 1.05:1, 레벨 미터 이름·dB 1.0~1.8:1, 컴프레서 보조 글자 등)를 `src/styles/legibility.css`로 보정: 인스펙터·트랙 머리에서 대비 3:1 미만 34곳 → 1곳(장식용 "RD" 마크).
  - 남은 일: 장비 화면 라벨 글자가 5~9px로 작음 → P5-0(공용 조작부)·P6-2(접근성). 대비 4.5:1 미만 8곳(작은 라벨 글자)도 P6-2. 속도 표시의 `ms`·`Hz`가 CSS 대문자 변환으로 `MS`·`HZ`로 보임 → P6-1(CSS 정리).
- ⬜ P2-4 자동 저장을 서비스로 분리

### 3단계. 재생 구조 교체
- ⬜ P3-0 안전망 보강
- ⬜ P3-1 엔진 연결을 React 밖으로
- ⬜ P3-2 재생 시계·예약기·클립 재생 단위
- ⬜ P3-3 트랙 경로와 이펙트 약속
- ⬜ P3-4 마스터 경로와 리미터
- ⬜ P3-5 녹음 흐름
- ⬜ P3-6 내보내기 통합

### 4단계. 저장과 편집 정확도
- ⬜ P4-1 문서 형식 v2와 검사기 하나
- ⬜ P4-2 `.adproj` 파일과 음원 재연결
- ⬜ P4-3 다단계 파형
- ⬜ P4-4 템포·WARP·BPM 마무리
- ⬜ P4-5 클립 배치 규칙
- ⬜ P4-6 도구 동작 표

### 5단계. 조작 편의
- ⬜ P5-0 공용 조작부(Knob) 분리
- ⬜ P5-1 실행 취소 엔진 교체
- ⬜ P5-2 단축키 관리자
- ⬜ P5-3 재생선·시간 표시를 React 밖으로
- ⬜ P5-4 클립 메뉴와 삭제 안전장치
- ⬜ P5-5 기본 편집 기능
- ⬜ P5-6 동작하지 않는 조작부 정리

### 6단계. 마무리
- ⬜ P6-1 스타일 정리
- ⬜ P6-2 접근성
- ⬜ P6-3 타사 표기 정리
- ⬜ P6-4 메모리 상한
- ⬜ P6-5 휴대폰 "재생·녹음" 모드

## 이전 기능 단계 (참고)

리팩토링 전에 쓰던 기능 단위 체크리스트입니다. 두 PHASES 파일에서 더 최근 상태(`undo/redo`, 미터, 이펙트 체인 UI 완료)를 기준으로 합쳤습니다. 남은 항목은 위 리팩토링 단계에서 다룹니다.

### Phase 1: 기본 오디오 편집 MVP
- [x] Vite + React + TypeScript 앱 구성
- [x] Web Audio API 엔진 분리
- [x] 오디오 업로드 및 AudioBuffer 디코딩
- [x] 파형 피크 생성 및 Canvas 표시
- [x] 단일 트랙 클립 배치
- [x] play, pause, stop, playhead
- [x] clip drag 이동
- [x] clip start/end trim
- [x] delete
- [x] 프로젝트 BPM 입력
- [x] snap grid, zoom

### Phase 2: Playlist 강화
- [x] 여러 트랙 추가
- [ ] 트랙 삭제 (codex 브랜치에서 구현됨)
- [ ] clip copy/paste → P5-5
- [ ] split at playhead → P5-5
- [x] undo/redo → P5-1에서 패치 기반으로 교체
- [ ] keyboard shortcut map 정리 → P5-2
- [ ] 더 긴 파일용 waveform cache 최적화 → P4-3

### Phase 3: BPM 감지와 Stretch
- [x] MVP용 BPM 추정 버튼
- [x] source BPM 저장
- [x] project BPM 기준 playbackRate 계산
- [ ] `web-audio-beat-detector`, `essentia.js` 비교 검토
- [ ] `rubberband-wasm`, `soundtouchjs`, AudioWorklet 후보 검증
- [ ] pitch preserve realtime stretch (설계서 §9: 3단계 뒤)

### Phase 4: 믹싱
- [x] track volume/pan
- [x] mute/solo
- [x] 3-band EQ
- [x] compressor
- [x] master meter
- [x] per-track meter
- [x] effect bypass/chain UI 개선

### Phase 5: 저장/불러오기/Export
- [x] 프로젝트 JSON 저장/불러오기
- [ ] IndexedDB 오디오 asset 저장 → P2-4 (자동 저장은 codex 브랜치에서 구현됨)
- [ ] OfflineAudioContext wav export → P3-6 (codex 브랜치에 `renderMix` 있음)
- [ ] export progress UI → P3-6
- [ ] ffmpeg.wasm mp3 export 검토 (설계서 §9: 선택)
