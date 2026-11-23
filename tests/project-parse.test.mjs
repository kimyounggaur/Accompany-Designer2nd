/**
 * P4-1 문서 형식 v2와 검사기 하나(parseProject·parsePreset) 단위 시험.
 * 수용 기준: 6월·11월 표본을 v2로 바꿈 / 악성 값 6종 거부 + 거대 숫자·NaN·음수 길이 보정 + 프리셋 악성 파일 거부 / 왕복 같음.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseProject } from "../src/domain/project/parseProject.ts";
import { parsePreset, parsePresetList } from "../src/domain/project/parsePreset.ts";
import { serialize, FORMAT, SCHEMA_VERSION } from "../src/domain/project/serialize.ts";
import { countFixed } from "../src/domain/project/issues.ts";
import { createDefaultTrack, createEmptyDoc, DEFAULT_DELAY_SETTINGS } from "../src/domain/project/defaults.ts";
import { MAX_CLIPS, MAX_MARKERS, MAX_NAME_LENGTH, MAX_TIME_SECONDS, MAX_TRACKS } from "../src/domain/project/ranges.ts";

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const v0 = () => fixture("project-v0.json");
const v1 = () => fixture("project-v1.json");

/** v2 문서 하나(트랙 1개·클립 1개·음원 1개·마커 1개) */
function sampleDoc() {
  const doc = createEmptyDoc();
  doc.name = "시험 곡";
  doc.bpm = 96;
  doc.master = { volumeDb: -6 };
  const track = doc.tracks[0];
  track.clips = [{
    id: "c1", audioBufferId: "a1", name: "음원.wav", trackId: track.id, startTime: 1.5, offset: 0.25, duration: 4,
    sourceBpm: 100, stretchMode: "resample", gain: 0.9, fadeIn: 0.5, fadeOut: 1, fadeCurve: "linear", muted: false,
  }];
  doc.assets = { a1: { id: "a1", fileName: "음원.wav", duration: 4.25, sampleRate: 44100, channels: 2, source: "upload", mimeType: "audio/wav", byteSize: 750000 } };
  doc.markers = [{ id: "m1", time: 2, name: "후렴" }];
  return doc;
}

const values = (parsed) => {
  assert.equal(parsed.ok, true, JSON.stringify(parsed.issues));
  return parsed.value;
};

// ─────────────── 6월·11월 표본 → v2 ───────────────

test("6월 형식(v0) 표본을 읽어 v2로 바꾼다: 이름 변경, 파형·주소 제거, 박자표·마스터 추가", () => {
  const parsed = parseProject(v0());
  const doc = values(parsed);
  assert.equal(doc.schemaVersion, 2);
  assert.deepEqual(doc.timeSignature, { beats: 4, unit: 4 });
  assert.deepEqual(doc.master, { volumeDb: 0 });
  assert.equal("audioAssets" in doc, false);
  assert.equal("timeMarkers" in doc, false);
  assert.deepEqual(Object.keys(doc.assets), ["asset-1", "asset-2"]);
  assert.deepEqual(doc.markers, [{ id: "marker-1", time: 4, name: "후렴" }]);

  const [upload, recording] = [doc.assets["asset-1"], doc.assets["asset-2"]];
  assert.equal(upload.source, "upload"); // sourceType가 없던 음원은 올린 음원
  assert.equal(recording.source, "recording"); // sourceType → source
  for (const asset of [upload, recording]) {
    assert.equal("waveformPeaks" in asset, false);
    assert.equal("blobUrl" in asset, false);
    assert.equal("sourceType" in asset, false);
  }
  assert.equal(recording.recordedAt, "2026-06-12T05:14:09.120Z");
  assert.equal(recording.detectedBpm, 98);
  assert.equal(recording.byteSize, 307244);
  assert.equal(upload.hash, undefined);
});

test("옛 낮은음·중간음 EQ는 새 칸으로 옮기고, 이 값들은 고친 것으로 세지 않는다", () => {
  const parsed = parseProject(v0());
  const eq = values(parsed).tracks[1].eq;
  assert.deepEqual(eq, { enabled: true, bassGain: 3, middleLowGain: -2, middleHighGain: -2, highGain: 1, presenceGain: 0 });
  assert.deepEqual(parsed.issues, []); // 표본 파일은 범위 안이라 고친 값이 없다
});

