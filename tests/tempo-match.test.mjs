/**
 * 템포 맞춤(예전 이름 WARP) 켜기·끄기(app/tempoMatch.ts, 설계서 §P4-4, 보고서 B4):
 * 처음 켤 때 한 번만 "속도와 음정이 함께 바뀝니다" 안내를 토스트로 띄운다.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext } from "./helpers/fake-audio.mjs";
import { makeDoc } from "./helpers/docs.mjs";

globalThis.window = {
  AudioContext: FakeContext,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};

const { useDawStore } = await import("../src/store/useDawStore.ts");
const { getDoc } = await import("../src/state/projectStore.ts");
const { history } = await import("../src/state/history.ts");
const { useNoticeStore } = await import("../src/state/noticeStore.ts");
const { ko } = await import("../src/i18n/ko.ts");
const { toggleTempoMatch } = await import("../src/app/tempoMatch.ts");
const { hasSeenTempoMatchNotice, markTempoMatchNoticeSeen, TEMPO_MATCH_NOTICE_STORAGE_KEY } = await import("../src/services/tempoMatchNotice.ts");

const toasts = () => useNoticeStore.getState().notices;
const clipOf = (id) => getDoc().tracks.flatMap((track) => track.clips).find((clip) => clip.id === id);

/** 안내를 보았는지를 메모리에 두는 가짜 */
function memoryDeps(seen = false) {
  const log = { marked: 0 };
  return {
    log,
    deps: {
      hasSeenNotice: () => seen,
      markNoticeSeen: () => {
        seen = true;
        log.marked += 1;
      },
    },
  };
}

beforeEach(() => {
  useNoticeStore.getState().reset();
  useDawStore.getState().importProject(makeDoc([0, 2]));
  history.clear();
});

test("처음 켜면 속도와 음정이 함께 바뀐다는 안내를 경고 토스트로 한 번 띄운다", () => {
  const { deps, log } = memoryDeps();
  assert.equal(toggleTempoMatch("c0", deps), true);
  assert.equal(clipOf("c0").stretchMode, "resample");
  assert.equal(toasts().length, 1);
  assert.equal(toasts()[0].level, "warning");
  assert.equal(toasts()[0].message, "지금은 속도와 음정이 함께 바뀝니다. 음정을 유지하는 방식은 나중에 추가합니다.");
  assert.equal(toasts()[0].message, ko.clip.tempoMatchPitchNotice);
  assert.equal(log.marked, 1);
});

test("껐다 다시 켜거나 다른 클립을 켜도 안내는 다시 뜨지 않는다", () => {
  const { deps, log } = memoryDeps();
  toggleTempoMatch("c0", deps);
  useNoticeStore.getState().reset();

  assert.equal(toggleTempoMatch("c0", deps), false);
  assert.equal(clipOf("c0").stretchMode, "none");
  assert.equal(toggleTempoMatch("c0", deps), true);
  assert.equal(toggleTempoMatch("c1", deps), true);
  assert.equal(toasts().length, 0, "처음 한 번뿐");
  assert.equal(log.marked, 1);
});

test("끄는 동작은 안내를 띄우지 않고, 안내를 이미 본 브라우저에서는 처음 켜도 띄우지 않는다", () => {
  const seen = memoryDeps(true);
  assert.equal(toggleTempoMatch("c0", seen.deps), true);
  assert.equal(toasts().length, 0);
  assert.equal(seen.log.marked, 0);

  const fresh = memoryDeps(false);
  useDawStore.getState().updateClip("c1", { stretchMode: "resample" });
  assert.equal(toggleTempoMatch("c1", fresh.deps), false, "켜져 있던 것을 끈다");
  assert.equal(toasts().length, 0);
  assert.equal(fresh.log.marked, 0, "끄는 것으로는 '본 것'이 되지 않는다");
});

test("켜고 끄는 것은 실행 취소로 되돌릴 수 있는 편집이다", () => {
  const { deps } = memoryDeps(true);
  toggleTempoMatch("c0", deps);
  assert.equal(history.depth().undo, 1);
  useDawStore.getState().undo();
  assert.equal(clipOf("c0").stretchMode, "none");
});

test("없는 클립이면 undefined이고 아무것도 하지 않는다", () => {
  const { deps, log } = memoryDeps();
  assert.equal(toggleTempoMatch("없는 클립", deps), undefined);
  assert.equal(toasts().length, 0);
  assert.equal(log.marked, 0);
  assert.equal(history.depth().undo, 0);
});

// ───── 저장소 서비스 ─────

test("서비스: 안내를 봤다는 표시를 저장소에 남기고 읽는다", () => {
  const map = new Map();
  const storage = { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)) };
  assert.equal(hasSeenTempoMatchNotice(storage), false);
  markTempoMatchNoticeSeen(storage);
  assert.equal(map.get(TEMPO_MATCH_NOTICE_STORAGE_KEY), "1");
  assert.equal(hasSeenTempoMatchNotice(storage), true);
});

test("서비스: 저장소를 못 쓰는 환경(없음·예외)에서도 오류 없이 '보지 않음'으로 동작한다", () => {
  assert.equal(hasSeenTempoMatchNotice(undefined), false);
  markTempoMatchNoticeSeen(undefined);
  const broken = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
  };
  assert.equal(hasSeenTempoMatchNotice(broken), false);
  markTempoMatchNoticeSeen(broken);
});
