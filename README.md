# 반주 디자이너 2

> 공식 주소: **(확정 전)** — Vercel 프로젝트를 연결한 뒤 이 줄에 하나만 적습니다. ([결정 0001](docs/decisions/0001-official-url.md), [운영 설정 체크리스트](docs/ops-checklist.md))

## 무엇인가

브라우저에서 반주 음원을 자르고 섞고, 노래를 녹음하는 음악 수업용 편집기입니다. 설치 없이 크롬에서 열어 쓰고, 작업은 브라우저에 자동으로 저장됩니다.

## 주요 기능

- **음원 올리기**: mp3, wav, m4a 등 브라우저가 읽을 수 있는 오디오. 올린 음원은 선택한 트랙(없으면 첫 트랙)의 그 자리가 비어 있으면 그 트랙에, 다른 클립과 겹치면 새 트랙에 놓입니다(템포 맞춤으로 빨라지거나 느려진 클립은 그 길이로 판단). 여러 파일은 하나씩 차례로 놓습니다. 올리면 파형이 보입니다. 파형은 별도 작업 스레드에서 단계별(256·1,024·4,096·16,384 샘플 묶음)로 계산해 브라우저에 기억해 두므로, 1시간 음원도 화면이 멈추지 않고 확대·축소에 맞는 파형이 그려집니다.
- **여러 트랙 타임라인**: 클립 이동(트랙 사이 이동 포함), 양쪽 끝 자르기, 가르기, 복사·붙여넣기, 삭제(실행 취소로 복원). 트랙 추가·삭제·순서 변경.
- **기본 편집**: 재생선에서 자르기(Ctrl+E: 고른 클립, 고른 것이 없으면 재생선이 지나는 모든 클립) · 복제(Ctrl+D: 고른 클립 전체를 바로 뒤에) · 복사·붙여넣기(Ctrl+C·V: 트랙 사이 간격을 지키고, 아래 트랙이 모자라면 새 트랙을 만듦) · 여러 클립과 같은 그룹의 클립 함께 옮기기(하나를 끌면 모두 같은 시간·같은 트랙 칸만큼 움직임) · 음원 파일을 타임라인에 끌어다 놓기(놓은 트랙·시간에 스냅을 적용해 놓고, 트랙 아래 빈 곳이면 새 트랙). 한 번 한 편집은 실행 취소 한 번에 돌아옵니다. 박자표는 상단 막대에서 2/4·3/4·4/4·6/8 중에 고르며 눈금자의 마디 번호, "마디" 스냅, 녹음 메트로놈의 강박(마디 첫 박), 카운트인 선택지가 따라 바뀝니다(템포는 계속 4분음표 기준).
- **우클릭 메뉴와 삭제 안전장치**: 클립을 우클릭(터치는 0.5초 길게 누르기)하면 재생선에서 자르기·복제·복사·음소거 전환·이름 바꾸기·그룹 해제·삭제 메뉴가, 트랙 머리를 우클릭하면 이름 바꾸기·위로·아래로·삭제 메뉴가 뜹니다. 메뉴는 위·아래 화살표·Home·End로 항목을 옮기고 Enter로 고르며, Esc나 바깥 클릭으로 닫히고, 화면 가장자리에서는 안쪽으로 자리를 옮깁니다. 클립을 지우면 5초 동안 [되돌리기]가 붙은 안내가 뜨고(그 사이에 다른 편집을 했다면 엉뚱한 편집을 되돌리지 않도록 그 삭제만은 되돌릴 수 없다고 알려 줍니다), 확인창은 클립이 든 트랙을 지울 때만 뜹니다.
- **템포 맞추기**: 프로젝트 BPM, 박자 맞춤(스냅: 마디·박·1/2박·1/4박·없음 중에 고르며 처음은 1/2박. 다섯 개의 간격이 모두 다르고 로컬·글로벌 구분은 없음), 확대·축소(1~1,000픽셀/초, 긴 곡은 "전체 보기"(시프트+0)까지 더 줄어듦), 원본 BPM 감지(별도 작업 스레드에서 계산하고 진행률을 보이며 취소할 수 있음, 절반·두 배로 잘못 나오면 ×½·×2로 고침, 결과는 확인한 뒤 클립 또는 프로젝트에 적용), "템포 맞춤"(클립을 프로젝트 템포에 맞춰 빠르게·느리게 재생. 지금은 속도와 음정이 함께 바뀌며 배속 옆에 음정 변화를 반음으로 보임, 처음 켤 때 한 번 안내). 클립 게인과 마스터 볼륨은 슬라이더 옆 숫자 칸에 값을 직접 입력할 수 있습니다.
- **믹싱**: 트랙 볼륨·팬·뮤트·솔로, 이펙트(5밴드 EQ, 컴프레서, 딜레이, 리버브), 레벨 미터와 스펙트럼. 컴프레서의 바늘은 노브가 아니라 지금 실제로 줄이고 있는 음량을 따라 움직이며(재생 중에만, −20 dB가 끝) 멈추면 제자리(0)로 돌아옵니다. 노브는 모두 같은 부품이라 같은 방식으로 움직입니다: 위로 끌면 올라가고(180px이 전체 범위, Shift를 누르면 1/10), 키보드로는 ←↓ 한 칸 내림 · →↑ 한 칸 올림 · PageUp·PageDown 열 칸 · Home·End 끝값, 더블클릭은 기본값, 값 글자를 누르거나 노브에서 Enter를 누르면 숫자로 직접 입력합니다(Enter 확정 · Esc 취소 · 범위를 넘으면 끝값으로). 주파수 노브(리버브 고음·저음 차단, 딜레이 고음 컷)는 로그 눈금입니다. 트랙 볼륨·모니터 볼륨·잔향 길이 슬라이더도 숫자로 입력할 수 있습니다.
- **녹음**: 마이크 녹음, 카운트인(없음·1박·2박·1마디·2마디: 박자표에 맞춰 클릭 수가 달라짐)·메트로놈(마디 첫 박만 강박), 입력 모니터링. 장치 지연을 자동으로 맞추고, 어긋나면 "지연 보정(ms)"(−200~+200)으로 직접 맞춥니다. 녹음 중에는 임시 파형만 보이고, 끝나면 클립이 한 번에 생겨 실행 취소 한 번으로 지워집니다.
- **실행 취소·다시 실행**: Ctrl+Z(맥은 ⌘Z) · Ctrl+Shift+Z · Ctrl+Y, 200단계까지. 끌기(노브·슬라이더·클립 옮기기·다듬기·페이드·복사본 놓기)는 누름부터 뗌까지 한 단계, 이름 입력은 칸에 들어가서 나올 때까지 한 단계입니다. 키보드로 같은 값을 이어서 고치면(노브를 ↑로 5번 등) 마지막 입력 뒤 0.8초까지 한 단계로 묶이고, 음소거·켜기처럼 켜고 끄는 조작은 누를 때마다 한 단계입니다. 마우스를 놓친 채(창 밖에서 놓기·탭 전환) 끌기가 안 끝난 것처럼 되어도 편집이 2초 멈추면 묶음이 끝나 다음 편집은 새 단계가 됩니다. 이력은 바뀐 부분만(immer 패치) 보관해서 클립이 많은 프로젝트에서도 단계당 크기가 작습니다.
- **단축키**: Space 재생/일시정지 · Shift+Space 정지(처음으로) · R 녹음 시작/끝 · Ctrl+Z 실행 취소 · Ctrl+Shift+Z·Ctrl+Y 다시 실행 · Ctrl+S 프로젝트 파일 저장 · Ctrl+C·V 클립 복사·붙여넣기 · Ctrl+D 복제 · Ctrl+E 재생선에서 자르기 · Ctrl+A 모든 클립 선택 · Delete 선택 삭제 · 도구 V P B D T S C E Z Y · Alt+Q 퀀타이즈 · Page Up·Page Down 확대·축소 · Shift+1·2·3 빠른 확대 · Shift+4 빠른 축소 · Shift+5 선택 항목으로 확대 · Shift+0 전체 보기(맥은 Ctrl 대신 ⌘). 키는 글자가 아니라 키의 자리를 기준으로 알아보므로 한/영 키를 한글로 둔 채로도 같은 자리의 키가 같은 동작을 하고, 한글을 조합하는 중에는 무시합니다. 글자 칸 안에서는 Ctrl+S만 동작하고(칸 자체의 Ctrl+Z 같은 것은 칸에 맡깁니다), 확인창·내보내기 창·다시 연결 창이 열려 있으면 뒤 화면에는 키가 닿지 않으며, 노브·슬라이더에 초점이 있으면 Page Up·Page Down은 그 노브가 씁니다. 키 목록과 메뉴·단추에 적힌 키 글자는 `src/services/shortcuts.ts`의 표 하나에서 나옵니다.
- **재생 화면**: 재생선(재생을 시작할 자리 = 편집 커서)·시간 표시·레벨 미터·주파수 분석기는 화면 갱신 루프 하나를 같이 쓰고, 재생·녹음 중에만 돕니다(멈춰 있으면 화면 갱신 요청 0회, 재생 중 초당 약 60회). 재생 중에는 재생선(`transform`)과 시간 글자(초당 30번)만 직접 고치고 타임라인·상단 바·툴바는 다시 그리지 않습니다. 재생선이 화면 오른쪽을 벗어나면 스크롤이 따라가며("따라가기" 단추로 끄고 켬), 곡 끝에 닿으면 저절로 멈춥니다.
- **믹스 WAV 내보내기**: 샘플레이트(44.1/48 kHz)와 비트 수(16/24)를 고르고, 진행률을 보며 취소할 수 있습니다. 재생할 때와 같은 소리 부품(마스터 리미터 −1 dBFS 포함)으로 만들어서 같은 문서는 늘 같은 파일이 됩니다. 곡 끝의 딜레이·리버브 꼬리까지 담깁니다.

