/**
 * 업로드(app/importing.ts)와 "음원 다시 연결" 대화상자(app/relinking.ts)의 흐름. 소리 풀기만 가짜로 끼우고
 * 진짜 문서 저장소·원본 데이터 보관·파형 보관·안내·대화상자 상태를 이어 본다(설계서 §P4-2).
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext } from "./helpers/fake-audio.mjs";
import { makeClip } from "./helpers/docs.mjs";

const storage = new Map();
const localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, String(value)); },
  removeItem: (key) => { storage.delete(key); },
};
globalThis.window = { AudioContext: FakeContext, localStorage };

const { useDawStore } = await import("../src/store/useDawStore.ts");
const { getDoc } = await import("../src/state/projectStore.ts");
const { history } = await import("../src/state/history.ts");
const { importAudioFiles } = await import("../src/app/importing.ts");
const relinking = await import("../src/app/relinking.ts");
const { registerAutosave } = await import("../src/app/autosaveControl.ts");
const { useRelinkStore } = await import("../src/state/relinkStore.ts");
const { useNoticeStore } = await import("../src/state/noticeStore.ts");
const { forgetAllAudio, hasRememberedAudio, recallAudio } = await import("../src/services/persistence/audioBlobs.ts");
const { clearPeaks, getPeakSet } = await import("../src/services/peaksCache.ts");
const { audioEngine } = await import("../src/audio/currentEngine.ts");
const { sha256Hex } = await import("../src/services/persistence/assetHash.ts");
const { createDefaultTrack, createEmptyDoc } = await import("../src/domain/project/defaults.ts");

const flush = () => new Promise((resolve) => setImmediate(resolve));
const messages = () => useNoticeStore.getState().notices.map((notice) => notice.message);
const rowOf = (assetId) => useRelinkStore.getState().rows[assetId];
const fileOf = (name, bytes) => new File([new Uint8Array(bytes)], name, { type: "audio/wav" });

/** 아주 작은 가짜 소리 데이터(파형 계산이 읽는 모양) */
function fakeBuffer() {
  const data = new Float32Array(4096).fill(0.25);
  return { sampleRate: 44100, length: data.length, numberOfChannels: 1, getChannelData: () => data };
}

