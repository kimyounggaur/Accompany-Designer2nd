/**
 * 사용자에게 보이는 문구 모음(한국어).
 *
 *  - 안내·확인창·오류 문구와, 예전에 영어였던 라벨을 여기 한곳에 둔다.
 *  - 문구를 바꿀 일이 생기면 이 파일만 고친다. 동작 코드(app/·store/·services/)에는 문장을 새로 쓰지 않는다.
 *  - 화면 부품에 이미 한국어로 적혀 있는 정적 글자(단추 이름 등)는 그대로 두었다.
 *    영어가 다시 들어오지 못하게 `scripts/check-ui-strings.mjs`가 `npm run check`에서 검사한다.
 *    (업계에서 그대로 쓰는 약어만 허용: EQ, BPM, WAV, MP3, RMS, WARP)
 */
export const ko = {
  // ───── 화면 부품의 라벨 ─────

  state: { on: "켜짐", off: "꺼짐" },

  /** 타임라인 왼쪽 트랙 머리 */
  trackHeader: {
    arm: "녹음 대기",
    armHint: "이 트랙을 녹음 대기 상태로 만듭니다. 녹음하면 이 트랙에 담깁니다.",
    mute: "음소거",
    solo: "솔로",
    volume: "볼륨",
  },

  /** 오른쪽 패널의 트랙 믹스 */
  trackMix: { title: "트랙 믹스", mute: "음소거", solo: "솔로", volume: "볼륨", pan: "팬" },

  eq: { bass: "저음", middleLow: "중저음", middleHigh: "중고음", high: "고음", presence: "프레즌스" },

  compressor: {
    title: "컴프레서",
    gainReduction: "줄어든 음량 (dB)",
    threshold: "기준 음량",
    ratio: "압축 비율",
    attack: "반응 시간",
    release: "회복 시간",
  },

  /** 이펙트 랙의 칸 이름 */
  effectRack: {
    eq: "이퀄라이저",
    comp: "컴프레서",
    delay: "딜레이",
    reverb: "리버브",
    on: "켜짐",
    off: "꺼짐",
    defaultPresetName: (trackName: string) => `${trackName} 랙`,
    presetSaved: (name: string) => `${name} 프리셋을 저장했습니다.`,
    presetLoaded: (name: string) => `${name} 프리셋을 불러왔습니다.`,
    presetImportFailed: "프리셋 파일을 불러오지 못했습니다. 이 앱에서 내보낸 .json 파일인지 확인해 주세요.",
  },

  delay: {
    subtitle: "에코",
    dotted8: "점 8분음표",
    triplet8: "셋잇단 8분음표",
  },

  reverb: {
    subtitle: "잔향",
    drive: "드라이브",
    decayLong: "길게",
    decayShort: "짧게",
    blend: "섞는 비율",
    width: "폭",
    preDelay: "초기 지연",
    highPass: "저음 차단",
    lowPass: "고음 차단",
    modulation: "모듈레이션",
    amount: "양",
    postEq: "후단 이퀄라이저",
    low: "저음",
    mid: "중음",
    high: "고음",
    modes: { plate: "플레이트", room: "룸", hall: "홀" },
  },

  meter: {
    heading: "피크 / RMS",
    master: "마스터",
    peakTitle: (label: string, db: string) => `${label} 피크 ${db} dB`,
  },

  record: {
    latencyLabel: "지연",
    latencyUnit: "ms",
    latencyAria: "녹음 지연 보정(ms)",
    latencyTitle: "녹음 지연 보정(ms). 녹음한 소리가 반주보다 늦게 들리면 양수로 올리세요. 블루투스 이어폰처럼 지연이 큰 장치는 −200 ~ +200 안에서 맞춥니다.",
  },

  monitor: {
    volumeLabel: "모니터 볼륨",
    volumeTitle: "입력 모니터링과 메트로놈 소리의 크기입니다. 믹스와 내보내기에는 섞이지 않습니다.",
    volumeValue: (percent: number) => `${percent}%`,
  },

  master: {
    heading: "마스터",
    volumeLabel: "마스터 볼륨",
    volumeValue: (db: number) => `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`,
    resetLabel: "0 dB",
    resetTitle: "마스터 볼륨을 0 dB로 되돌립니다",
    limiterLabel: "리미터",
    limiterMeterLabel: "리미터가 누르는 양",
    limiterValue: (db: number) => `${db.toFixed(1)} dB`,
    limiterHint: "순간적으로 큰 소리가 −1 dB를 넘지 않도록 누르는 양입니다. 0이면 건드리지 않는 것입니다.",
  },

  clip: { noWavData: "이 세션에는 WAV 원본 데이터가 없습니다." },

  playlist: { snapFallback: "라인" },

  // ───── 안내(토스트·상태 줄) ─────

  notice: {
    undone: "실행 취소",
    nothingToUndo: "실행 취소할 작업이 없습니다.",
    redone: "다시 실행",
    nothingToRedo: "다시 실행할 작업이 없습니다.",

    armLockedWhileRecording: "녹음 중에는 녹음 대기 트랙을 바꿀 수 없습니다.",
    armed: "이 트랙에 녹음하도록 설정했습니다.",
    disarmed: "녹음 대기 트랙을 해제했습니다.",

    drawNeedsSource: "오디오를 업로드하거나 클립을 선택한 뒤 그리세요.",
    clipDeleted: "클립 삭제됨",
    clipsDeleted: (count: number) => `클립 ${count}개 삭제됨`,
    noClipSelected: "선택된 클립이 없습니다.",
    clipSliced: "클립 자르기 완료",
    sliceNeedsClip: "자를 클립을 선택하세요.",
    sliceNeedsInside: "클립 내부를 클릭해 자르세요.",
    clipsQuantized: (count: number) => `클립 ${count}개 퀀타이즈됨`,
    nothingToQuantize: "퀀타이즈할 클립이 없습니다.",
    clipsGrouped: (count: number) => `클립 ${count}개 그룹화됨`,
    groupNeedsTwo: "그룹화할 클립을 두 개 이상 선택하세요.",
    ungrouped: "선택 클립 그룹 해제됨",
    nothingToUngroup: "해제할 선택 그룹이 없습니다.",
    zoomNeedsClip: "확대할 클립을 선택하세요.",
    sourceReset: "선택 클립 소스 초기화됨",
    resetNeedsClip: "소스를 초기화할 클립을 선택하세요.",
    clipsSelected: (count: number) => `클립 ${count}개 선택됨`,
    nothingToSelect: "선택할 클립이 없습니다.",
    selectionCleared: "선택 해제됨",
    clipsCopied: (count: number) => `클립 ${count}개 복사됨`,
    copyNeedsSelection: "복사할 클립을 먼저 선택하세요.",
    clipsPasted: (count: number) => `클립 ${count}개 붙여넣기 완료`,
    pasteNeedsCopy: "붙여넣을 클립이 없습니다. 먼저 클립을 복사하세요.",
    markersCleared: "타임 마커 삭제됨",

    trackDeleted: (name: string) => `${name} 트랙이 삭제되었습니다. 실행 취소로 되돌릴 수 있습니다.`,
    trackDeleteLockedWhileRecording: "녹음 중에는 트랙을 삭제할 수 없습니다.",
    needsOneTrack: "트랙은 하나 이상 필요합니다.",

    countInStarted: (beat: number) => `${beat}박 후 녹음 시작`,
    countInCancelled: "녹음 카운트인이 취소되었습니다.",
    recordingNow: (fileName: string) => `${fileName} 녹음 중...`,
    recordingSaving: (fileName: string) => `${fileName} 저장 중...`,
    recordingDone: (fileName: string) => `${fileName} 녹음 완료`,
    recordingEmpty: "녹음된 소리가 없어 클립을 만들지 않았습니다.",
    undoLockedWhileRecording: "녹음 중에는 실행 취소와 다시 실행을 할 수 없습니다.",
    playLockedWhileRecording: "녹음 중에는 재생 위치를 옮길 수 없습니다.",

    decoding: (count: number) => `${count}개 파일 디코딩 중...`,
    relinked: (fileName: string) => `${fileName} 음원을 기존 클립에 다시 연결했습니다.`,
    uploadProgress: (index: number, total: number, fileName: string) => `(${index}/${total}) ${fileName} 완료`,
    uploadDone: (fileName: string) => `${fileName} 업로드 완료`,
    uploadAllDone: (count: number) => `${count}개 파일 업로드 완료`,
    uploadPartial: (total: number, uploaded: number) =>
      `${total}개 중 ${uploaded}개만 업로드했습니다. 실패한 파일은 위 안내를 확인해 주세요.`,

    projectSaved: "음원을 포함한 프로젝트 파일을 저장했습니다.",
    mixRendering: "믹스 WAV를 만드는 중입니다...",
    mixSaved: "믹스 WAV 파일을 저장했습니다.",
    projectLoaded: "프로젝트와 음원을 불러왔습니다.",
    projectLoadedMissing: (missing: number) => `프로젝트를 불러왔습니다. 음원 ${missing}개가 파일에 포함되지 않았습니다.`,

    autosaveRestored: "자동 저장된 프로젝트와 음원을 복구했습니다.",
    autosaveRestoredMissing: (missing: number) => `자동 저장된 프로젝트를 복구했습니다. 음원 ${missing}개를 다시 연결해 주세요.`,
  },

  // ───── 자동 저장 ─────

  autosave: {
    regionLabel: "자동 저장 상태",
    saving: "저장 중…",
    saved: (time: string) => `자동 저장됨 ${time}`,
    failed: "자동 저장 실패",
    storageNearlyFull: (percent: number) =>
      `브라우저 저장 공간을 ${percent}% 사용 중입니다. 곧 자동 저장이 안 될 수 있으니 프로젝트 파일로 저장해 두세요.`,
  },

  // ───── 확인창 ─────

  confirm: {
    deleteTrack: {
      title: "트랙 삭제",
      message: (name: string, clipCount: number) =>
        `'${name}' 트랙과 클립 ${clipCount}개를 삭제할까요? 실행 취소로 복원할 수 있습니다.`,
      confirmLabel: "삭제",
    },
    loadProject: {
      title: "프로젝트 불러오기",
      message: "현재 프로젝트를 불러온 내용으로 바꾸시겠습니까? 현재 작업은 먼저 파일로 저장할 수 있습니다.",
      confirmLabel: "불러오기",
    },
  },

  // ───── 실패 안내 ─────

  /** 실패한 일의 이름. 원인을 알 수 없을 때 "○○ 실패: …" 꼴로 앞에 붙는다. */
  failed: {
    decode: (fileName: string) => `${fileName} 디코딩 실패`,
    recordStart: "녹음 시작 실패",
    recordSave: "녹음 저장 실패",
    projectSave: "프로젝트 저장 실패",
    mixSave: "믹스 저장 실패",
    projectLoad: "프로젝트 불러오기 실패",
    autosave: "자동 저장 실패",
    autosaveRecover: "자동 저장 복구 실패",
    playbackSync: "재생 중 변경 반영 실패",
    /** 어디서 난 오류인지 알 수 없는 예외(window 오류·처리되지 않은 약속 거절) */
    unexpected: "동작 실패",
  },

  /** 화면 부품에서 오류가 나 화면을 그릴 수 없을 때(app/ErrorBoundary.tsx) */
  crash: {
    title: "문제가 생겼습니다",
    message: "문제가 생겨 화면을 다시 그려야 합니다. 작업은 자동 저장되어 있습니다.",
    reload: "새로고침",
    copy: "오류 내용 복사",
    copied: "복사했습니다",
    copyFailed: "복사하지 못했습니다. 아래 내용을 직접 선택해 복사해 주세요.",
    detailsSummary: "오류 내용 보기",
    skipRecover: "저장된 작업 없이 시작",
    skipRecoverHint: "새로고침해도 같은 화면이 계속 나오면 저장된 작업을 불러오지 않고 시작할 수 있습니다. 저장된 작업은 지워지지 않고 최근 프로젝트 안에 남습니다.",
  },

  /** 브라우저 오류 → 사용자 문구 (services/errors.ts의 toUserMessage가 고른다) */
  error: {
    unexpected: "예상하지 못한 문제가 생겼습니다.",
    decode: (fileName: string) => `'${fileName}'은(는) 오디오로 읽을 수 없습니다. mp3·wav·m4a 파일인지 확인해 주세요.`,
    micDenied: "마이크 사용이 허용되지 않았습니다. 주소창 왼쪽의 사이트 설정에서 마이크를 허용해 주세요.",
    micNotFound: "선택한 마이크를 찾지 못했습니다. 입력 장치를 다시 골라 주세요.",
    micBusy: "다른 프로그램이 마이크를 쓰고 있습니다. 그 프로그램을 닫고 다시 시도해 주세요.",
    projectInvalid: "프로젝트 파일을 읽을 수 없습니다. 이 앱에서 저장한 .json 파일인지 확인해 주세요.",
    projectAudio: "프로젝트에 포함된 음원을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.",
    quota: "브라우저 저장 공간이 부족합니다. 안 쓰는 프로젝트를 정리해 주세요.",
    quotaAutosave: "브라우저 저장 공간이 부족해 자동 저장하지 못했습니다.",
    detailSummary: "자세히 보기",
  },

  action: {
    saveProjectFile: "프로젝트 파일로 저장",
  },
} as const;
