# 음원 편집 · 믹싱 · 이펙팅 보강 — 바이브코딩 프롬프트 설계서

이 문서는 현재 `browser-daw-mvp`(Vite + React + TS + Zustand + Web Audio API) 웹앱의
**오디오 편집 / 믹싱 / 이펙팅** 기능을 단계적으로 보강하기 위해
AI 코딩 에이전트(Claude Code, Cursor 등)에 그대로 붙여넣는 **프롬프트 모음**입니다.

> 핵심 원칙
> 1. **항상 §1 공통 컨텍스트 프롬프트를 먼저 붙인 뒤**, 원하는 단계의 프롬프트를 이어 붙입니다.
> 2. 한 번에 한 단계(Step)만 실행시키고, 빌드/재생으로 검증한 뒤 다음 단계로 넘어갑니다.
> 3. 각 단계는 **수용 기준(Acceptance)** 을 통과해야 "완료"입니다.

---

## 0. 이 문서 사용법

- **복사 단위**: `§1 공통 컨텍스트` + `Step X 본문` 을 한 메시지로 묶어서 에이전트에 전달합니다.
- **실행 순서**: §6 "추천 실행 순서 & 의존성"을 따르세요. (편집 → 믹싱 계측 → 이펙트 랙 → 익스포트 순)
- **언어 규칙**: 코드 주석·UI 문자열·`commandMessage` 는 기존 코드처럼 **한국어**, 식별자는 영어를 유지합니다.
- **검증 명령**: 모든 단계 종료 시 `npm run build` 무오류 + `npm run dev` 로 실제 재생 확인.

---

## 1. 공통 컨텍스트 프롬프트 (모든 단계 앞에 필수로 붙임)

```text
너는 이 저장소의 시니어 오디오 엔지니어다. 아래 사실을 전제로 작업한다.

# 프로젝트
- browser-daw-mvp: 브라우저 DAW. Vite + React 18 + TypeScript + Zustand.
- 오디오는 전부 Web Audio API. 외부 오디오 라이브러리 없음(lucide-react 아이콘만 사용).
- 빌드: `npm run build`, 개발: `npm run dev` (vite --host 127.0.0.1).

# 파일 맵 (실제 경로)
- src/types.ts ................ 모든 도메인 타입 (Track, Clip, EqSettings, CompressorSettings,
                                DelaySettings, ReverbSettings, DawProject, AudioAsset 등)
- src/store/useDawStore.ts .... Zustand 스토어. createDefaultTrack / normalizeTrack /
                                createDefaultProject / 모든 액션. commandMessage 로 상태 토스트.
- src/audio/audioEngine.ts .... BrowserAudioEngine 싱글톤(audioEngine). ensureContext, decodeFile,
                                play(project, playhead), stop(), createTrackInput(track, bpm), 마스터 체인.
- src/audio/delay.ts .......... createDelayInsert(ctx, settings, bpm) → {input, output}
- src/audio/reverb.ts ......... createReverbInsert(ctx, settings) → {input, output}, 컨볼버+IR 생성
- src/audio/recorder.ts ....... 마이크 녹음(현재 ScriptProcessorNode 사용, deprecated)
- src/audio/bpmDetector.ts .... 에너지 onset autocorrelation BPM 추정
- src/utils/audioMath.ts ...... clamp, createId, snapTime, findClip, getClipPlaybackRate,
                                getClipTimelineDuration
- src/utils/delay.ts .......... DEFAULT_DELAY_SETTINGS, normalizeDelaySettings, getDelayTimeMs,
                                DELAY_SYNC_OPTIONS
- src/utils/reverb.ts ......... DEFAULT_REVERB_SETTINGS, normalizeReverbSettings
- src/utils/wavEncoder.ts ..... encodeWav(chunks: Float32Array[], sampleRate, channels) → Blob (16bit PCM)
- src/components/ ............. Timeline, ClipView, TransportBar, Inspector, PlaylistToolbar,
                                SpectrumAnalyzer, DelayPluginPanel, ReverbPluginPanel
- src/App.tsx ................. 레이아웃 루트

# 현재 트랙 시그널 체인 (createTrackInput에서 매 play()마다 새로 빌드)
input(gain)
  → [eq.enabled 면] 5밴드 EQ: lowshelf(110Hz) → peaking(360Hz) → peaking(1800Hz)
       → highshelf(5600Hz) → peaking(10kHz)
  → [compressor.enabled 면] DynamicsCompressorNode
  → [delay.enabled 면] createDelayInsert
  → [reverb.enabled 면] createReverbInsert
  → StereoPannerNode(pan)
  → output(gain = track.volume)
  → master(gain) → analyser(fftSize 2048) + destination

# 클립 재생 규칙 (audioEngine.play 내부)
- 클립마다 AudioBufferSourceNode 생성, playbackRate = getClipPlaybackRate(bpm, clip) (피치 보존 없는 리샘플).
- clipGain.gain.value = clip.gain 만 적용한다.
- 스케줄: when = ctx.currentTime + max(0, clip.startTime - playhead), source.start(when, offset, sourceDuration).

# 반드시 지킬 코딩 규칙
1. 한국어 UI/주석/commandMessage, 영어 식별자.
2. 새 옵션은 항상 normalize 함수로 하위호환 처리(예전 JSON 프로젝트 로드 시 누락 필드 채움).
3. 실시간 오디오 콜백 안에서는 할당/GC를 최소화한다.
4. play()에서 새로 만든 노드는 stop()에서 누수 없이 해제되어야 한다(현재 sources, trackOutputs 추적 방식 유지/확장).
5. 무거운 외부 의존성 추가는 먼저 제안하고 승인받는다. (가능하면 의존성 없이 Web Audio 기본 노드로 구현)
6. ScriptProcessorNode는 신규 코드에서 쓰지 말고 AudioWorklet을 쓴다.
7. 변경 후 `npm run build`가 통과해야 한다.

# 새 인서트 이펙트를 추가하는 표준 레시피 (이걸 "이펙트 레시피"라 부른다)
(1) src/types.ts 에 XSettings 인터페이스 정의 + Track 에 x: XSettings 필드 추가.
(2) src/utils/x.ts 에 DEFAULT_X_SETTINGS 와 normalizeXSettings(raw?) 작성.
(3) src/store/useDawStore.ts 의 createDefaultTrack 에 x: {...DEFAULT_X_SETTINGS}, normalizeTrack 에 x: normalizeXSettings(track.x) 추가.
(4) src/audio/x.ts 에 createXInsert(ctx, settings, bpm?) → {input: AudioNode, output: AudioNode} 작성.
(5) src/audio/audioEngine.ts createTrackInput 의 체인에 effectOutput.connect(insert.input); effectOutput = insert.output; 삽입(순서 주의).
(6) src/components/XPluginPanel.tsx UI 작성. DelayPluginPanel의 SVG 노브(DelayKnob) 패턴과 dly-* CSS 컨벤션 재사용.
(7) Inspector(또는 이펙트 랙)에 패널 + on/off + updateTrack 연결.
(8) 수용 기준 검증.

지금부터 아래 "작업 지시"만 수행한다. 지시에 없는 리팩터링은 하지 마라.
```