## 저장 방식

- **자동 저장**: 편집이 멈추면 1.2초 뒤(탭을 숨기거나 떠날 때는 바로) 브라우저(IndexedDB)에 음원까지 함께 저장하고, 새로고침하면 복구합니다. 같은 음원은 한 번만 저장하고, 최근 프로젝트 5개를 남깁니다. 상태 줄 오른쪽에 "자동 저장됨 02:41"처럼 보이고, 저장하지 못하면 [프로젝트 파일로 저장] 단추가 나옵니다. 브라우저 데이터를 지우면 함께 사라지니 중요한 작업은 프로젝트 파일로도 보관하세요.
- **프로젝트 파일**: 상단의 저장·불러오기로 음원이 담긴 파일(`.adproj`)을 내보내고 불러옵니다. 다른 기기로 옮기거나 백업할 때 씁니다. `.adproj`는 압축하지 않은 zip이라 음원 크기가 거의 그대로입니다(옛 JSON은 음원을 base64로 넣어 약 1.33배였음): `project.json`(`{ format: "accompany-designer-project", schemaVersion: 2, doc }`) 한 개와 `audio/<SHA-256><확장자>` 음원 파일들이 들어 있고, 같은 내용의 음원은 한 번만 담습니다. 다른 프로그램의 zip 풀기로도 열어 볼 수 있습니다. 불러올 때는 첫 4바이트로 zip(`PK\x03\x04`)인지 옛 JSON(`{`)인지 가려, 6월 파일·11월 파일·임시 v2 JSON도 그대로 엽니다.
- **음원 다시 연결**: 파일에 음원이 빠져 있거나(옛 6월 파일 등) 자동 저장에 음원이 없으면, 열 때 "음원 다시 연결" 창이 뜹니다. 빠진 음원마다 이름·길이·쓰는 클립 수가 나오고 [파일 찾기]로 고릅니다. 내용(해시)이 같으면 바로 연결하고, 해시는 달라도 이름이 같고 길이 차이가 0.25초 이내면 "이 파일로 연결할까요?"로 한 번 묻고, 그 밖에는 "다른 파일로 보입니다(길이 3:12 / 3:40)"라며 연결하지 않습니다. 창은 파일 메뉴의 "음원 다시 연결"로 언제든 다시 엽니다. 평소처럼 같은 파일을 올려도 새 클립을 만들지 않고 빠진 음원에 "기존 클립 3개에 다시 연결했습니다"로 이어 줍니다. 불러올 때는 검사기 하나(`domain/project/parseProject.ts`)가 값의 자료형과 범위를 보고, 범위를 벗어난 값은 가까운 값으로 고친 뒤 "값 N개를 허용 범위로 고쳤습니다"라고 알려 줍니다.

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
  app/                화면 틀(AppShell), 사용자 동작(actions), 앱 시작(bootstrap), 엔진 연결(engineSync), 녹음 연결(recording · recordingHost: 어느 트랙에 놓을지·저장·안내), 파일 올리기(importing: 올린 음원 풀기·같은 파일이면 다시 연결·타임라인에 끌어다 놓은 파일을 놓은 자리에 올리기), 프로젝트 파일 저장·열기(projectFile), 음원 다시 연결(relinking), 자동 저장 재촉(autosaveControl), 파형 계산 연결(peaks: 올리기·녹음·파일 열기·복구 뒤 단계별 파형을 캐시에서 읽거나 Worker로 계산), BPM 감지 흐름(bpmDetection: 시작·취소·×½·×2·클립/프로젝트에 적용), 템포 맞춤 켜고 끄기(tempoMatch: 처음 켤 때 한 번 안내), 키 → 동작 연결(keyboard)·재생/정지(transport), 지금 재생 위치 읽기(playhead: 멈춰 있으면 편집 커서, 재생 중이면 소리 쪽 시계), 재생·녹음 중 화면 갱신 루프 켜고 끄기와 곡 끝 감시(playbackLoop)
  ui/                 화면 부품: 안내·확인창·자동 저장 표시(feedback), 상단 바, 인스펙터(inspector/: 칸마다 한 파일 — Inspector가 ClipPanel·TrackMixPanel·MasterPanel·EqPanel·CompressorPanel(바늘 CompressorNeedle: 공용 루프에서 엔진의 압축량을 읽어 자기 요소만 직접 돌림)·DelayPanel·ReverbPanel·AnalyzerPanel을 순서대로 놓음), 공용 조작부(controls/: 노브 Knob(동작은 이 한 곳뿐이고 모양은 knobFaces.tsx에서 고름) · 슬라이더 Slider · 켜고 끄는 단추 Toggle · 값 글자를 눌러 여는 숫자 칸 ValueEntry·CommittedNumberInput · 계산 knobMath.ts · 숫자 칸 설정 도우미 entries.ts · 우클릭 메뉴 ContextMenu(자리 계산 menuMath.ts · 터치 길게 누르기 longPress.ts·useLongPress.ts). 조작부는 모두 모듈 맨 위에 한 번만 정의함: 다른 부품 안에서 만들면 다시 그릴 때마다 새 부품이 되어 초점을 잃음), 클립·트랙 메뉴의 항목 menuItems.ts·클립 위 이름 칸 ClipNameEditor(timeline/)·파일 끌어다 놓기 useFileDrop과 놓일 자리 표시 DropIndicator(timeline/)·박자표 선택 칸(transport/TempoControls), 재생선 PlayheadOverlay(timeline/)·시간 표시 TimeDisplay(transport/): React 상태 없이 자기 요소(`transform`·글자)만 직접 고침, 다시 그리기 계수기(debug/renderCount: `window.__renders`가 있을 때만 셈), 대화상자(dialogs: 음원 다시 연결 RelinkDialog)
  components/         화면 부품(타임라인 등, 순차적으로 ui/로 이동 중). 도구에 따른 포인터 동작은 도구 동작 표(domain/timeline/toolBehavior.ts)에서 찾아 실행
  i18n/               화면 문구(ko.ts)
  services/           안내(notify)·오류 변환(errors)·확인창, 저장(persistence/: 자동 저장 · `.adproj` zip 읽기·쓰기(projectFile) · 음원 원본 기억 · 음원 해시), 올린 음원 읽기·새 클립 만들기와 놓을 트랙 정하기·빠진 음원에 붙이기(importer), 단계별 파형 보관소(peaksCache: 메모리 · persistence/peaksStore: IndexedDB `peaks`), 템포 맞춤 안내를 봤는지 브라우저에 기억(tempoMatchNotice: localStorage `ad.tempoMatchPitchNoticeSeen`), 단축키 표(shortcuts: 키 조합·판정 규칙·메뉴 표기), 앱 안 클립보드(clipboard: 복사한 클립과 원래 트랙 자리. 복사·붙여넣기·메뉴가 같은 곳을 씀), 화면 갱신 루프 하나(frameLoop: 재생·녹음 중에만 돌고 재생선·시간 표시·레벨 미터·분석기·따라가기 스크롤이 구독)
  audio/              소리 엔진: 옛 엔진(audioEngine.ts) · 새 엔진(engine/AudioEngine.ts: 재생 시계 Transport · 예약기 Scheduler · 클립 재생 단위 ClipVoice · 트랙 경로 TrackStrip · 마스터 길 MasterBus(볼륨 → 선읽기 리미터 → 분석기 → 스피커) · 모니터 길 MonitorBus(메트로놈·입력 모니터, 믹스에 안 섞임)) · 리미터(worklets/limiter.worklet.ts, 계산은 limiterCore.ts) · 이펙트 부품(effects/: 공통 약속 EffectNode · EQ · 컴프레서 · 딜레이 · 리버브 · 같은 설정은 같은 잔향 impulse · 꼬리 길이 tail) · 엔진 고르기(currentEngine.ts) · 바뀐 트랙만 고르는 계획(engine/syncPlan.ts) · 예약 타이머(workers/tick.worker.ts) · 녹음(recording/RecordingController.ts: 대기 → 준비 → 카운트인 → 녹음 → 마무리 상태 기계 · recording/Recorder.ts: 마이크 받기 · worklets/recorder.worklet.ts: 4,096 샘플씩 조각과 파형 최대값을 보냄, 계산은 recorderCore.ts) · 메트로놈·카운트인(Metronome.ts: 오디오 시계로 미리 예약) · 파형 계산(peaksAnalyzer.ts + workers/peaks.worker.ts: 음원을 조각내어 Worker로 보내 단계별 최소·최대값을 만듦, 취소 가능) · BPM 감지(bpmDetector.ts: 첫 180초 0번 채널을 분석하는 계산 · bpmAnalyzer.ts + workers/bpm.worker.ts: 1MB 조각으로 Worker에 보내 계산, 진행률·취소, Worker가 없으면 화면 스레드에서 한 번에 계산)
  domain/             화면·소리 없이 시험할 수 있는 순수 계산(timeline/clipMath.ts: 클립을 어떻게 재생할지 정하는 planVoice·자를 클립 고르기 clipsToCutAt·여러 클립 함께 옮기기 planMultiMove·복제 planDuplicate·붙여넣기 planPaste · master/volume.ts: 마스터 볼륨 범위·dB 변환 · recording/latency.ts: 녹음 지연 보정 · waveform/: 단계별 파형 계산 peakLevels와 칸별 최소·최대 columns · timeline/zoom.ts·ruler.ts: 확대 범위·전체 보기 배율·눈금 솎기 · timeline/pitch.ts: 배속 → 음정 변화(반음)·배속 표시 · timeline/placement.ts: 새 클립(올리기·녹음)을 놓을 트랙 고르기 · timeline/toolBehavior.ts: 도구마다 빈 곳·클립·다듬기 손잡이를 눌렀을 때 하는 일을 적은 표(Timeline·ClipView가 여기서 찾아 실행) · types.ts: 문서 형식 v2의 자료형 · project/: 문서 검사기 parseProject·parsePreset, 옛 형식 이전 migrations, 기본값 defaults, 값의 범위 ranges, 빠진 음원 찾기·같은 파일 판정 relink, 이펙트 설정 일부를 합쳐 효과 사슬 칸까지 맞추는 effectPatch · timeline/follow.ts: 재생선이 화면 밖으로 나가면 스크롤을 어디로 옮길지 정하는 계산 · timeline/snap.ts: 박자표(2/4·3/4·4/4·6/8)의 마디 길이·스냅 선택지 다섯 개(PLAYLIST_SNAPS)와 그 간격(마디 스냅은 박자표를 따름)·메트로놈 클릭 간격·카운트인 선택지 · compressor/needle.ts: 컴프레서의 압축량(dB, 0 이하) → 바늘 각도(−20 dB가 끝) · timeline/drop.ts: 끌어다 놓은 파일이 놓일 트랙과 줄)
  store/, state/      상태: 프로젝트 문서(state/projectStore.ts, immer로 불변 갱신) · 편집 함수(state/commands/: 숫자를 이어서 고칠 때 한 단계로 묶는 key는 editKey.ts가 만듦) · 이력(state/history.ts: immer 패치로 바뀐 부분만 보관하고 끌기·글자 입력은 묶음으로 한 단계 · gestureGuards.ts: 뗌을 놓쳐도 묶음을 닫는 안전장치 · patches.ts: 끌기 중 쌓인 패치 줄이기) / 화면 상태(store/useDawStore.ts, 문서를 거울처럼 비춤) / 녹음 상태(state/recordingStore.ts: 진행·임시 파형·설정, 문서에는 안 들어감) / 안내·확인창·자동 저장 상태 / 다시 연결 창 상태(state/relinkStore.ts) / 우클릭 메뉴가 열려 있는지(state/menuStore.ts: 열려 있는 동안 창 전체 단축키가 멈춤) / BPM 감지 상태(state/bpmStore.ts: 대기·분석 중(진행률)·끝남·실패·취소, 문서에는 안 들어감)
  styles/             디자인 토큰(tokens.css: 색·간격·모양·글자 크기·층)과 영역별 CSS(base·shell·buttons·transport·playlist·inspector·focus·eq·mix·delay·reverb·compressor·analyzer·layout·feedback·legibility·master·controls). 같은 우선순위의 규칙은 나중에 불러온 파일이 이기므로 main.tsx의 import 순서를 바꾸지 말 것. 옛 styles.css는 없음
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