test("11월 형식(v1) 표본({ format, version: 1, project, audio })을 읽어 v2로 바꾼다", () => {
  const doc = values(parseProject(v1()));
  assert.equal(doc.id, "project-nov");
  assert.equal(doc.schemaVersion, 2);
  assert.deepEqual(doc.master, { volumeDb: 0 }); // 11월에는 마스터가 없었다
  assert.equal(doc.tracks.length, 2);
  assert.equal(doc.tracks[0].clips.length, 2);
  assert.deepEqual(Object.keys(doc.assets), ["asset-1", "asset-2"]);
});

test("v1 껍데기에 마스터가 들어 있으면 그대로 옮기고, 범위 밖이면 고친다", () => {
  const file = v1();
  file.project.master = { volumeDb: -12.34 };
  assert.deepEqual(values(parseProject(file)).master, { volumeDb: -12.3 }); // 소수 첫째 자리까지
  file.project.master = { volumeDb: 99 };
  const parsed = parseProject(file);
  assert.deepEqual(values(parsed).master, { volumeDb: 6 });
  assert.deepEqual(parsed.issues, [{ path: "master.volumeDb", problem: "range", fixed: true }]);
});

test("v0과 v1의 같은 프로젝트는 같은 v2 문서가 된다(이펙트 슬롯 id 같은 표본값까지)", () => {
  const file = v1();
  file.project = v0();
  assert.deepEqual(values(parseProject(file)), values(parseProject(v0())));
});

// ─────────────── v2와 왕복 ───────────────

test("왕복: parseProject(serialize(doc)).value 는 원래 doc과 같다", () => {
  const doc = sampleDoc();
  const parsed = parseProject(serialize(doc));
  assert.deepEqual(values(parsed), doc);
  assert.deepEqual(parsed.issues, []);
  // 글자로 만들었다 읽어도 같다
  assert.deepEqual(values(parseProject(JSON.parse(JSON.stringify(serialize(doc))))), doc);
});

test("v2 문서 자체(껍데기 없이)도 읽는다. 껍데기는 format과 schemaVersion을 가진다", () => {
  const doc = sampleDoc();
  assert.deepEqual(values(parseProject(doc)), doc);
  const file = serialize(doc);
  assert.equal(file.format, FORMAT);
  assert.equal(file.schemaVersion, SCHEMA_VERSION);
  assert.equal(file.doc, doc);
});

test("빈 프로젝트와 트랙 여러 개도 왕복한다", () => {
  const empty = createEmptyDoc();
  assert.deepEqual(values(parseProject(serialize(empty))), empty);
  const many = createEmptyDoc();
  many.tracks = [createDefaultTrack(1), createDefaultTrack(2), createDefaultTrack(3)];
  many.tracks[1].delay = { ...DEFAULT_DELAY_SETTINGS, enabled: true, syncEnabled: true, syncDivision: "1/8d" };
  assert.deepEqual(values(parseProject(serialize(many))), many);
});

test("읽은 문서는 입력과 따로 만든 값이다(입력을 바꾸지 않고, 입력이 바뀌어도 영향이 없다)", () => {
  const raw = serialize(sampleDoc());
  const before = JSON.stringify(raw);
  const doc = values(parseProject(raw));
  assert.equal(JSON.stringify(raw), before);
  assert.notEqual(doc.tracks[0], raw.doc.tracks[0]);
});

// ─────────────── 거부(악성·망가진 값) ───────────────

test("codex의 악성 값 6종을 거부한다: 아무것도 만들지 않고 못 고친 문제를 알려 준다", () => {
  const damages = [
    ["effectChain", (p) => { p.tracks[0].effectChain = [null]; }],
    ["eq", (p) => { p.tracks[0].eq = "bad"; }],
    ["compressor", (p) => { p.tracks[0].compressor = { ratio: "bad" }; }],
    ["delay", (p) => { p.tracks[0].delay = { enabled: "yes" }; }],
    ["reverb", (p) => { p.tracks[0].reverb = { mode: "wrong" }; }],
    ["clip gain", (p) => { p.tracks[0].clips[0].gain = null; }],
  ];
  for (const [label, damage] of damages) {
    for (const make of [v0, () => ({ ...v1(), project: v0() })]) {
      const input = make();
      damage(input.project ?? input);
      const parsed = parseProject(input);
      assert.equal(parsed.ok, false, label);
      assert.ok(parsed.issues.some((issue) => !issue.fixed), label);
    }
    const doc = serialize(sampleDoc());
    damage(doc.doc);
    assert.equal(parseProject(doc).ok, false, `${label} (v2)`);
  }
});