/** 조건이 될 때까지 기다린다(파형은 Worker가 없는 시험 환경에서 조각으로 나눠 계산하므로 몇 번 쉬고 끝난다) */
async function waitFor(check, message) {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

/** 소리 풀기를 가짜로: 파일 이름으로 길이를 정한다. 풀면 임시 음원 id(tmpN)로 올라가고, 이어 줄 때·버릴 때를 기록한다. */
function fakeDecoder(durations = {}) {
  const log = { decoded: [], registered: [], released: [] };
  let counter = 0;
  const decode = async (file) => {
    if (file.name === "깨진.wav") throw new Error("decode failed");
    const id = `tmp${++counter}`;
    log.decoded.push(file.name);
    return {
      asset: { id, fileName: file.name, duration: durations[file.name] ?? 10, sampleRate: 44100, channels: 2, source: "upload", mimeType: file.type || undefined, byteSize: file.size },
      registerAs: (assetId) => {
        log.registered.push(assetId);
        audioEngine.registerBuffer(assetId, fakeBuffer()); // 소리 엔진에 올라가면 파형 계산 대상이 된다
      },
      release: () => log.released.push(id),
    };
  };
  return { deps: { decode }, log };
}

const SOURCE = [1, 2, 3, 4];

/** 음원 a1(해시 기록됨)을 클립 3개가 쓰는데 데이터는 빠져 있는 프로젝트. a2는 해시 없는 옛 음원(클립 1개). */
async function loadProjectMissingAudio({ withSecondSameHash = false } = {}) {
  const hash = await sha256Hex(new Blob([new Uint8Array(SOURCE)]));
  const track = createDefaultTrack(1);
  track.clips = [
    makeClip(track.id, "c1", 0, { audioBufferId: "a1" }),
    makeClip(track.id, "c2", 2, { audioBufferId: "a1" }),
    makeClip(track.id, "c3", 4, { audioBufferId: "a1" }),
    makeClip(track.id, "c4", 6, { audioBufferId: "a2" }),
  ];
  const asset = (id, fileName, extra = {}) => ({ id, fileName, duration: 10, sampleRate: 44100, channels: 2, source: "upload", ...extra });
  const assets = { a1: asset("a1", "반주.wav", { hash }), a2: asset("a2", "옛 음원.wav") };
  if (withSecondSameHash) assets.a3 = asset("a3", "반주 사본.wav", { hash });
  useDawStore.getState().importProject({ ...createEmptyDoc(), tracks: [track], assets });
  history.clear();
  return { hash };
}

beforeEach(() => {
  forgetAllAudio();
  audioEngine.clearBuffers();
  clearPeaks();
  useNoticeStore.getState().reset();
  useRelinkStore.setState({ open: false, items: [], rows: {} });
  useDawStore.getState().importProject(createEmptyDoc());
  registerAutosave(undefined);
});

// ───── 평소 업로드 ─────

test("업로드: 데이터가 빠진 음원과 같은 파일(해시 같음)이면 새 클립 없이 기존 클립에 다시 연결한다", async () => {
  const { hash } = await loadProjectMissingAudio();
  let nudged = 0;
  registerAutosave({ changed: () => { nudged += 1; } });
  const { deps, log } = fakeDecoder();
  await importAudioFiles([fileOf("이름이 바뀐 파일.wav", SOURCE)], deps);

  const after = getDoc();
  assert.equal(after.tracks.length, 1, "트랙이 늘지 않는다");
  assert.equal(after.tracks[0].clips.length, 4, "클립이 늘지 않는다");
  assert.deepEqual(Object.keys(after.assets), ["a1", "a2"], "음원이 늘지 않는다");
  assert.equal(hasRememberedAudio("a1"), true);
  assert.equal(recallAudio("a1").size, SOURCE.length, "올린 파일의 원본 데이터를 기억한다");
  await waitFor(() => getPeakSet("a1") !== undefined, "다시 연결한 음원의 파형이 채워진다");
  assert.equal(getPeakSet("a1").frames, 4096);
  assert.deepEqual(log.registered, ["a1"], "소리 엔진에 a1 id로 올라간다");
  assert.deepEqual(log.released, ["tmp1"], "임시 id는 내린다");
  assert.equal(after.assets.a1.hash, hash);
  assert.equal(after.assets.a1.fileName, "반주.wav", "프로젝트가 부르던 이름은 그대로");
  assert.equal(history.depth().undo, 0, "실행 취소 기록에 남기지 않는다");
  assert.ok(messages().includes("이름이 바뀐 파일.wav: 기존 클립 3개에 다시 연결했습니다."), messages().join(" | "));
  assert.ok(nudged >= 1, "문서가 그대로여도 자동 저장을 예약한다");
});

test("업로드: 이름·길이만 비슷하고 해시가 다른 파일은 말없이 연결하지 않고 새 음원·새 클립으로 올린다", async () => {
  await loadProjectMissingAudio();
  const { deps } = fakeDecoder();

  await importAudioFiles([fileOf("반주.wav", [9, 9, 9, 9])], deps);

  const doc = getDoc();
  assert.equal(hasRememberedAudio("a1"), false, "빠진 음원은 그대로 빠져 있다");
  assert.equal(Object.keys(doc.assets).length, 3);
  const added = Object.values(doc.assets).find((asset) => asset.id !== "a1" && asset.id !== "a2");
  assert.equal(added.fileName, "반주.wav");
  assert.equal(added.hash, await sha256Hex(new Blob([new Uint8Array([9, 9, 9, 9])])), "새 음원에는 해시가 기록된다");
  assert.equal(hasRememberedAudio(added.id), true);
  const clipCount = doc.tracks.reduce((sum, track) => sum + track.clips.length, 0);
  assert.equal(clipCount, 5, "새 클립 1개");
});

test("업로드: 같은 파일을 두 번 올렸던 프로젝트라면 해시가 같은 빠진 음원 모두에 연결한다", async () => {
  await loadProjectMissingAudio({ withSecondSameHash: true });
  const { deps, log } = fakeDecoder();
  await importAudioFiles([fileOf("반주.wav", SOURCE)], deps);
  assert.equal(hasRememberedAudio("a1"), true);
  assert.equal(hasRememberedAudio("a3"), true);
  assert.deepEqual(log.registered.sort(), ["a1", "a3"]);
});

test("업로드: 읽을 수 없는 파일은 안내하고 나머지 파일은 계속 올린다", async () => {
  const { deps } = fakeDecoder();
  await importAudioFiles([fileOf("깨진.wav", [0]), fileOf("정상.wav", [5, 6])], deps);
  assert.equal(Object.values(getDoc().assets).filter((asset) => asset.fileName === "정상.wav").length, 1);
  assert.ok(messages().some((message) => message.includes("깨진.wav")));
});

// ───── 재연결 대화상자 ─────

test("대화상자를 열면 빠진 음원의 이름·길이·쓰는 클립 수가 나온다. 빠진 것이 없으면 빈 목록이다", async () => {
  await loadProjectMissingAudio();
  relinking.openRelinkDialog();
  const state = useRelinkStore.getState();
  assert.equal(state.open, true);
  assert.deepEqual(state.items.map((item) => [item.assetId, item.fileName, item.duration, item.clipCount]), [["a1", "반주.wav", 10, 3], ["a2", "옛 음원.wav", 10, 1]]);
  assert.deepEqual(Object.values(state.rows), [{ kind: "waiting" }, { kind: "waiting" }]);

  useRelinkStore.setState({ open: false });
  useDawStore.getState().importProject(createEmptyDoc());
  relinking.openRelinkDialog();
  assert.deepEqual(useRelinkStore.getState().items, []);
});

test("대화상자: 같은 파일(해시 같음)을 고르면 확인 없이 연결하고, 같은 해시의 다른 빠진 음원도 함께 연결한다", async () => {
  await loadProjectMissingAudio({ withSecondSameHash: true });
  relinking.openRelinkDialog();
  const { deps, log } = fakeDecoder({ "다른 이름.wav": 99 });

  await relinking.chooseRelinkFile("a1", fileOf("다른 이름.wav", SOURCE), deps);

  assert.deepEqual(rowOf("a1"), { kind: "linked", sameFile: true });
  assert.deepEqual(rowOf("a3"), { kind: "linked", sameFile: true });
  assert.deepEqual(rowOf("a2"), { kind: "waiting" });
  assert.equal(hasRememberedAudio("a1"), true);
  assert.equal(hasRememberedAudio("a3"), true);
  assert.equal(hasRememberedAudio("a2"), false);
  assert.deepEqual(log.registered.sort(), ["a1", "a3"]);
  assert.equal(getDoc().tracks[0].clips.length, 4, "클립 수는 그대로");
});

test("대화상자: 이름이 같고 길이가 비슷하면 확인을 묻고, [연결]을 눌러야 연결한다(해시를 모르는 옛 음원 포함)", async () => {
  await loadProjectMissingAudio();
  relinking.openRelinkDialog();
  const { deps, log } = fakeDecoder({ "옛 음원.wav": 10.2 });

  await relinking.chooseRelinkFile("a2", fileOf("옛 음원.wav", [7, 7]), deps);
  assert.deepEqual(rowOf("a2"), { kind: "confirm", fileName: "옛 음원.wav", duration: 10.2 });
  assert.equal(hasRememberedAudio("a2"), false, "확인 전에는 연결하지 않는다");
  assert.deepEqual(log.registered, []);

  relinking.confirmRelinkFile("a2");
  assert.deepEqual(rowOf("a2"), { kind: "linked", sameFile: false });
  assert.equal(hasRememberedAudio("a2"), true);
  assert.deepEqual(log.registered, ["a2"]);
  const asset = getDoc().assets.a2;
  assert.equal(asset.duration, 10.2, "연결한 파일의 길이로 음원 정보를 맞춘다");
  assert.equal(asset.hash, await sha256Hex(new Blob([new Uint8Array([7, 7])])));
  assert.equal(asset.fileName, "옛 음원.wav");
  assert.equal(getDoc().tracks[0].clips.length, 4, "클립 수는 그대로");
});

test("대화상자: 확인에서 [취소]하면 연결하지 않고 임시로 푼 소리를 내린다", async () => {
  await loadProjectMissingAudio();
  relinking.openRelinkDialog();
  const { deps, log } = fakeDecoder();
  await relinking.chooseRelinkFile("a2", fileOf("옛 음원.wav", [7, 7]), deps);
  relinking.declineRelinkFile("a2");
  assert.deepEqual(rowOf("a2"), { kind: "waiting" });
  assert.equal(hasRememberedAudio("a2"), false);
  assert.deepEqual(log.released, ["tmp1"]);
  assert.deepEqual(log.registered, []);
});

test("대화상자: 다른 파일은 연결하지 않고 이유(길이 / 이름)를 보인다", async () => {
  await loadProjectMissingAudio();
  relinking.openRelinkDialog();
  const { deps, log } = fakeDecoder({ "반주.wav": 220, "엉뚱한 이름.wav": 10 });

  await relinking.chooseRelinkFile("a1", fileOf("반주.wav", [8, 8]), deps);
  assert.deepEqual(rowOf("a1"), { kind: "different", reason: "length", actualDuration: 220 });
  await relinking.chooseRelinkFile("a1", fileOf("엉뚱한 이름.wav", [8, 9]), deps);
  assert.deepEqual(rowOf("a1"), { kind: "different", reason: "name", actualDuration: 10 });
  assert.equal(hasRememberedAudio("a1"), false);
  assert.deepEqual(log.registered, []);
  assert.deepEqual(log.released, ["tmp1", "tmp2"], "쓰지 않은 소리는 모두 내린다");
});

test("대화상자: 읽을 수 없는 파일이면 그 줄에 실패를 보이고 다시 고를 수 있다", async () => {
  await loadProjectMissingAudio();
  relinking.openRelinkDialog();
  const { deps } = fakeDecoder();
  await relinking.chooseRelinkFile("a1", fileOf("깨진.wav", [0]), deps);
  assert.deepEqual(rowOf("a1"), { kind: "failed", fileName: "깨진.wav" });
  assert.ok(messages().some((message) => message.includes("깨진.wav")));
  await relinking.chooseRelinkFile("a1", fileOf("반주.wav", SOURCE), deps);
  assert.deepEqual(rowOf("a1"), { kind: "linked", sameFile: true });
});

test("대화상자를 닫으면 확인 대기 파일을 버리고 연결 결과를 알린다", async () => {
  await loadProjectMissingAudio();
  relinking.openRelinkDialog();
  const { deps, log } = fakeDecoder();
  await relinking.chooseRelinkFile("a1", fileOf("반주.wav", SOURCE), deps); // 같은 파일 → 연결
  await relinking.chooseRelinkFile("a2", fileOf("옛 음원.wav", [7]), deps); // 비슷한 파일 → 확인 대기
  relinking.closeRelinkDialog();
  assert.equal(useRelinkStore.getState().open, false);
  assert.equal(hasRememberedAudio("a2"), false, "확인하지 않은 파일은 연결하지 않는다");
  assert.deepEqual(log.released.filter((id) => id === "tmp2"), ["tmp2"], "대기 중이던 파일의 소리를 내린다");
  assert.ok(messages().includes("음원 1개를 다시 연결했습니다. 1개는 아직 연결되지 않았습니다."), messages().join(" | "));

  useNoticeStore.getState().reset();
  relinking.openRelinkDialog();
  assert.equal(useRelinkStore.getState().items.length, 1, "다시 열면 아직 빠진 것만 나온다");
  relinking.closeRelinkDialog();
  assert.deepEqual(messages(), [], "연결한 것이 없으면 아무 말도 하지 않는다");
  await flush();
});