---

## 2. Track A — 편집(Editing) 보강

### Step A1. Undo / Redo 히스토리

```text
[작업 지시]
목표: 편집 액션에 대한 무제한에 가까운 Undo/Redo(Ctrl+Z / Ctrl+Shift+Z)를 추가한다.

대상 파일: src/store/useDawStore.ts, src/App.tsx(또는 TransportBar/PlaylistToolbar), 키보드 핸들러.

지시:
1. zustand 미들웨어로 히스토리를 구현한다. 외부 라이브러리(zundo) 도입 대신, tracks/audioAssets/timeMarkers/bpm/name 스냅샷만 스택에 push 하는 경량 미들웨어를 직접 작성한다.
2. 히스토리에 포함할 상태: tracks, audioAssets, timeMarkers, bpm, name. 제외할 상태: playhead, isPlaying, zoom, 선택 상태, recording, commandMessage(이런 transient 값은 히스토리에 넣지 않음).
3. past[], future[] 스택. 최대 100단계. 변이 액션 직전에 현재 스냅샷을 past에 push, future 비움.
4. undo()/redo() 액션 추가. 토스트는 commandMessage = "실행 취소" / "다시 실행".
5. 키보드: Ctrl+Z=undo, Ctrl+Shift+Z 또는 Ctrl+Y=redo. input/textarea 포커스 시 무시.
6. 연속 드래그(클립 이동/trim)는 드래그 시작 시 1회만 스냅샷(중간 프레임마다 push 금지).

수용 기준:
- 클립 추가→이동→삭제 후 Ctrl+Z 3회로 원복, Ctrl+Shift+Z로 복원.
- 재생 중에도 깨지지 않음. JSON 저장/불러오기와 충돌 없음.
- npm run build 통과.
```

### Step A2. 클립 페이드 인/아웃 **실제 적용** + 드래그 핸들 (우선순위 최상)

```text
[작업 지시]
목표: Clip.fadeIn / fadeOut 값이 지금은 재생에 전혀 반영되지 않는다. 이를 실제 게인 엔벨로프로 적용하고, 클립 위에서 드래그로 페이드 길이를 조절하는 핸들을 만든다.

근거: src/audio/audioEngine.ts play()는 clipGain.gain.value = clip.gain 만 설정하고 fadeIn/fadeOut을 무시한다.

대상 파일: src/audio/audioEngine.ts, src/components/ClipView.tsx, src/store/useDawStore.ts, src/types.ts.

지시:
1. types.ts Clip 에 fadeCurve?: "linear" | "equalPower" 추가(normalize에서 기본 "equalPower").
2. audioEngine.play()에서 각 클립 재생 시 clipGain.gain 을 시간 예약한다.
   - when = 재생 시작 시각, dur = 타임라인상 들리는 길이.
   - fadeIn>0: gain.setValueAtTime(0.0001, when) 후 fadeCurve에 따라 linear=linearRampToValueAtTime, equalPower=setValueCurveAtTime(곡선 배열)로 clip.gain까지 fadeIn초 동안 상승.
   - fadeOut>0: 끝나기 fadeOut초 전부터 clip.gain → 0.0001로 하강.
   - 단, 이미 재생 중간부터 시작(offset>0)하는 경우 fadeIn 잔여 구간만 적용.
3. ClipView.tsx: 클립 좌상단/우상단에 작은 삼각형 핸들을 그리고, 드래그로 fadeIn/fadeOut(초)을 조절. updateClip(clipId, { fadeIn|fadeOut }). 파형 위에 페이드 모양(삼각형 오버레이)을 캔버스로 시각화.
4. fade 최대값은 클립 길이의 절반으로 clamp.

수용 기준:
- 페이드 인 1초 준 클립 재생 시 첫 1초간 자연스럽게 볼륨이 차오른다(귀로 확인).
- 핸들 드래그로 페이드 길이가 바뀌고 파형 위 삼각형이 따라온다.
- 저장→불러오기 후에도 fade 유지.
```