test("프로젝트가 아닌 값·알 수 없는 형식·더 새로운 버전을 거부한다", () => {
  for (const raw of [null, undefined, 1, "text", [], { anything: true }, { format: "other", version: 1, project: v0() }, { format: FORMAT, version: 99, project: v0() },
    { format: FORMAT, schemaVersion: 3, doc: sampleDoc() }, { ...sampleDoc(), schemaVersion: 3 }]) {
    assert.equal(parseProject(raw).ok, false, JSON.stringify(raw)?.slice(0, 60));
  }
});

test("뼈대가 없거나 틀리면 거부한다: 트랙 없음, 필수 항목 빠짐, 음원 이름과 id 불일치, 다른 트랙을 가리키는 클립", () => {
  const cases = [
    (p) => { p.tracks = []; },
    (p) => { delete p.audioAssets; },
    (p) => { delete p.timeMarkers; },
    (p) => { delete p.id; },
    (p) => { p.bpm = "120"; },
    (p) => { p.tracks[0].volume = undefined; },
    (p) => { p.tracks[0].muted = 0; },
    (p) => { p.audioAssets["asset-1"].id = "other"; },
    (p) => { p.tracks[0].clips[0].trackId = "track-2"; },
    (p) => { p.tracks[0].clips[0].stretchMode = "elastic"; },
    (p) => { p.tracks[0].effectChain[0].type = "chorus"; },
  ];
  for (const [index, damage] of cases.entries()) {
    const project = v0();
    damage(project);
    assert.equal(parseProject(project).ok, false, `case ${index}`);
  }
});

test("위험한 id(__proto__·prototype·constructor, 500자 이상, 주소 모양)를 거부한다", () => {
  const ids = ["__proto__", "prototype", "constructor", "x".repeat(500), "", "javascript:alert(1)", "https://evil.example/x"];
  for (const id of ids) {
    for (const damage of [
      (p) => { p.id = id; },
      (p) => { p.tracks[0].id = id; p.tracks[0].clips.forEach((c) => { c.trackId = id; }); },
      (p) => { p.tracks[0].clips[0].audioBufferId = id; },
      (p) => { p.timeMarkers[0].id = id; },
    ]) {
      const project = v0();
      damage(project);
      assert.equal(parseProject(project).ok, false, id.slice(0, 20));
    }
  }
  // 음원 목록의 이름이 위험하면 JSON.parse가 만든 __proto__ 키여도 막힌다
  const withProtoKey = JSON.parse('{"__proto__": {"id": "__proto__", "fileName": "a", "duration": 1, "sampleRate": 44100, "channels": 1}}');
  const project = v0();
  project.audioAssets = withProtoKey;
  assert.equal(parseProject(project).ok, false);
  assert.equal(({}).fileName, undefined); // 검사 뒤에도 객체의 원형은 오염되지 않았다
});

test("개수 상한을 넘으면 거부하고, 이름이 200자를 넘으면 자른다", () => {
  const manyTracks = createEmptyDoc();
  manyTracks.tracks = Array.from({ length: MAX_TRACKS + 1 }, (_, i) => createDefaultTrack(i + 1));
  assert.equal(parseProject(serialize(manyTracks)).ok, false);
  manyTracks.tracks.pop();
  assert.equal(parseProject(serialize(manyTracks)).ok, true);

  const manyClips = sampleDoc();
  const base = manyClips.tracks[0].clips[0];
  manyClips.tracks[0].clips = Array.from({ length: MAX_CLIPS + 1 }, (_, i) => ({ ...base, id: `c${i}` }));
  const tooMany = parseProject(serialize(manyClips));
  assert.equal(tooMany.ok, false);
  assert.deepEqual(tooMany.issues, [{ path: "tracks", problem: "limit", fixed: false }]);
  manyClips.tracks[0].clips.pop();
  assert.equal(parseProject(serialize(manyClips)).ok, true);

  const manyMarkers = sampleDoc();
  manyMarkers.markers = Array.from({ length: MAX_MARKERS + 1 }, (_, i) => ({ id: `m${i}`, time: i, name: `마커 ${i}` }));
  assert.equal(parseProject(serialize(manyMarkers)).ok, false);

  const longName = sampleDoc();
  longName.name = "가".repeat(MAX_NAME_LENGTH + 50);
  longName.tracks[0].name = "나".repeat(MAX_NAME_LENGTH);
  const parsed = parseProject(serialize(longName));
  assert.equal(values(parsed).name.length, MAX_NAME_LENGTH);
  assert.equal(values(parsed).tracks[0].name.length, MAX_NAME_LENGTH);
  assert.deepEqual(parsed.issues, [{ path: "name", problem: "limit", fixed: true }]);
});

