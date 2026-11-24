/**
 * 사용자에게 보이는 문구 모음(한국어).
 *
 *  - 안내·확인창·오류 문구와, 예전에 영어였던 라벨을 여기 한곳에 둔다.
 *  - 문구를 바꿀 일이 생기면 이 파일만 고친다. 동작 코드(app/·store/·services/)에는 문장을 새로 쓰지 않는다.
 *  - 화면 부품에 이미 한국어로 적혀 있는 정적 글자(단추 이름 등)는 그대로 두었다.
 *    영어가 다시 들어오지 못하게 `scripts/check-ui-strings.mjs`가 `npm run check`에서 검사한다.
 *    (업계에서 그대로 쓰는 약어만 허용: EQ, BPM, WAV, MP3, RMS, kHz)
 */
export const ko = {
  // ───── 화면 부품의 라벨 ─────

  state: {
    on: "켜짐",
    off: "꺼짐",
    /**
     * 장비 전원 단추의 이름. 단추 안에 보이는 글자가 "켜짐"·"꺼짐"이므로 이름에도 그 글자를 넣는다
     * (WCAG 2.5.3 '보이는 이름이 접근 이름에 들어 있어야 한다': 음성 제어로 보이는 글자를 말해 누를 수 있게).
     * 켜짐 여부는 `aria-pressed`로도 따로 알린다.
     */
    power: (equipment: string, on: boolean) => `${equipment} ${on ? "켜짐" : "꺼짐"}`,
  },

  /** 타임라인 왼쪽 트랙 머리 */
  trackHeader: {
    arm: "녹음 대기",
    armHint: "이 트랙을 녹음 대기 상태로 만듭니다. 녹음하면 이 트랙에 담깁니다.",
    mute: "음소거",
    solo: "솔로",
    volume: "볼륨",
    /** 트랙 이름을 받아 그 트랙 볼륨 숫자 칸의 이름을 만든다 */
    volumeInput: (trackName: string) => `${trackName} 볼륨 값(%)`,
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
    volumeInput: "모니터 볼륨 값(%)",
  },

  master: {
    heading: "마스터",
    volumeLabel: "마스터 볼륨",
    volumeValue: (db: number) => `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`,
    /** 숫자로 바로 입력하는 칸(dB). 범위는 −60 ~ +6 */
    volumeInput: "마스터 볼륨 값(dB)",
    resetLabel: "0 dB",
    resetTitle: "마스터 볼륨을 0 dB로 되돌립니다",
    limiterLabel: "리미터",
    limiterMeterLabel: "리미터가 누르는 양",
    limiterValue: (db: number) => `${db.toFixed(1)} dB`,
    limiterHint: "순간적으로 큰 소리가 −1 dB를 넘지 않도록 누르는 양입니다. 0이면 건드리지 않는 것입니다.",
  },

  clip: {
    noWavData: "이 세션에는 WAV 원본 데이터가 없습니다.",

    /**
     * 템포 맞춤(예전 이름 WARP, 설계서 §P4-4·보고서 B4): 프로젝트 템포에 맞춰 재생 속도를 바꾼다.
     * 지금은 속도를 바꾸는 만큼 음정도 함께 바뀐다. 이름에 그 사실을 적는다.
     */
    tempoMatch: "템포 맞춤",
    tempoMatchSuffix: "(음정도 바뀜)",
    tempoMatchOnTitle: "템포 맞춤 끄기",
    tempoMatchOffTitle: "템포 맞춤 켜기. 프로젝트 템포에 맞춰 속도를 바꾸며, 음정도 함께 바뀝니다.",
    /** 처음 켤 때 한 번만 보이는 안내(토스트) */
    tempoMatchPitchNotice: "지금은 속도와 음정이 함께 바뀝니다. 음정을 유지하는 방식은 나중에 추가합니다.",
    sourceBpm: "원본 BPM",
    rate: "배속",
    rateTitle: "현재 재생 배속과 그에 따른 음정 변화(반음)",
    gain: "게인",
    gainValue: "게인 값",

    /** BPM 감지(설계서 §P4-4·보고서 B5) */
    bpm: {
      detect: "BPM 감지",
      detectTitle: "클립 앞부분(최대 3분)의 박자를 분석해 BPM을 추정합니다. 분석하는 동안에도 다른 작업을 할 수 있습니다.",
      progressLabel: "BPM 분석 진행률",
      progress: (percent: number) => `BPM 분석 중… ${percent}%`,
      cancel: "취소",
      cancelTitle: "BPM 분석을 그만둡니다",
      result: (value: number) => `추정 BPM ${value} · 곡에 따라 절반이나 두 배로 감지될 수 있습니다.`,
      half: "×½",
      double: "×2",
      halfTitle: "추정값을 절반으로 고칩니다(예: 240 → 120)",
      doubleTitle: "추정값을 두 배로 고칩니다(예: 60 → 120)",
      applyToClip: "클립 원본 BPM에 적용",
      applyToProject: "프로젝트 템포에 적용",
      appliedToClip: (value: number) => `클립 원본 BPM을 ${value}(으)로 설정했습니다.`,
      appliedToProject: (value: number) => `프로젝트 템포를 ${value}(으)로 설정했습니다.`,
      cancelled: "BPM 분석을 취소했습니다.",
      noBuffer: "오디오 버퍼가 없어 BPM을 분석할 수 없습니다.",
      unstable: "BPM을 안정적으로 추정하지 못했습니다.",
      failed: "BPM을 분석하지 못했습니다.",
    },
  },

  /** 타임라인 위의 안내(P5-5) */
  timeline: { dropNewTrack: "새 트랙에 놓기" },

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
    clipDeleted: "클립을 삭제했습니다.",
    clipsDeleted: (count: number) => `클립 ${count}개를 삭제했습니다.`,
    undoDelete: "되돌리기",
    undoDeleteStale: "그 사이에 다른 편집을 해서 이 삭제만 되돌릴 수 없습니다. 실행 취소(Ctrl+Z)로 순서대로 되돌릴 수 있습니다.",
    clipDuplicated: "클립을 복제했습니다.",
    clipsDuplicated: (count: number) => `클립 ${count}개를 복제했습니다.`,
    duplicateNeedsSelection: "복제할 클립을 먼저 선택하세요.",
    playheadOutsideClip: "재생선이 이 클립 안에 있어야 자를 수 있습니다.",
    clipsSliced: (count: number) => `클립 ${count}개 자르기 완료`,
    playheadOutsideSelection: "재생선이 선택한 클립 안에 있어야 자를 수 있습니다.",
    playheadOnNoClip: "재생선이 지나는 클립이 없어 자르지 않았습니다.",
    clipNameEmpty: "클립 이름은 비워 둘 수 없습니다.",
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
    clipsPastedToNewTracks: (count: number, tracks: number) => `클립 ${count}개 붙여넣기 완료 (새 트랙 ${tracks}개)`,
    pasteNeedsCopy: "붙여넣을 클립이 없습니다. 먼저 클립을 복사하세요.",
    pasteNeedsSource: "복사한 클립의 음원이 이 프로젝트에 없어 붙이지 못했습니다.",
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
    /** 같은 파일(해시가 같은 음원)을 다시 올렸을 때(설계서 §P4-2): 새 클립을 만들지 않고 빠졌던 음원에 이어 준다. */
    relinkedClips: (fileName: string, clipCount: number) =>
      clipCount > 0 ? `${fileName}: 기존 클립 ${clipCount}개에 다시 연결했습니다.` : `${fileName}: 음원을 다시 연결했습니다.`,
    /** 재연결 대화상자를 닫을 때 */
    relinkDone: (linked: number, remaining: number) =>
      remaining > 0 ? `음원 ${linked}개를 다시 연결했습니다. ${remaining}개는 아직 연결되지 않았습니다.` : `음원 ${linked}개를 모두 다시 연결했습니다.`,
    uploadProgress: (index: number, total: number, fileName: string) => `(${index}/${total}) ${fileName} 완료`,
    uploadDone: (fileName: string) => `${fileName} 업로드 완료`,
    uploadAllDone: (count: number) => `${count}개 파일 업로드 완료`,
    uploadPartial: (total: number, uploaded: number) =>
      `${total}개 중 ${uploaded}개만 업로드했습니다. 실패한 파일은 위 안내를 확인해 주세요.`,

    projectSaved: "음원을 포함한 프로젝트 파일을 저장했습니다.",
    mixSaved: "믹스 WAV 파일을 저장했습니다.",
    mixCancelled: "믹스 내보내기를 취소했습니다. 파일은 만들지 않았습니다.",
    exportLockedWhileRecording: "녹음 중에는 믹스를 내보낼 수 없습니다.",
    exportNoClips: "내보낼 클립이 없습니다. 음소거하지 않은 클립을 하나 이상 놓아 주세요.",
    exportMissingAudio: (missing: number) => `음원 ${missing}개를 찾을 수 없습니다. 음원을 다시 연결해 주세요.`,
    exportTooLong: "1시간을 넘는 프로젝트는 WAV로 내보낼 수 없습니다.",
    projectLoaded: "프로젝트와 음원을 불러왔습니다.",
    /** 불러온 프로젝트에서 범위를 벗어난 값을 고쳤을 때(설계서 §P4-1) */
    valuesFixed: (count: number) => `값 ${count}개를 허용 범위로 고쳤습니다.`,
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

  // ───── 우클릭 메뉴(P5-4) ─────

  menu: {
    clip: {
      label: "클립 메뉴",
      sliceAtPlayhead: "재생선에서 자르기",
      duplicate: "복제",
      copy: "복사",
      toggleMute: "음소거 전환",
      rename: "이름 바꾸기",
      ungroup: "그룹 해제",
      delete: "삭제",
    },
    track: {
      label: "트랙 메뉴",
      rename: "이름 바꾸기",
      moveUp: "위로",
      moveDown: "아래로",
      delete: "삭제",
    },
    renameClip: (name: string) => `${name} 클립 이름`,
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

  // ───── 음원 다시 연결 대화상자 (설계서 §P4-2) ─────

  relink: {
    title: "음원 다시 연결",
    intro: (count: number) =>
      `프로젝트 파일에 들어 있지 않은 음원이 ${count}개 있습니다. 원래 쓰던 음원 파일을 찾아 주면 같은 클립에 다시 연결합니다.`,
    none: "다시 연결할 음원이 없습니다. 모든 음원이 연결되어 있습니다.",
    length: (duration: string) => `길이 ${duration}`,
    clips: (count: number) => `클립 ${count}개`,
    find: "파일 찾기",
    checking: "확인하는 중…",
    linkedSame: "같은 파일입니다. 연결했습니다.",
    linked: "연결했습니다.",
    ask: (fileName: string, duration: string) => `이 파일로 연결할까요? ${fileName} (길이 ${duration})`,
    askYes: "연결",
    askNo: "취소",
    differentLength: (expected: string, actual: string) => `다른 파일로 보입니다(길이 ${expected} / ${actual})`,
    differentName: "다른 파일로 보입니다(파일 이름이 다릅니다)",
    failed: (fileName: string) => `'${fileName}'을(를) 읽을 수 없습니다. 다른 파일을 골라 주세요.`,
    close: "닫기",
    menuItem: "음원 다시 연결",
    rowLabel: (fileName: string) => `${fileName} 음원`,
  },

  // ───── 믹스 내보내기 대화상자 ─────

  exportDialog: {
    title: "믹스 WAV 내보내기",
    summary: (duration: string, size: string) => `길이 ${duration} · 예상 크기 ${size}`,
    sampleRate: "샘플레이트",
    bitDepth: "비트 수",
    sampleRateOption: (hertz: number) => `${hertz / 1000} kHz`,
    bitDepthOption: (bits: number) => `${bits}비트`,
    bitDepthHint: "16비트는 어디서나 열립니다. 24비트는 다시 믹싱·마스터링할 때 좋고 파일이 1.5배 큽니다.",
    start: "내보내기",
    cancel: "취소",
    rendering: "믹스를 만드는 중입니다…",
    encoding: "파일을 만드는 중입니다…",
    cancelling: "취소하는 중입니다…",
    progress: (percent: number) => `${percent}%`,
    progressLabel: "내보내기 진행률",
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
    projectInvalid: "프로젝트 파일을 읽을 수 없습니다. 이 앱에서 저장한 프로젝트 파일인지 확인해 주세요.",
    projectFileTooBig: "프로젝트 파일이 너무 커서 열 수 없습니다.",
    projectAudio: "프로젝트에 포함된 음원을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.",
    projectUnsupported: "지원하지 않는 프로젝트 파일 형식입니다.",
    projectTooBig: "트랙·클립·마커가 너무 많아 열 수 없습니다.",
    projectBroken: (path: string) => `프로젝트 파일의 내용이 올바르지 않습니다(${path || "전체"}).`,
    projectAudioData: "음원 데이터가 올바르지 않습니다.",
    autosaveBroken: "자동 저장 기록을 읽을 수 없습니다.",
    quota: "브라우저 저장 공간이 부족합니다. 안 쓰는 프로젝트를 정리해 주세요.",
    quotaAutosave: "브라우저 저장 공간이 부족해 자동 저장하지 못했습니다.",
    detailSummary: "자세히 보기",
  },

  action: {
    saveProjectFile: "프로젝트 파일로 저장",
    relink: "다시 연결",
  },

  // ───── 화면 낭독기 안내(눈에는 보이지 않는다, 설계 P6-2) ─────

  announce: {
    /** 화면 제목: 눈에는 보이지 않고, 화면 낭독기의 제목 이동 키가 찾는 곳 */
    appTitle: "반주 디자이너 2",
    playing: "재생 중",
    stopped: "재생 멈춤",
    countingIn: "녹음 준비, 카운트인",
    recording: "녹음 중",
    recordingStopped: "녹음 멈춤",
    /** 클립에 초점이 올 때 화면 낭독기가 덧붙여 읽는 키 안내 */
    clipKeys: "엔터로 고르기, 왼쪽·오른쪽 방향키로 격자 한 칸 옮기기, 시프트와 방향키로 길이 바꾸기, 삭제 키로 지우기",
    clipSelected: (name: string) => `${name} 선택됨`,
    clipDeselected: (name: string) => `${name} 선택 해제`,
    clipStart: (name: string, time: string) => `${name} 시작 ${time}`,
    clipLength: (name: string, time: string) => `${name} 길이 ${time}`,
    clipLengthLimit: (name: string, time: string) => `${name} 더 바꿀 수 없음, 길이 ${time}`,
    /** 시간을 말로 읽을 때: 1분 2.50초 */
    spokenTime: (seconds: number) => {
      const safe = Math.max(0, seconds);
      const minutes = Math.floor(safe / 60);
      const rest = (safe - minutes * 60).toFixed(2);
      return minutes > 0 ? `${minutes}분 ${rest}초` : `${rest}초`;
    },
  },
} as const;