### Step A3. 복사/붙여넣기/복제 + 플레이헤드 분할 단축키

```text
[작업 지시]
목표: 클립 클립보드(복사/잘라내기/붙여넣기/복제)와 플레이헤드 위치 분할 단축키를 추가한다.

대상 파일: src/store/useDawStore.ts, 키보드 핸들러.

지시:
1. 스토어에 clipboard: Clip[] 상태와 copySelected/cutSelected/pasteAtPlayhead/duplicateSelected 액션 추가.
2. copy: selectedClipIds의 클립을 deep clone하여 clipboard에 저장(상대 startTime 유지를 위해 최소 startTime 기준 오프셋 보관).
3. paste: 현재 selectedTrackId(없으면 첫 트랙)에 playhead를 기준으로 붙여넣기. 새 id는 createId("clip"). 붙인 클립을 선택.
4. duplicate: 선택 클립을 같은 트랙에 클립 길이만큼 오른쪽으로 복제.
5. 기존 sliceClipAt(clipId, splitTime)를 활용해, 단축키 S 또는 Ctrl+E 로 "플레이헤드와 겹치는 선택 클립을 playhead에서 분할" 액션 splitSelectedAtPlayhead 추가.
6. 단축키: Ctrl+C/Ctrl+X/Ctrl+V/Ctrl+D, 분할 S. input 포커스 시 무시. commandMessage로 결과 토스트.

수용 기준: 멀티 클립 복사→다른 트랙/위치 붙여넣기 정상, 상대 간격 유지, 분할 단축키로 playhead에서 두 조각으로 분리.
```

### Step A4. 피치 보존 타임스트레치 (AudioWorklet)

```text
[작업 지시]
목표: 현재 BPM 변경 시 playbackRate 리샘플이라 피치가 같이 변한다. 피치를 유지한 채 템포만 늘리고 줄이는 옵션을 추가한다.

대상 파일: src/types.ts, src/audio/, 새 worklet 파일, src/audio/audioEngine.ts.

지시:
1. 의존성 결정: 먼저 두 옵션을 비교 제안하고 승인받는다.
   (A) soundtouchjs(WASM 아님, 순수 JS, 가벼움) (B) @echogarden/rubberband-wasm(고품질, 무겁다).
   기본 권장은 (A) soundtouchjs + AudioWorklet 조합.
2. types.ts: StretchMode 에 "stretch"(피치보존) 추가. Clip 에 semitoneShift?: number(기본 0) 필드 추가는 Step A5에서.
3. AudioWorkletProcessor를 만들어 SoundTouch를 래핑. createTrackInput 또는 클립 소스 생성부에서, clip.stretchMode === "stretch" 인 경우 BufferSource 대신 worklet 경유로 재생.
4. 실시간 재생이 어려우면, 대안으로 "오프라인 사전 렌더" 방식 허용: 클립 배치 시 목표 비율로 한 번 stretch한 새 AudioBuffer를 캐시(clip.stretchedBufferId)하고 재생은 그 버퍼로. 이 방식이면 AudioWorklet 없이도 가능.
5. Inspector에 클립별 stretchMode 토글(resample / stretch) 추가.

수용 기준: 90→140 BPM로 늘려도 피치가 유지된다(귀 확인). resample 모드와 토글 비교 가능. build 통과.
주의: 무거운 라이브러리이므로 코드 스플리팅(동적 import)로 필요 시에만 로드.
```

### Step A5. 클립 단위 파괴적 편집 (정규화·리버스·게인·무음 트림·피치 시프트)

```text
[작업 지시]
목표: 선택 클립에 대해 비실시간(렌더링) 편집 연산을 적용하는 "클립 처리" 메뉴를 만든다.

대상 파일: src/audio/(새 clipProcessing.ts), src/store/useDawStore.ts, Inspector.tsx, types.ts.

지시:
1. src/audio/clipProcessing.ts 에 순수 함수들 작성(입력 AudioBuffer → 출력 AudioBuffer):
   - normalizeBuffer(buffer, targetDb = -1): 피크를 목표 dBFS로 정규화.
   - reverseBuffer(buffer): 샘플 역순.
   - applyGainDb(buffer, db): 게인 적용.
   - trimSilence(buffer, thresholdDb = -50): 앞뒤 무음 제거.
   - pitchShiftSemitones(buffer, semitones): OfflineAudioContext + playbackRate 또는 soundtouch로 피치만 이동(길이 유지 옵션).
2. 처리 결과는 새 AudioAsset + AudioBuffer로 등록(audioEngine.registerBuffer), 클립의 audioBufferId/duration 갱신. 원본은 보존(비파괴 워크플로우).
3. Inspector에 "정규화 / 리버스 / 무음 제거 / +1 반음 / -1 반음" 버튼. undo(A1)와 호환.

수용 기준: 각 연산 적용 후 파형/재생이 즉시 반영되고 Ctrl+Z로 원복. build 통과.
```

