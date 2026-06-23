# 개발 단계

## Phase 1: 기본 오디오 편집 MVP

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

## Phase 2: Playlist 강화

- [x] 여러 트랙 추가
- [ ] 트랙 삭제
- [ ] clip copy/paste
- [ ] split at playhead
- [x] undo/redo
- [ ] keyboard shortcut map 정리
- [ ] 더 긴 파일용 waveform cache 최적화

## Phase 3: BPM 감지와 Stretch

- [x] MVP용 BPM 추정 버튼
- [x] source BPM 저장
- [x] project BPM 기준 playbackRate 계산
- [ ] `web-audio-beat-detector`, `essentia.js` 비교 검토
- [ ] `rubberband-wasm`, `soundtouchjs`, AudioWorklet 후보 검증
- [ ] pitch preserve realtime stretch

## Phase 4: 믹싱

- [x] track volume/pan
- [x] mute/solo
- [x] 3-band EQ
- [x] compressor
- [x] master meter
- [x] per-track meter
- [x] effect bypass/chain UI 개선

## Phase 5: 저장/불러오기/Export

- [x] 프로젝트 JSON 저장/불러오기
- [ ] IndexedDB 오디오 asset 저장
- [ ] OfflineAudioContext wav export
- [ ] export progress UI
- [ ] ffmpeg.wasm mp3 export 검토
