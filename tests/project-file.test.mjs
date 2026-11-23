import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createEmptyDoc } from "../src/domain/project/defaults.ts";
import { FORMAT, SCHEMA_VERSION } from "../src/domain/project/serialize.ts";
import { forgetAllAudio, hasRememberedAudio, recallAudio, rememberAudio } from "../src/services/persistence/audioBlobs.ts";
import { exportProjectFile, projectFailure, projectFromJson, readProjectFile, restoreAudio } from "../src/services/persistence/projectFile.ts";
import { sha256Hex } from "../src/services/persistence/assetHash.ts";
import { clearPeaks, getPeaks, setPeaks } from "../src/services/peaksCache.ts";
import { ko } from "../src/i18n/ko.ts";

// 6월 프로젝트(v0) 모양: 껍데기 없이 프로젝트 JSON 그대로. 이펙트 설정이 없고 음원에 blobUrl·파형이 있다.
const legacyProject = () => ({
  id: "p1", name: "테스트", bpm: 120, sampleRate: 44100,
  tracks: [{ id: "t1", name: "트랙 1", volume: 0.86, pan: 0, muted: false, solo: false,
    clips: [{ id: "c1", audioBufferId: "a1", trackId: "t1", name: "음원", startTime: 0, offset: 0, duration: 1, sourceBpm: 120, stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0 }] }],
  audioAssets: { a1: { id: "a1", fileName: "음원.wav", duration: 1, sampleRate: 44100, channels: 1, waveformPeaks: [0, 1], blobUrl: "javascript:alert(1)" } },
  timeMarkers: [],
});
const file = (value) => new File([JSON.stringify(value)], "session.json", { type: "application/json" });

beforeEach(() => {
  forgetAllAudio();
  clearPeaks();
});

test("6월 프로젝트는 이펙트 설정이 없어도 열리고(기본값), 주소 문자열은 가져오지 않는다", async () => {
  const loaded = await readProjectFile(file(legacyProject()));
  assert.equal(loaded.doc.tracks[0].eq.enabled, true, "빠진 이펙트 설정은 기본값");
  assert.equal(loaded.doc.assets.a1.fileName, "음원.wav");
  assert.equal("blobUrl" in loaded.doc.assets.a1, false);
  assert.equal("waveformPeaks" in loaded.doc.assets.a1, false);
  assert.equal(loaded.doc.assets.a1.source, "upload");
  assert.deepEqual(Object.keys(loaded.audio), [], "6월 파일에는 음원 데이터가 없다");
  const restored = await restoreAudio(loaded, async () => { throw new Error("풀 음원이 없어야 한다"); });
  assert.equal(restored.missing, 1);
});

test("망가지거나 악의적인 이펙트 설정은 거부하고, 부른 쪽 상태는 그대로 둔다", async () => {
  const damages = [
    (p) => (p.tracks[0].effectChain = [null]),
    (p) => (p.tracks[0].eq = "bad"),
    (p) => (p.tracks[0].compressor = { ratio: "bad" }),
    (p) => (p.tracks[0].delay = { enabled: "yes" }),
    (p) => (p.tracks[0].reverb = { mode: "wrong" }),
    (p) => (p.tracks[0].clips[0].gain = null),
  ];
  for (const damage of damages) {
    const project = legacyProject();
    damage(project);
    await assert.rejects(readProjectFile(file(project)));
  }
});

test("모르는 문서와 지원하지 않는 버전은 한국어 사유로 거부한다", async () => {
  await assert.rejects(readProjectFile(file({ anything: true })), { message: ko.error.projectUnsupported });
  await assert.rejects(
    readProjectFile(file({ format: FORMAT, version: 99, project: legacyProject(), audio: {} })),
    { message: ko.error.projectUnsupported },
  );
  await assert.rejects(readProjectFile(new File(["not json"], "x.json")), SyntaxError);
});

test("프로젝트 안의 값이 틀리면 어디가 틀렸는지 알려 준다", () => {
  const project = legacyProject();
  project.tracks[0].clips[0].gain = null;
  const error = (() => { try { projectFromJson(project); } catch (caught) { return caught; } })();
  assert.ok(error instanceof Error);
  assert.match(error.message, /tracks\[0\]\.clips\[0\]\.gain/);
  assert.equal(projectFailure([]).message, ko.error.projectBroken(""));
});

test("음원은 내장된 base64 데이터만 풀고, 원격 주소나 스크립트는 받지 않는다", async () => {
  const project = legacyProject();
  const base = { format: FORMAT, version: 1, project, audio: { a1: "data:audio/wav;base64,AQID" } };
  const valid = await readProjectFile(file(base));
  assert.deepEqual([...new Uint8Array(await valid.audio.a1.arrayBuffer())], [1, 2, 3]);
  for (const bad of ["javascript:alert(1)", "https://example.com/a.wav", "blob:http://x/1", "data:audio/wav;base64,@@@"]) {
    await assert.rejects(readProjectFile(file({ ...base, audio: { a1: bad } })), { message: ko.error.projectAudioData }, bad);
  }
  // 문서에 없는 음원 id나 객체의 기본 속성 이름은 음원으로 받지 않는다.
  await assert.rejects(readProjectFile(file({ ...base, audio: { zz: "data:audio/wav;base64,AQID" } })), { message: ko.error.projectAudioData });
  await assert.rejects(readProjectFile(file({ ...base, audio: [] })), { message: ko.error.projectUnsupported });
  await assert.rejects(readProjectFile(file({ format: FORMAT, version: 1, project })), { message: ko.error.projectUnsupported }, "껍데기에는 음원 목록이 있어야 한다");
});