---

## 3. Track B — 믹싱(Mixing) 보강

### Step B1. 마스터 + 트랙별 미터링 (Peak / RMS, dB)

```text
[작업 지시]
목표: 마스터와 각 트랙에 실시간 레벨 미터(peak + RMS, dBFS 눈금, 클리핑 표시)를 추가한다.

근거: 마스터엔 analyser가 있지만 트랙별 미터/숫자 dB 표시가 없다(PHASES Phase4 미완).

대상 파일: src/audio/audioEngine.ts, 새 src/components/LevelMeter.tsx, Inspector/믹서 UI.

지시:
1. audioEngine: 각 트랙 output 직후에 트랙별 AnalyserNode(또는 가벼운 RMS 측정용 AudioWorklet meter)를 연결하고, trackId→analyser 맵을 노출하는 getTrackAnalyser(trackId) 추가. play()마다 재생성되므로 맵을 stop()에서 정리.
2. 마스터 analyser도 getMasterAnalyser()로 노출(이미 analyser 존재).
3. LevelMeter.tsx: requestAnimationFrame 루프로 getFloatTimeDomainData를 읽어 peak/RMS 계산 → 세로 바 + peak-hold + 클립 LED(>0dBFS 시 빨강 유지). dB 변환 20*log10.
4. 믹서/Inspector에 트랙별 미터, 트랜스포트 근처에 마스터 미터 배치.
5. 성능: 미터 1개당 rAF 하나가 아니라 단일 rAF에서 모든 미터를 갱신.

수용 기준: 재생 시 신호 있는 트랙만 미터가 움직이고, 솔로/뮤트와 일치. 0dB 초과 시 클립 LED. CPU 과부하 없음.
```

### Step B2. 마스터 버스 체인 (마스터 EQ + 리미터)

```text
[작업 지시]
목표: 마스터 출력 직전에 마스터 EQ와 브릭월 리미터를 두어 최종 음량/톤을 다듬는다.

대상 파일: src/types.ts(DawProject에 masterChain 추가), src/store(기본값/normalize), src/audio/audioEngine.ts.

지시:
1. types.ts: MasterChainSettings { eqEnabled, lowGain, midGain, highGain, limiterEnabled, ceilingDb, lookaheadMs } 정의. DawProject.masterChain 추가. createDefaultProject/importProject에 normalize.
2. audioEngine.ensureContext: master(gain) → [마스터 EQ 3밴드] → [리미터] → analyser/destination 순으로 재구성. 리미터는 DynamicsCompressorNode를 ratio 20, threshold≈ceilingDb, knee 0, attack 0.001, release 0.05로 브릭월 근사(또는 AudioWorklet 트루피크 리미터, 무거우면 후순위).
3. 마스터 체인 파라미터 변경 시 즉시 노드에 반영(재생 중에도). setMasterChain 액션.
4. TransportBar/마스터 영역에 간단한 마스터 EQ/리미터 UI.

수용 기준: 리미터 ON 시 마스터 미터(B1)가 ceiling 위로 안 넘어감. 마스터 EQ 변화가 즉시 들림. 저장/불러오기 round-trip OK.
```

### Step B3. 센드 / 리턴(Aux) 버스 — 공유 리버브/딜레이

```text
[작업 지시]
목표: 트랙마다 리버브/딜레이를 중복 생성하는 대신, 공유 Aux 버스(예: Reverb Send, Delay Send)로 보내는 센드/리턴 구조를 만든다.

대상 파일: src/types.ts, src/store, src/audio/audioEngine.ts.

지시:
1. types.ts: DawProject.auxBuses: AuxBus[] (id, name, kind: "reverb"|"delay", settings). Track 에 sends: { auxId: string; amount: number }[] 추가. normalize로 하위호환.
2. audioEngine: 각 Aux 버스를 play() 시 1개만 생성(createReverbInsert/createDelayInsert 재사용, dry=0 wet=1). 트랙 output 분기에서 sendGain(amount) → aux.input. aux.output → master.
3. 센드는 post-fader(트랙 볼륨 이후) 기본, 옵션으로 pre-fader.
4. Inspector에 트랙별 센드량 노브, 별도 패널에서 Aux 버스 추가/삭제 및 버스 이펙트 설정.

수용 기준: 두 트랙을 같은 리버브 버스로 보내면 하나의 공간감으로 묶임. 센드량 0이면 드라이. CPU가 트랙수×리버브가 아니라 버스 수에 비례.
```

### Step B4. 오토메이션 레인 (볼륨/팬/파라미터 시간축 자동화)

