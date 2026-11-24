import { ko } from "../i18n/ko";
import { notify } from "../services/notify";
import { hasSeenTempoMatchNotice, markTempoMatchNoticeSeen } from "../services/tempoMatchNotice";
import { useDawStore } from "../store/useDawStore";
import { findClip } from "../utils/audioMath";

/**
 * 클립의 "템포 맞춤"(예전 이름 WARP)을 켜고 끈다(설계서 §P4-4, 보고서 B4).
 * 지금의 템포 맞춤은 재생 속도를 바꾸는 방식이라 음정도 함께 바뀐다. 사용자가 처음 켤 때 한 번만 그 사실을 알린다.
 */

/** 시험에서 바꿔 끼우는 의존물: 안내를 이미 보았는지 */
export interface TempoMatchDeps {
  hasSeenNotice: () => boolean;
  markNoticeSeen: () => void;
}

/** 저장소를 못 쓰는 환경에서도 한 번 띄운 안내를 이 화면 동안은 다시 띄우지 않는다. */
let shownThisPage = false;

const defaultDeps: TempoMatchDeps = {
  hasSeenNotice: () => shownThisPage || hasSeenTempoMatchNotice(),
  markNoticeSeen: () => {
    shownThisPage = true;
    markTempoMatchNoticeSeen();
  },
};

/** 켜져 있으면 끄고 꺼져 있으면 켠다. 바뀐 뒤의 켜짐 여부를 돌려준다(클립이 없으면 undefined). */
export function toggleTempoMatch(clipId: string, deps: TempoMatchDeps = defaultDeps): boolean | undefined {
  const state = useDawStore.getState();
  const clip = findClip(state.tracks, clipId)?.clip;
  if (!clip) return undefined;

  const turnOn = clip.stretchMode !== "resample";
  state.updateClip(clipId, { stretchMode: turnOn ? "resample" : "none" });
  if (turnOn && !deps.hasSeenNotice()) {
    deps.markNoticeSeen();
    notify("warning", ko.clip.tempoMatchPitchNotice);
  }
  return turnOn;
}
