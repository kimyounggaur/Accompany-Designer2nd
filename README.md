# Browser DAW MVP

브라우저에서 오디오 파일을 업로드하고, FL Studio Playlist처럼 타임라인에 클립을 놓아 기본 컷 편집을 할 수 있는 Phase 1 MVP입니다.

## 실행

```bash
npm install
npm run dev
```

## 현재 구현

- mp3, wav, m4a 등 브라우저가 디코딩할 수 있는 오디오 파일 업로드
- AudioBuffer 기반 파형 피크 생성 및 Canvas 렌더링
- 단일 트랙 Playlist UI
- 트랙 추가
- 클립 이동, 트랙 간 드래그 앤 드롭, 좌우 trim, 선택, 삭제
- play, pause, stop, playhead 표시
- 프로젝트 BPM 입력, snap grid, zoom
- source BPM 기반 playbackRate stretch
- 간단한 BPM 추정 버튼
- 트랙 volume, pan, mute, solo
- 3-band EQ, DynamicsCompressorNode 기반 컴프레서
- 프로젝트 JSON 저장/불러오기

## 제한

- JSON 저장에는 오디오 원본 바이너리가 포함되지 않습니다. 불러온 뒤 재생하려면 오디오 파일을 다시 업로드해야 합니다.
- 현재 stretch는 pitch preservation이 없는 playbackRate 방식입니다.
- BPM 추정은 MVP용 에너지 onset autocorrelation 방식이라 장르와 믹스 상태에 따라 오차가 날 수 있습니다.
- OfflineAudioContext export, IndexedDB asset 저장, 고급 warp는 다음 단계 작업입니다.