```text
[작업 지시]
목표: 트랙 볼륨·팬·임의 이펙트 파라미터를 시간에 따라 변화시키는 오토메이션 레인을 추가한다.

대상 파일: src/types.ts, src/store, src/audio/audioEngine.ts, Timeline.tsx(레인 렌더), 새 AutomationLane.tsx.

지시:
1. types.ts: AutomationPoint { time: number; value: number }. AutomationLane { id; targetTrackId; param: "volume"|"pan"|"eq.bassGain"|... ; points: AutomationPoint[]; enabled }. DawProject.automationLanes 추가.
2. audioEngine.play(): 각 enabled 레인에 대해 대상 AudioParam에 setValueCurveAtTime 또는 점들 사이 linearRampToValueAtTime로 playhead 기준 스케줄링.
3. Timeline에 트랙 아래 접히는 오토메이션 레인. 클릭으로 점 추가/드래그/삭제, 선 그래프 렌더(캔버스).
4. 우선 volume/pan부터 지원, 그다음 EQ/딜레이 wet 등 일반 param 경로 지원.

수용 기준: 볼륨 오토메이션으로 페이드/덕킹이 재생에 반영됨. 점 편집 즉시 반영(재생 재시작 시). 저장/불러오기 OK.
주의: 현재 엔진은 play()마다 그래프를 새로 빌드하므로, 재생 중 실시간 편집 반영은 "정지 후 재생"으로 충분. 실시간 반영이 필요하면 별도 단계로 persistent graph 리팩터를 제안하라.
```

### Step B5. 사이드체인 컴프레션 (덕킹)

```text
[작업 지시]
목표: 특정 트랙(예: 킥/반주)의 신호로 다른 트랙(예: 패드/보컬)을 덕킹하는 사이드체인 컴프레서를 추가한다.

대상 파일: src/types.ts, src/audio/audioEngine.ts, Inspector.

지시:
1. types.ts: Track.sidechain { enabled; sourceTrackId; amount; attackMs; releaseMs; threshold }.
2. 구현 방식 선택(둘 중 제안):
   (A) 진짜 사이드체인: AudioWorklet 엔벨로프 팔로워로 source RMS를 추출해 target gain을 modulation.
   (B) 근사: source 트랙의 클립 위치에 맞춰 target에 주기적 게인 오토메이션(B4 재사용)으로 펌핑 생성.
   먼저 (A) 권장, 난이도 높으면 (B)로 폴백.
3. Inspector에 사이드체인 소스 선택 + amount/attack/release 노브.

수용 기준: 소스 트랙이 칠 때마다 타깃 볼륨이 눌렸다 회복하는 펌핑이 들린다.
```

---

## 4. Track C — 이펙팅(Effecting) 보강

### Step C1. 이펙트 랙 UI — 순서 변경 / 바이패스 / Wet·Dry / 프리셋

```text
[작업 지시]
목표: 트랙의 인서트들(EQ, Comp, Delay, Reverb, 신규 이펙트)을 하나의 "이펙트 랙"에서 켜고/끄고/순서 바꾸고/프리셋 저장하게 만든다.

대상 파일: src/types.ts, src/store, src/audio/audioEngine.ts, 새 EffectRack.tsx, Inspector.

지시:
1. types.ts: Track.effectChain: EffectSlot[] ( { id; type: "eq"|"comp"|"delay"|"reverb"|...; enabled } ). 순서가 곧 시그널 체인 순서. 기존 개별 settings는 유지하되 체인 순서는 effectChain이 결정. normalize로 기존 트랙은 [eq,comp,delay,reverb] 기본 순서 생성.
2. audioEngine.createTrackInput: 하드코딩된 순서 대신 track.effectChain를 순회하며 enabled 슬롯만 연결하도록 리팩터(각 type→insert 빌더 매핑).
3. EffectRack.tsx: 세로 카드 리스트. 드래그로 순서 변경, 카드별 on/off, 클릭 시 해당 플러그인 패널(DelayPluginPanel 등) 펼침.
4. 프리셋: 트랙 전체 effectChain+settings를 JSON으로 export/import(localStorage 슬롯 + 파일).

수용 기준: 딜레이를 리버브 앞/뒤로 옮기면 소리가 달라지고, 카드 끄면 우회. 프리셋 저장→다른 트랙에 로드 동작. build 통과.
```

### Step C2-a. 신규 인서트: 새추레이션 / 디스토션

```text
[작업 지시]
목표: 트랙에 사용할 새추레이션(따뜻한 배음) 인서트를 "이펙트 레시피"대로 추가한다.

지시:
1. 공통 컨텍스트의 "이펙트 레시피" 1~8단계를 따른다. 이펙트명 saturation.
2. SaturationSettings { enabled; drive(0-1); mix(0-1); tone(0-1, post lowpass); type: "tape"|"tube"|"hard" }.
3. createSaturationInsert: input → dry/wet split. wet 경로 = preGain(drive) → WaveShaperNode(타입별 curve: tanh/soft-clip/hard-clip, oversample "4x") → toneLowpass → wet. mix로 dry/wet 블렌드. 출력 레벨 보정(makeup) 포함.
4. SaturationPluginPanel: DelayKnob 패턴 노브 4개(DRIVE/MIX/TONE) + 타입 셀렉터.

수용 기준: drive를 올리면 배음이 풍부해지고 클리핑 없이 따뜻해진다. mix 0이면 원음.
```

### Step C2-b. 신규 인서트: 코러스 / 플랜저 / 페이저 (모듈레이션)