// ─────────────── 범위 보정 ───────────────

test("범위를 벗어난 숫자는 가장 가까운 허용값으로 고치고 Issue에 남긴다", () => {
  const project = v0();
  project.bpm = 999;
  project.tracks[0].volume = 5;
  project.tracks[0].pan = -3;
  project.tracks[0].eq.bassGain = 40;
  project.tracks[0].compressor = { enabled: true, threshold: 12, ratio: 0.2, attack: 5, release: -1 };
  project.tracks[0].delay.delayTimeMs = 0;
  project.tracks[0].delay.feedback = 2;
  project.tracks[0].reverb.decay = 100;
  project.tracks[0].clips[0].gain = 9;
  const parsed = parseProject(project);
  const doc = values(parsed);
  assert.equal(doc.bpm, 300);
  const track = doc.tracks[0];
  assert.equal(track.volume, 2);
  assert.equal(track.pan, -1);
  assert.equal(track.eq.bassGain, 12);
  assert.deepEqual(track.compressor, { enabled: true, threshold: 0, ratio: 1, attack: 1, release: 0 });
  assert.equal(track.delay.delayTimeMs, 1);
  assert.equal(track.delay.feedback, 0.95);
  assert.equal(track.reverb.decay, 12);
  assert.equal(track.clips[0].gain, 2);
  assert.equal(parsed.issues.length, 12);
  assert.equal(countFixed(parsed.issues), 12);
  assert.ok(parsed.issues.every((issue) => issue.problem === "range" && issue.fixed));
  assert.ok(parsed.issues.some((issue) => issue.path === "tracks[0].compressor.threshold"));
});

test("거대한 숫자(1e308)는 상한으로, NaN·Infinity는 기본값으로, 음수 길이는 0으로 고친다", () => {
  const doc = serialize(sampleDoc());
  const clip = doc.doc.tracks[0].clips[0];
  clip.startTime = 1e308;
  clip.offset = -5;
  clip.duration = -2;
  clip.gain = Number.NaN;
  clip.sourceBpm = Number.POSITIVE_INFINITY;
  doc.doc.markers[0].time = 1e308;
  doc.doc.assets.a1.duration = 1e308;
  doc.doc.tracks[0].volume = Number.NEGATIVE_INFINITY;
  const parsed = parseProject(doc);
  const result = values(parsed);
  const fixedClip = result.tracks[0].clips[0];
  assert.equal(fixedClip.startTime, MAX_TIME_SECONDS);
  assert.equal(fixedClip.offset, 0);
  assert.equal(fixedClip.duration, 0);
  assert.equal(fixedClip.gain, 1); // NaN → 기본값
  assert.equal(fixedClip.sourceBpm, 120);
  assert.equal(result.markers[0].time, MAX_TIME_SECONDS);
  assert.equal(result.assets.a1.duration, MAX_TIME_SECONDS);
  assert.ok(Number.isFinite(result.tracks[0].volume));
  assert.ok(parsed.issues.length >= 8);
  for (const track of result.tracks) {
    for (const c of track.clips) for (const key of ["startTime", "offset", "duration", "gain", "sourceBpm", "fadeIn", "fadeOut"]) assert.ok(Number.isFinite(c[key]), key);
  }
});

test("페이드는 클립 길이의 절반으로 조용히 줄이고(예전 동작), 없는 값은 기본값을 채운다", () => {
  const project = v0();
  project.tracks[0].clips[0].duration = 4;
  project.tracks[0].clips[0].fadeIn = 3;
  project.tracks[0].clips[0].fadeOut = 1;
  delete project.tracks[0].clips[0].fadeCurve;
  const parsed = parseProject(project);
  const clip = values(parsed).tracks[0].clips[0];
  assert.equal(clip.fadeIn, 2);
  assert.equal(clip.fadeOut, 1);
  assert.equal(clip.fadeCurve, "equalPower");
  assert.deepEqual(parsed.issues, []);
});

