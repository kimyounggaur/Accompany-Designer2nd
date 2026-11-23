import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext } from "./helpers/fake-audio.mjs";

globalThis.window = { AudioContext: FakeContext };

const { projectStore, getDoc } = await import("../src/state/projectStore.ts");
const { history } = await import("../src/state/history.ts");
const commands = await import("../src/state/commands/index.ts");
const { createEmptyDoc } = await import("../src/state/docDefaults.ts");
const { getProjectSnapshot } = await import("../src/app/projectSnapshot.ts");
const { connectEngineSync } = await import("../src/app/engineSync.ts");
const { documentChanged } = await import("../src/services/persistence/projectRecord.ts");
const { parseProjectFile } = await import("../src/storage/projectStorage.ts");
const { useDawStore } = await import("../src/store/useDawStore.ts");
const { normalizeMasterVolumeDb } = await import("../src/domain/master/volume.ts");

function resetStore(doc = createEmptyDoc()) {
  projectStore.setState({ doc });
  history.clear();
}

beforeEach(() => resetStore());

test("새 문서의 마스터 볼륨은 0 dB다", () => {
  assert.deepEqual(createEmptyDoc().master, { volumeDb: 0 });
  assert.deepEqual(getDoc().master, { volumeDb: 0 });
});

test("마스터 볼륨을 바꾸면 문서에 들어가고 실행 취소로 돌아온다", () => {
  const before = getDoc();
  assert.equal(commands.setMasterVolumeDb(-6), true);
  assert.equal(getDoc().master.volumeDb, -6);
  assert.equal(getDoc().tracks, before.tracks, "트랙은 건드리지 않는다");
  assert.equal(history.undoLabel(), "마스터 볼륨 변경");
  assert.equal(history.undo(), true);
  assert.equal(getDoc().master.volumeDb, 0);
  assert.equal(history.redo(), true);
  assert.equal(getDoc().master.volumeDb, -6);
});

test("범위(−60 ~ +6)로 맞추고 소수 첫째 자리로 반올림한다", () => {
  commands.setMasterVolumeDb(-100);
  assert.equal(getDoc().master.volumeDb, -60);
  commands.setMasterVolumeDb(20);
  assert.equal(getDoc().master.volumeDb, 6);
  commands.setMasterVolumeDb(-6.04);
  assert.equal(getDoc().master.volumeDb, -6);
  commands.setMasterVolumeDb(-6.06);
  assert.equal(getDoc().master.volumeDb, -6.1);
  commands.setMasterVolumeDb(Number.NaN);
  assert.equal(getDoc().master.volumeDb, 0);
  assert.ok(Object.is(normalizeMasterVolumeDb(-0.04), 0), "−0은 0으로");
});

test("값이 그대로면 이력에 남기지 않는다", () => {
  assert.equal(commands.setMasterVolumeDb(0), false);
  assert.deepEqual(history.depth(), { undo: 0, redo: 0 });
  commands.setMasterVolumeDb(-3);
  const doc = getDoc();
  assert.equal(commands.setMasterVolumeDb(-3.04), false, "반올림하면 같은 값");
  assert.equal(getDoc(), doc);
});

test("마스터가 없는 옛 문서는 0 dB로 보고, 0 dB로 맞추는 것은 변경이 아니다", () => {
  const legacy = createEmptyDoc();
  delete legacy.master;
  resetStore(legacy);
  assert.equal(commands.setMasterVolumeDb(0), false);
  assert.equal(getDoc().master, undefined);
  assert.equal(commands.setMasterVolumeDb(-3), true);
  assert.equal(getDoc().master.volumeDb, -3);
  assert.equal(history.undo(), true);
  assert.equal(getDoc().master, undefined, "되돌리면 원래 문서(마스터 없음) 그대로");
});

test("끌면서 이어지는 변경은 한 단계로 묶인다", () => {
  for (const db of [-1, -2, -3, -4, -5]) commands.setMasterVolumeDb(db);
  assert.equal(getDoc().master.volumeDb, -5);
  assert.equal(history.depth().undo, 1);
  history.undo();
  assert.equal(getDoc().master.volumeDb, 0);
});

test("프로젝트를 열면 마스터 볼륨도 따라오고, 없거나 범위 밖이면 보정한다", () => {
  const project = (master) => ({ ...createEmptyDoc(), id: "p", ...(master === undefined ? {} : { master }) });
  const noMaster = project();
  delete noMaster.master;
  commands.setMasterVolumeDb(-9);
  commands.replaceDoc(noMaster);
  assert.deepEqual(getDoc().master, { volumeDb: 0 }, "옛 프로젝트는 0 dB");
  commands.replaceDoc(project({ volumeDb: -12 }));
  assert.equal(getDoc().master.volumeDb, -12);
  commands.replaceDoc(project({ volumeDb: 40 }));
  assert.equal(getDoc().master.volumeDb, 6);
});

test("새 프로젝트는 마스터 볼륨을 0 dB로 되돌린다", () => {
  commands.setMasterVolumeDb(-20);
  commands.resetDoc();
  assert.equal(getDoc().master.volumeDb, 0);
});

test("저장용 스냅샷과 화면 저장소에 마스터가 비친다", () => {
  commands.setMasterVolumeDb(-4.5);
  assert.deepEqual(getProjectSnapshot().master, { volumeDb: -4.5 });
  assert.deepEqual(useDawStore.getState().master, { volumeDb: -4.5 });
});

test("자동 저장은 마스터만 바뀌어도 저장 대상으로 본다", () => {
  const base = { name: "a", bpm: 120, tracks: [], audioAssets: {}, timeMarkers: [] };
  const master = { volumeDb: 0 };
  assert.equal(documentChanged({ ...base, master }, { ...base, master }), false);
  assert.equal(documentChanged({ ...base, master: { volumeDb: -3 } }, { ...base, master }), true);
});

test("마스터만 바뀌어도 엔진에 알린다(트랙 참조는 그대로)", () => {
  const calls = [];
  const off = connectEngineSync({ sync: (doc, previous) => calls.push({ doc, previous }) });
  const before = getDoc();
  commands.setMasterVolumeDb(-6);
  off();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].previous, before);
  assert.equal(calls[0].doc.master.volumeDb, -6);
  assert.equal(calls[0].doc.tracks, before.tracks);
});

const file = (value) => new File([JSON.stringify(value)], "session.json", { type: "application/json" });
const stored = (project) => ({ format: "accompany-designer-project", version: 1, project, audio: {} });

test("저장 파일: 마스터가 없어도(옛 파일) 열리고, 있으면 그대로 읽는다", async () => {
  const project = { ...createEmptyDoc() };
  delete project.master;
  assert.equal((await parseProjectFile(file(stored(project)))).project.master, undefined);
  const withMaster = { ...project, master: { volumeDb: -6 } };
  assert.deepEqual((await parseProjectFile(file(stored(withMaster)))).project.master, { volumeDb: -6 });
});

test("저장 파일: 마스터 모양이 틀리면 거부한다", async () => {
  for (const master of ["bad", { volumeDb: "x" }, {}, { volumeDb: Number.POSITIVE_INFINITY }, [], null]) {
    const project = { ...createEmptyDoc(), master };
    await assert.rejects(parseProjectFile(file(stored(project))), undefined, JSON.stringify(master));
  }
});