```text
[작업 지시]
목표: LFO 기반 모듈레이션 이펙트 1종(코러스 우선)을 이펙트 레시피대로 추가하고, mode로 chorus/flanger/phaser 전환.

지시:
1. 이펙트 레시피 1~8단계. 이펙트명 modulation.
2. ModulationSettings { enabled; mode: "chorus"|"flanger"|"phaser"; rateHz; depth; feedback; mix; stereo }.
3. chorus/flanger: DelayNode + OscillatorNode(LFO) → delayTime 모듈레이션. flanger는 짧은 딜레이(1-5ms)+feedback, chorus는 15-35ms+낮은 feedback. 스테레오는 L/R LFO 위상 차.
   phaser: 직렬 allpass BiquadFilter 4-8개의 frequency를 LFO로 스윕.
4. ModulationPluginPanel: mode 셀렉터 + RATE/DEPTH/FEEDBACK/MIX 노브.

수용 기준: chorus에서 풍성한 더블링, flanger에서 제트 스윕, phaser에서 휘젓는 노치가 들린다.
```

### Step C2-c. 신규 인서트: 노이즈 게이트 + 디에서

```text
[작업 지시]
목표: 보컬/녹음 트랙용 노이즈 게이트와 디에서(de-esser)를 추가한다.

지시:
1. 이펙트 레시피 적용. 이펙트명 gate, deesser(둘 다 별도 슬롯).
2. NoiseGate: AudioWorklet 엔벨로프 게이트(threshold/attack/hold/release/range). threshold 이하 신호를 range만큼 감쇠.
3. DeEsser: 사이드체인 형태. 6-9kHz 대역을 bandpass로 검출 → 그 대역만 동적 감쇠(splitter로 고역 분리 후 comp, 또는 dynamic peaking). frequency/threshold/amount.
4. 각각 PluginPanel(노브 + 검출 대역 표시).

수용 기준: 게이트로 무음 구간 잡음이 사라지고, 디에서로 치찰음('스/시')이 부드러워진다.
```

### Step C3. 파라메트릭 EQ + 스펙트럼 오버레이 (기존 5밴드 시각화 강화)

```text
[작업 지시]
목표: 현재 고정 5밴드 EQ를 그래프로 시각화하고, 드래그 가능한 밴드 + 실시간 스펙트럼 오버레이를 제공한다.

대상 파일: src/types.ts(EqSettings 확장 옵션), 새 ParametricEq.tsx, SpectrumAnalyzer 재사용, audioEngine.

지시:
1. EqSettings에 밴드별 freq/Q를 노출하는 확장 필드(선택). 기본값은 현재 110/360/1800/5600/10000Hz, Q값 유지. normalize 하위호환.
2. ParametricEq.tsx: 가로 주파수(로그), 세로 게인(dB). 각 밴드를 드래그 노드로 표시(상하=게인, 좌우=freq, 휠=Q). 합성 EQ 곡선을 캔버스로 렌더.
3. 동일 캔버스 위에 해당 트랙 analyser(B1) FFT 스펙트럼을 반투명 오버레이.
4. createTrackInput의 EQ 노드 frequency/Q/gain을 확장 필드로부터 설정.

수용 기준: 노드를 끌면 곡선과 소리가 같이 변하고, 뒤에 스펙트럼이 실시간으로 흐른다.
```

### Step C4. 컨볼루션 리버브 IR 업로드

```text
[작업 지시]
목표: 현재 합성 IR 리버브에 더해, 사용자가 실제 임펄스 응답(.wav) 파일을 올려 컨볼루션 리버브로 쓰게 한다.

대상 파일: src/types.ts(ReverbSettings에 irAssetId?), src/audio/reverb.ts, ReverbPluginPanel.tsx, store.

지시:
1. ReverbSettings.mode 에 "convolution" 추가, irAssetId?: string. normalize 하위호환.
2. reverb.ts createReverbInsert: mode==="convolution" 이고 irAssetId가 있으면 audioEngine.getBuffer(irAssetId)를 convolver.buffer로 사용, 없으면 기존 합성 IR.
3. ReverbPluginPanel에 "IR 불러오기" 버튼(decodeFile 재사용 → AudioAsset 등록). 현재 IR 파일명 표시 + 초기화.

수용 기준: IR 업로드 후 그 공간의 리버브가 적용된다. mode 전환으로 합성/컨볼루션 비교 가능. 저장/불러오기 시 irAssetId 보존(원본 바이너리는 재업로드 필요 — README 제한과 동일).
```

### Step C5. 이펙트 프리셋 라이브러리

```text
[작업 지시]
목표: 개별 이펙트(딜레이/리버브/새추레이션 등)별 프리셋을 저장/불러오기하고 기본 팩토리 프리셋을 제공한다.

대상 파일: 새 src/utils/presets.ts, 각 PluginPanel, localStorage.

지시:
1. presets.ts: savePreset(kind, name, settings), listPresets(kind), loadPreset(kind, name), deletePreset. 저장소는 localStorage(키 daw.presets.{kind}). 팩토리 프리셋 상수 포함(예: Delay "Slapback","Dotted 1/8","Ambient"; Reverb "Vocal Plate","Drum Room","Cathedral").
2. 각 PluginPanel 헤더에 프리셋 드롭다운(불러오기) + 저장 버튼 + 삭제.
3. 프리셋 로드 시 onChange로 전체 settings 패치.

수용 기준: 노브를 맞춘 뒤 "내 프리셋" 저장→다른 트랙에서 로드, 팩토리 프리셋 선택 즉시 반영.
```