test("옛 프로젝트에 이펙트 설정이 통째로 없어도 기본값으로 채워 읽는다(조용히)", () => {
  const project = {
    id: "p1", name: "옛 세션", bpm: 120, sampleRate: 44100,
    tracks: [{ id: "t1", name: "트랙 1", volume: 0.86, pan: 0, muted: false, solo: false,
      clips: [{ id: "c1", audioBufferId: "a1", trackId: "t1", name: "음원", startTime: 0, offset: 0, duration: 1, sourceBpm: 120, stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0 }] }],
    audioAssets: { a1: { id: "a1", fileName: "음원.wav", duration: 1, sampleRate: 44100, channels: 1, waveformPeaks: [0, 1], blobUrl: "javascript:alert(1)" } },
    timeMarkers: [],
  };
  const parsed = parseProject(project);
  const doc = values(parsed);
  const track = doc.tracks[0];
  assert.deepEqual(track.eq, createDefaultTrack().eq);
  assert.deepEqual(track.delay, DEFAULT_DELAY_SETTINGS);
  assert.deepEqual(track.effectChain.map((slot) => slot.type), ["eq", "comp", "delay", "reverb"]);
  assert.deepEqual(track.effectChain.map((slot) => slot.enabled), [true, false, false, false]);
  assert.equal("blobUrl" in doc.assets.a1, false);
  assert.deepEqual(parsed.issues, []);
});

test("이펙트 순서는 있는 것을 지키고, 같은 종류는 처음 것만, 빠진 종류는 뒤에 덧붙인다", () => {
  const project = v0();
  project.tracks[0].effectChain = [
    { id: "r", type: "reverb", enabled: true },
    { id: "e1", type: "eq", enabled: false },
    { id: "e2", type: "eq", enabled: true },
  ];
  const chain = values(parseProject(project)).tracks[0].effectChain;
  assert.deepEqual(chain.map((slot) => slot.type), ["reverb", "eq", "comp", "delay"]);
  assert.deepEqual(chain.slice(0, 2).map((slot) => [slot.id, slot.enabled]), [["r", true], ["e1", false]]);
});

// ─────────────── 주소·알 수 없는 키 ───────────────

test("URL·blob:·javascript: 글자는 어디에 있든 버린다(이름은 기본 글자로)", () => {
  const project = v0();
  project.name = "javascript:alert(1)";
  project.tracks[0].name = "https://evil.example/track";
  project.tracks[0].clips[0].name = "  JavaScript:alert(2)";
  project.audioAssets["asset-1"].fileName = "blob:http://localhost/abc";
  project.audioAssets["asset-1"].mimeType = "javascript:alert(3)";
  project.audioAssets["asset-2"].recordedAt = "data:text/html,<script>alert(4)</script>";
  project.timeMarkers[0].name = "data:text/html;base64,PHNjcmlwdD4=";
  const parsed = parseProject(project);
  const doc = values(parsed);
  assert.equal(doc.name, "가져온 세션");
  assert.equal(doc.tracks[0].name, "트랙 1");
  assert.equal(doc.tracks[0].clips[0].name, "클립");
  assert.equal(doc.assets["asset-1"].fileName, "음원");
  assert.equal(doc.assets["asset-1"].mimeType, undefined);
  assert.equal(doc.assets["asset-2"].recordedAt, undefined);
  assert.equal(doc.markers[0].name, "마커 1");
  assert.equal(parsed.issues.filter((issue) => issue.problem === "unsafe").length, 7);
  assert.ok(!JSON.stringify(doc).match(/javascript:|blob:|https?:\/\/|data:text/i));
});

test("주소처럼 보이지 않는 평범한 이름은 그대로 둔다('데이터: 드럼', 'File: 킥', 'http 설명')", () => {
  const project = v0();
  project.tracks[0].name = "데이터: 드럼";
  project.tracks[1].name = "File: 킥";
  project.name = "http 설명";
  project.tracks[0].clips[0].name = "data: 소리";
  const doc = values(parseProject(project));
  assert.deepEqual([doc.tracks[0].name, doc.tracks[1].name, doc.name, doc.tracks[0].clips[0].name], ["데이터: 드럼", "File: 킥", "http 설명", "data: 소리"]);
});

test("모르는 키는 어디에서든 버린다", () => {
  const original = sampleDoc();
  const input = serialize(structuredClone(original));
  input.extra = 1;
  input.doc.evil = { x: 1 };
  input.doc.tracks[0].hacked = true;
  input.doc.tracks[0].eq.extra = 1;
  input.doc.tracks[0].clips[0].onclick = "alert(1)";
  input.doc.assets.a1.waveformPeaks = [1, 2, 3];
  input.doc.assets.a1.blobUrl = "blob:http://x/y";
  const doc = values(parseProject(input));
  assert.deepEqual(doc, original);
});

