import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext } from "./helpers/fake-audio.mjs";

globalThis.window = { AudioContext: FakeContext };

const { projectStore, getDoc } = await import("../src/state/projectStore.ts");
const { history } = await import("../src/state/history.ts");
const commands = await import("../src/state/commands/index.ts");
const { createEmptyDoc } = await import("../src/domain/project/defaults.ts");
const { getProjectSnapshot } = await import("../src/app/projectSnapshot.ts");
const { connectEngineSync } = await import("../src/app/engineSync.ts");
const { documentChanged } = await import("../src/services/persistence/projectRecord.ts");
const { projectFromJson } = await import("../src/services/persistence/projectFile.ts");
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

// 파일은 JSON을 거치므로(Infinity는 null이 된다) 같은 길을 따라 만든다.
const viaJson = (value) => JSON.parse(JSON.stringify(value));
const stored = (project) => viaJson({ format: "accompany-designer-project", version: 1, project, audio: {} });
/** 6월~11월 초의 프로젝트 모양(v1 껍데기 안): 음원 목록 이름이 audioAssets, 마커 이름이 timeMarkers */
function legacyProject() {
  const { schemaVersion, timeSignature, assets, markers, ...rest } = createEmptyDoc();
  return { ...rest, audioAssets: {}, timeMarkers: [] };
}

test("프로젝트를 열면 마스터 볼륨도 따라온다(없는 옛 파일은 0 dB, 범위 밖은 읽을 때 한 번 보정한다)", () => {
  // 채우기·보정은 문서를 바꾸는 쪽(replaceDoc)이 아니라 읽는 쪽(검사기)이 한다.
  const open = (master) => {
    const project = legacyProject();
    if (master === undefined) delete project.master;
    else project.master = master;
    commands.replaceDoc(projectFromJson(stored(project)).doc);
  };
  commands.setMasterVolumeDb(-9);
  open(undefined);
  assert.deepEqual(getDoc().master, { volumeDb: 0 }, "옛 프로젝트는 0 dB");
  open({ volumeDb: -12 });
  assert.equal(getDoc().master.volumeDb, -12);
  open({ volumeDb: 40 });
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
  const base = { name: "a", bpm: 120, tracks: [], assets: {}, markers: [] };
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

test("저장 파일: 마스터가 없어도(옛 파일) 열리고 0 dB로 채워지며, 있으면 그대로 읽는다", () => {
  const project = legacyProject();
  delete project.master;
  assert.deepEqual(projectFromJson(stored(project)).doc.master, { volumeDb: 0 });
  const withMaster = { ...project, master: { volumeDb: -6 } };
  assert.deepEqual(projectFromJson(stored(withMaster)).doc.master, { volumeDb: -6 });
});

test("저장 파일: 마스터 모양이 틀리면 거부한다", () => {
  for (const master of ["bad", { volumeDb: "x" }, {}, { volumeDb: Number.POSITIVE_INFINITY }, [], null]) {
    const project = { ...legacyProject(), master };
    assert.throws(() => projectFromJson(stored(project)), undefined, JSON.stringify(master));
  }
});

test("저장 파일: 마스터 볼륨이 범위를 벗어나면 가까운 값으로 고친다", () => {
  const loaded = projectFromJson(stored({ ...legacyProject(), master: { volumeDb: 40 } }));
  assert.equal(loaded.doc.master.volumeDb, 6);
  assert.ok(loaded.issues.some((issue) => issue.path === "master.volumeDb" && issue.fixed));
});