---

## 5. Track D — 익스포트 / 렌더 & 인프라

### Step D1. OfflineAudioContext 믹스다운 → WAV 익스포트 (최우선 익스포트)

```text
[작업 지시]
목표: 전체 프로젝트를 OfflineAudioContext로 오프라인 렌더해 WAV로 내보낸다. 기존 시그널 체인을 그대로 재사용한다.

근거: 현재 OfflineAudioContext export 미구현(PHASES Phase5). wavEncoder는 이미 있으나 16bit mono PCM 인코더이므로 스테레오/멀티채널 확장 필요.

대상 파일: 새 src/audio/exporter.ts, src/utils/wavEncoder.ts(스테레오 지원), TransportBar(내보내기 버튼).

지시:
1. createTrackInput / createDelayInsert / createReverbInsert가 OfflineAudioContext에서도 동작하도록, audioEngine에서 컨텍스트를 인자로 받는 buildGraph(context, project, options) 형태로 일반화(실시간/오프라인 공용).
2. exporter.ts renderProjectToWav(project): 프로젝트 길이 계산 → OfflineAudioContext(2ch, sampleRate, length) 생성 → 그래프 빌드 → startRendering() → AudioBuffer → encodeWav(스테레오, 인터리브).
3. wavEncoder: channels=2일 때 인터리브 16bit(추가로 24bit 옵션 가능) 지원하도록 확장.
4. TransportBar에 "WAV 내보내기" 버튼 + 진행률 표시(렌더는 보통 빠르지만 긴 곡 대비 스피너/퍼센트).
5. 다운로드는 Blob URL → a[download].

수용 기준: 재생과 동일한 믹스(볼륨/팬/EQ/이펙트/페이드 포함)가 WAV로 저장되고 외부 플레이어에서 동일하게 들린다.
```

### Step D2. 스템(트랙별) 익스포트

```text
[작업 지시]
목표: 각 트랙을 개별 WAV(스템)로 내보낸다.

대상 파일: src/audio/exporter.ts, UI.

지시:
1. renderTrackToWav(project, trackId): 해당 트랙만 활성화(나머지 뮤트)한 임시 프로젝트로 D1 렌더 재사용.
2. "스템 일괄 내보내기"는 트랙 수만큼 순차 렌더 후 각 WAV 다운로드(또는 zip — JSZip 도입은 승인 후).
3. 진행률(트랙 i/n) 표시.

수용 기준: 트랙별 WAV가 솔로 재생과 동일. 마스터 합과 정합.
```

### Step D3. MP3 익스포트 (선택)

```text
[작업 지시]
목표: WAV 외에 MP3 내보내기를 추가한다.

지시:
1. 의존성 비교 제안: lamejs(가벼움, MP3만) vs @ffmpeg/ffmpeg(무겁지만 다포맷). 기본 권장 lamejs.
2. D1의 렌더 결과 AudioBuffer를 lamejs로 인코딩(스테레오, 비트레이트 선택 128/192/320).
3. 동적 import로 필요 시에만 로드. 내보내기 다이얼로그에 포맷(WAV/MP3)+비트레이트 선택.

수용 기준: MP3가 정상 재생되고 길이/피치 정확.
```

### Step D4. IndexedDB 오디오 에셋 영속화

```text
[작업 지시]
목표: 프로젝트 저장 시 오디오 원본 바이너리도 IndexedDB에 저장해, 다시 불러올 때 재업로드 없이 재생되게 한다.

근거: 현재 JSON에는 오디오가 없어 불러온 뒤 재업로드 필요(README 제한).

대상 파일: 새 src/utils/assetStore.ts(IndexedDB 래퍼), store import/export, audioEngine.

지시:
1. assetStore.ts: idb 없이 표준 IndexedDB로 putAsset(id, Blob), getAsset(id), deleteAsset, listAssets.
2. 파일 업로드/녹음 시 원본 Blob을 assetStore에 저장하고 AudioAsset.id와 매핑.
3. 프로젝트 불러오기 시 audioAssets의 각 id로 Blob을 읽어 decodeBlob→registerBuffer 자동 복구. 없으면 기존처럼 재업로드 안내.
4. 용량/정리: "사용 안 하는 에셋 정리" 액션.

수용 기준: 새로고침/재방문 후 프로젝트 불러오면 재업로드 없이 즉시 재생.
```

### Step E1. AudioWorklet 마이그레이션 (녹음 · 미터)

```text
[작업 지시]
목표: deprecated ScriptProcessorNode(recorder.ts)를 AudioWorklet으로 교체하고, 미터/엔벨로프도 워클릿으로 통일한다.

대상 파일: src/audio/recorder.ts, 새 worklet 파일들, audioEngine.

지시:
1. recorder-processor worklet: 입력을 받아 Float32 청크를 메인 스레드로 postMessage(transferable). 기존 onPeaks 콜백/encodeWav 흐름 유지.
2. ensureContext에서 audioWorklet.addModule 로드(1회). 모듈 로드 실패 시 ScriptProcessor 폴백 유지(구브라우저).
3. 모니터링 게인 경로 동일 유지.

수용 기준: 녹음 품질/지연이 기존과 동등 이상, 콘솔 deprecation 경고 제거.
```

