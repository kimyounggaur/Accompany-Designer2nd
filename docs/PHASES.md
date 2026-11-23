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
- ⬜ P1-4 의존성 관리
- ⬜ P1-5 CI (대시보드: 브랜치 보호)
- ⬜ P1-6 사이트 기본 정보

### 2단계. 화면 틀과 데이터 보호
- ⬜ P2-1 화면 틀(AppShell)
- ⬜ P2-2 안내 통로 하나
- ⬜ P2-3 사용자 문구를 한곳에
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