test("음원 해시는 SHA-256 소문자 16진수만 받고, 아니면 버린다", () => {
  const doc = sampleDoc();
  const hash = "ab".repeat(32);
  doc.assets.a1.hash = hash;
  assert.equal(values(parseProject(serialize(doc))).assets.a1.hash, hash);
  doc.assets.a1.hash = "not-a-hash";
  const parsed = parseProject(serialize(doc));
  assert.equal(values(parsed).assets.a1.hash, undefined);
  assert.deepEqual(parsed.issues, [{ path: "assets.a1.hash", problem: "type", fixed: true }]);
});

// ─────────────── 프리셋 ───────────────

function samplePreset() {
  const track = createDefaultTrack(1);
  return { name: "보컬", createdAt: "2026-11-23T08:00:00.000Z", effectChain: track.effectChain, eq: track.eq, compressor: track.compressor, delay: track.delay, reverb: track.reverb };
}

test("프리셋: 정상 파일은 그대로 읽고, 범위 밖 숫자는 고친다", () => {
  const preset = samplePreset();
  assert.deepEqual(values(parsePreset(JSON.parse(JSON.stringify(preset)))), preset);
  preset.delay.feedback = 7;
  preset.reverb.wet = -1;
  const parsed = parsePreset(preset);
  assert.equal(values(parsed).delay.feedback, 0.95);
  assert.equal(values(parsed).reverb.wet, 0);
  assert.equal(countFixed(parsed.issues), 2);
});

test("프리셋: 악성 파일(자료형·허용 목록·빈 목록·주소)을 거부한다", () => {
  const damages = [
    () => null,
    () => "text",
    () => [],
    () => ({}),
    (p) => ({ ...p, name: 5 }),
    (p) => ({ ...p, name: "   " }),
    (p) => ({ ...p, effectChain: [] }),
    (p) => ({ ...p, effectChain: "x" }),
    (p) => ({ ...p, effectChain: [null] }),
    (p) => ({ ...p, effectChain: [{ id: "a", type: "chorus", enabled: true }] }),
    (p) => ({ ...p, effectChain: [{ id: "__proto__", type: "eq", enabled: true }] }),
    (p) => ({ ...p, eq: "bad" }),
    (p) => ({ ...p, compressor: { ...p.compressor, ratio: "high" } }),
    (p) => ({ ...p, delay: { ...p.delay, enabled: "yes" } }),
    (p) => ({ ...p, reverb: { ...p.reverb, mode: "cave" } }),
    (p) => ({ ...p, reverb: { ...p.reverb, decay: null } }),
  ];
  for (const [index, damage] of damages.entries()) {
    assert.equal(parsePreset(damage(samplePreset())).ok, false, `case ${index}`);
  }
});

test("프리셋: 일부 설정이 없는 옛 프리셋은 기본값으로 채우고, 이름이 주소면 기본 글자로 바꾼다", () => {
  const old = { name: "옛 프리셋", effectChain: [{ id: "x", type: "eq", enabled: true }, { id: "y", type: "comp", enabled: false }], eq: samplePreset().eq, compressor: samplePreset().compressor };
  const parsed = parsePreset(old);
  const preset = values(parsed);
  assert.deepEqual(preset.delay, DEFAULT_DELAY_SETTINGS);
  assert.deepEqual(preset.effectChain.map((slot) => slot.type), ["eq", "comp", "delay", "reverb"]);
  assert.equal(preset.createdAt, "1970-01-01T00:00:00.000Z");
  const evil = parsePreset({ ...samplePreset(), name: "javascript:alert(1)" });
  assert.equal(values(evil).name, "프리셋");
  assert.equal(evil.issues[0].problem, "unsafe");
});

test("프리셋 목록(localStorage): 망가진 항목과 같은 이름은 건너뛰고 24개까지만 남긴다", () => {
  assert.deepEqual(parsePresetList(null), []);
  assert.deepEqual(parsePresetList({ a: 1 }), []);
  const good = samplePreset();
  const list = parsePresetList([good, null, { name: "x" }, { ...good, name: "보컬" }, { ...good, name: "베이스" }]);
  assert.deepEqual(list.map((p) => p.name), ["보컬", "베이스"]);
  const many = Array.from({ length: 40 }, (_, i) => ({ ...good, name: `프리셋 ${i}` }));
  assert.equal(parsePresetList(many).length, 24);
});