### Step E2. 메트로놈 실제 클릭음

```text
[작업 지시]
목표: RecordingState.metronomeEnabled / countInBeats 가 실제 클릭 사운드를 내도록 구현한다(현재 플래그만 존재).

대상 파일: src/audio/(새 metronome.ts), 녹음/재생 시작부.

지시:
1. metronome.ts: project.bpm 기준 박자마다 OscillatorNode 짧은 클릭(다운비트 강조 고음). lookahead 스케줄러(setInterval + ctx.currentTime 예약)로 안정적 타이밍.
2. count-in: 녹음 시작 전 countInBeats만큼 클릭 후 녹음 시작.
3. 재생 중에도 metronomeEnabled면 클릭 재생 옵션.

수용 기준: BPM과 정확히 맞는 클릭, 다운비트 강조, count-in 후 녹음 시작.
```

---

## 6. 추천 실행 순서 & 의존성

권장 순서(앞 단계가 뒤 단계의 토대):

1. **A2 페이드 실제 적용** — 가장 눈에 띄는 버그성 갭(타입엔 있는데 미적용). 가장 먼저.
2. **A1 Undo/Redo** — 이후 모든 파괴적 편집의 안전망.
3. **B1 미터링** — 믹싱/리미터/사이드체인 작업 시 시각 피드백 필수 선행.
4. **C1 이펙트 랙 리팩터** — 이후 신규 이펙트(C2*) 추가의 토대(체인 순서 일반화).
5. **C2-a/b/c 신규 인서트** — 랙 위에서 하나씩.
6. **B2 마스터 리미터 → D1 WAV 익스포트** — 믹스 완성 후 내보내기. D1은 그래프 일반화(buildGraph)를 만들므로 B/C 안정화 후가 안전.
7. **A3/A4/A5 편집 심화, B3/B4/B5 믹싱 심화** — 필요에 따라.
8. **D2~D4, E1~E2** — 인프라/품질.

의존성 메모:
- **D1**은 `createTrackInput`을 `buildGraph(context, ...)`로 일반화해야 하므로, **C1**(체인 순서 effectChain화) 이후에 하면 리팩터가 한 번에 끝남.
- **B4 오토메이션 / B5 사이드체인 / C3 스펙트럼**은 **B1 analyser 노출**에 의존.
- **A4 타임스트레치 / D3 mp3**는 외부 의존성 도입 → 반드시 사전 승인.

---

## 7. 단계 프롬프트 빈 템플릿 (새 기능 추가 시 복사)

```text
[작업 지시]
목표: <한 문장>
근거/현재갭: <어느 파일 어느 동작이 비어있는지 — 예: audioEngine.play()가 X를 무시함>
대상 파일: <경로 나열>
지시:
1. types.ts 변경: <인터페이스/필드> + normalize 하위호환.
2. 오디오 그래프: createTrackInput/insert <어디에 어떤 노드> 삽입(순서 명시).
3. store: createDefaultTrack/normalizeTrack/액션 <무엇>.
4. UI: <패널/노브/단축키> — DelayPluginPanel 노브 + dly-* CSS 컨벤션 재사용.
5. cleanup: play()에서 만든 노드는 stop()에서 해제.
수용 기준:
- <귀로 확인할 것>
- <저장/불러오기 round-trip>
- npm run build 통과.
제약: 지시에 없는 리팩터 금지. 무거운 의존성은 먼저 제안.
```

---

### 부록 — 현재 코드에서 확인된 "보강 포인트" 요약

| 영역 | 현재 상태 | 갭 / 기회 |
|---|---|---|
| 클립 페이드 | 타입에 `fadeIn/fadeOut` 존재 | **재생에 미적용** (A2) |
| Undo/Redo | 없음 | 편집 안전망 부재 (A1) |
| 타임스트레치 | `playbackRate` 리샘플 | 피치 보존 없음 (A4) |
| 트랙 미터 | 마스터 analyser만 | 트랙별/마스터 미터 UI 없음 (B1) |
| 마스터 버스 | gain만 | 마스터 EQ/리미터 없음 (B2) |
| 이펙트 순서 | `createTrackInput` 하드코딩 | 순서변경/바이패스 랙 없음 (C1) |
| 이펙트 종류 | EQ/Comp/Delay/Reverb | 새추레이션/모듈/게이트/디에서 없음 (C2) |
| 센드/리턴 | 없음(트랙마다 중복) | Aux 버스 없음 (B3) |
| 오토메이션 | 없음 | 시간축 자동화 없음 (B4) |
| 익스포트 | 없음 | OfflineAudioContext WAV/스템/MP3 (D1~D3) |
| 에셋 영속화 | JSON에 오디오 미포함 | IndexedDB 저장 (D4) |
| 오디오 처리 노드 | `ScriptProcessorNode`(deprecated) | AudioWorklet 이전 (E1) |
| 메트로놈 | 플래그만 존재 | 실제 클릭음 없음 (E2) |
```