test("내보낸 프로젝트를 다시 읽으면 문서와 음원이 그대로 돌아온다(왕복)", async () => {
  const doc = createEmptyDoc();
  doc.assets.a1 = { id: "a1", fileName: "녹음 001.wav", duration: 2, sampleRate: 44100, channels: 1, source: "recording", mimeType: "audio/wav", byteSize: 3 };
  doc.assets.a2 = { id: "a2", fileName: "데이터 없는 음원.wav", duration: 1, sampleRate: 48000, channels: 2, source: "upload" };
  const bytes = new Blob([new Uint8Array([7, 8, 9])], { type: "audio/wav" });
  const blob = await exportProjectFile(doc, (id) => (id === "a1" ? bytes : undefined));
  assert.equal(blob.type, "application/zip");

  const loaded = await readProjectFile(blob);
  // 담은 음원의 해시는 데이터에서 다시 계산해 문서에 적힌다. 데이터가 없는 음원은 그대로다.
  const expected = structuredClone(doc);
  expected.assets.a1.hash = await sha256Hex(bytes);
  assert.deepEqual(loaded.doc, expected);
  assert.deepEqual(loaded.issues, []);
  assert.deepEqual(Object.keys(loaded.audio), ["a1"], "데이터를 기억하는 음원만 담긴다");
  assert.deepEqual([...new Uint8Array(await loaded.audio.a1.arrayBuffer())], [7, 8, 9]);
  assert.equal(loaded.audio.a1.type, "audio/wav");
});

test("restoreAudio: 풀기가 끝나기 전에는 아무것도 바꾸지 않고, commit에서 한꺼번에 바꾼다", async () => {
  const doc = createEmptyDoc();
  doc.assets.a1 = { id: "a1", fileName: "a.wav", duration: 1, sampleRate: 44100, channels: 1, source: "upload" };
  doc.assets.a2 = { id: "a2", fileName: "b.wav", duration: 1, sampleRate: 44100, channels: 1, source: "upload" };
  doc.assets.a3 = { id: "a3", fileName: "c.wav", duration: 1, sampleRate: 44100, channels: 1, source: "upload" };

  // 지금 열려 있는 프로젝트의 음원·파형
  rememberAudio("old", new Blob([new Uint8Array([1])]));
  setPeaks("old", [0.5]);

  const blobs = { a1: new Blob([new Uint8Array([1, 2])]), a2: new Blob([new Uint8Array([3])]) };
  const committed = [];
  const restored = await restoreAudio({ doc, audio: blobs }, async (blob, asset) => ({ commit: () => committed.push(asset.id) }));
  assert.equal(restored.missing, 1, "a3은 데이터가 없다");
  // 해시가 없던 음원은 데이터에서 계산해 돌려주는 문서에 채운다(원래 문서는 건드리지 않는다).
  assert.equal(restored.doc.assets.a1.hash, await sha256Hex(blobs.a1));
  assert.equal(restored.doc.assets.a2.hash, await sha256Hex(blobs.a2));
  assert.equal(restored.doc.assets.a3.hash, undefined);
  assert.equal(doc.assets.a1.hash, undefined);
  assert.deepEqual(committed, []);
  assert.equal(hasRememberedAudio("old"), true, "commit 전에는 지금 것을 그대로 둔다");
  assert.deepEqual(getPeaks("old"), [0.5]);

  restored.commit();
  assert.deepEqual(committed, ["a1", "a2"]);
  assert.equal(hasRememberedAudio("old"), false);
  assert.equal(getPeaks("old"), undefined);
  assert.equal(recallAudio("a1"), blobs.a1);
  assert.equal(recallAudio("a2"), blobs.a2);
  assert.equal(hasRememberedAudio("a3"), false);
});

test("restoreAudio: 풀다가 실패하면 던지고, 지금 프로젝트는 그대로다", async () => {
  const doc = createEmptyDoc();
  doc.assets.a1 = { id: "a1", fileName: "a.wav", duration: 1, sampleRate: 44100, channels: 1, source: "upload" };
  rememberAudio("old", new Blob([new Uint8Array([1])]));
  await assert.rejects(
    restoreAudio({ doc, audio: { a1: new Blob([new Uint8Array([1])]) } }, async () => { throw new Error("디코드 실패"); }),
    { message: "디코드 실패" },
  );
  assert.equal(hasRememberedAudio("old"), true);
});

test("restoreAudio: 객체의 기본 속성 이름(constructor 등)을 음원으로 읽지 않는다", async () => {
  const doc = createEmptyDoc();
  doc.assets.a1 = { id: "a1", fileName: "a.wav", duration: 1, sampleRate: 44100, channels: 1, source: "upload" };
  const restored = await restoreAudio({ doc, audio: {} }, async () => { throw new Error("풀 음원이 없어야 한다"); });
  assert.equal(restored.missing, 1);
});
