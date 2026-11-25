/**
 * 큰 음원 메모리 상한(설계서 §P6-4, 보고서 D7).
 *  - 계산: 풀린 크기 = 길이(초) × 샘플레이트 × 채널 수 × 4바이트, 기기별 기준(안내·거부·파일 하나 300MB)
 *  - WAV 머리에서 길이 읽기(머리만 큰 길이를 적은 가짜 WAV 포함)
 *  - 올리기 검사: 풀기 전(WAV 미리 계산·큰 파일 묻기)과 푼 뒤(다시 계산해 묻기·내려놓기)
 *  - 소리 엔진이 올려 둔 소리의 크기를 세는 일, 묻는 창의 확인만 있는 모양
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { FakeContext } from "./helpers/fake-audio.mjs";

const storage = new Map();
const localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => { storage.set(key, String(value)); },
  removeItem: (key) => { storage.delete(key); },
};
globalThis.window = { AudioContext: FakeContext, localStorage, innerWidth: 1440 };

const budget = await import("../src/domain/memory/budget.ts");
const wavHeader = await import("../src/domain/memory/wavHeader.ts");
const { createUploadGuard, UploadSkipped } = await import("../src/services/memoryGuard.ts");
const { readAudioFile } = await import("../src/services/importer.ts");
const { confirmAction } = await import("../src/services/confirm.ts");
const { useDialogStore } = await import("../src/state/dialogStore.ts");
const { useNoticeStore } = await import("../src/state/noticeStore.ts");
const { useDawStore } = await import("../src/store/useDawStore.ts");
const { getDoc } = await import("../src/state/projectStore.ts");
const { history } = await import("../src/state/history.ts");
const { importAudioFiles } = await import("../src/app/importing.ts");
const { deviceMemoryLimits } = await import("../src/app/uploadGuard.ts");
const { audioEngine } = await import("../src/audio/audioEngine.ts");
const { createEmptyDoc } = await import("../src/domain/project/defaults.ts");
const { forgetAllAudio } = await import("../src/services/persistence/audioBlobs.ts");
const { clearPeaks } = await import("../src/services/peaksCache.ts");

const { MB, GB, DESKTOP_LIMITS, PHONE_LIMITS, decodedBytes, isPhoneClass, limitsFor, judgeTotal, formatMemory } = budget;
const { readWavInfo, estimateWavDecodedBytes, WAV_HEAD_BYTES } = wavHeader;

beforeEach(() => {
  globalThis.window.innerWidth = 1440;
  audioEngine.clearBuffers();
  forgetAllAudio();
  clearPeaks();
  useNoticeStore.getState().reset();
  useDialogStore.getState().confirm?.resolve(false);
  useDialogStore.setState({ confirm: undefined });
  useDawStore.getState().importProject(createEmptyDoc());
  history.clear();
});

// ───── 계산 ─────

test("풀린 크기 = 길이(초) × 샘플레이트 × 채널 수 × 4바이트: 4분 스테레오 44.1kHz는 약 85MB", () => {
  assert.equal(decodedBytes(240, 44100, 2), 84_672_000);
  assert.equal(formatMemory(decodedBytes(240, 44100, 2)), "85MB");
  assert.equal(decodedBytes(3600, 48000, 1), 691_200_000, "1시간 모노 48kHz");
  assert.equal(decodedBytes(1, 44100, 2), 352_800);
});

test("길이·샘플레이트·채널 수가 올바르지 않으면 0이다", () => {
  assert.equal(decodedBytes(0, 44100, 2), 0);
  assert.equal(decodedBytes(-1, 44100, 2), 0);
  assert.equal(decodedBytes(10, 0, 2), 0);
  assert.equal(decodedBytes(10, 44100, 0), 0);
  assert.equal(decodedBytes(Number.NaN, 44100, 2), 0);
});

test("샘플 수는 길이 × 샘플레이트를 가장 가까운 정수로 센다(부동소수 오차로 한 샘플이 늘지 않는다)", () => {
  const length = 441_000;
  assert.equal(decodedBytes(length / 44100, 44100, 1), length * 4);
});

// ───── 기준 ─────

test("기준: 데스크톱은 600MB 안내 · 1.2GB 거부, 휴대폰은 200MB · 400MB, 파일 하나 300MB는 같다", () => {
  assert.deepEqual({ ...DESKTOP_LIMITS }, { notice: 600 * MB, reject: 1200 * MB, fileAsk: 300 * MB });
  assert.deepEqual({ ...PHONE_LIMITS }, { notice: 200 * MB, reject: 400 * MB, fileAsk: 300 * MB });
  assert.equal(GB, 1000 * MB);
});

test("휴대폰 기준을 쓰는 기기: 알려진 메모리가 4GB 이하이거나 화면 폭이 768px 미만", () => {
  assert.equal(isPhoneClass({ deviceMemory: 4, width: 1440 }), true, "메모리 4GB");
  assert.equal(isPhoneClass({ deviceMemory: 2, width: 1440 }), true);
  assert.equal(isPhoneClass({ deviceMemory: 8, width: 1440 }), false);
  assert.equal(isPhoneClass({ width: 1440 }), false, "메모리를 알려 주지 않는 브라우저는 폭만 본다");
  assert.equal(isPhoneClass({ width: 767 }), true);
  assert.equal(isPhoneClass({ width: 768 }), false);
  assert.equal(isPhoneClass({ deviceMemory: 8, width: 390 }), true);
  assert.equal(limitsFor({ deviceMemory: 8, width: 1440 }), DESKTOP_LIMITS);
  assert.equal(limitsFor({ deviceMemory: 4, width: 1440 }), PHONE_LIMITS);
});

test("전체 크기 판정: 기준과 같으면 통과, 1바이트라도 넘으면 안내·거부", () => {
  assert.equal(judgeTotal(600 * MB, DESKTOP_LIMITS), "ok");
  assert.equal(judgeTotal(600 * MB + 1, DESKTOP_LIMITS), "notice");
  assert.equal(judgeTotal(1200 * MB, DESKTOP_LIMITS), "notice");
  assert.equal(judgeTotal(1200 * MB + 1, DESKTOP_LIMITS), "reject");
  assert.equal(judgeTotal(200 * MB + 1, PHONE_LIMITS), "notice");
  assert.equal(judgeTotal(400 * MB + 1, PHONE_LIMITS), "reject");
  assert.equal(judgeTotal(0, PHONE_LIMITS), "ok");
});

test("화면에 보이는 크기: 1GB 미만은 MB, 그 이상은 GB", () => {
  assert.equal(formatMemory(85_000_000), "85MB");
  assert.equal(formatMemory(999_400_000), "999MB");
  assert.equal(formatMemory(999_600_000), "1GB", "반올림하면 1000MB가 되는 값은 GB로");
  assert.equal(formatMemory(1_200_000_000), "1.2GB");
  assert.equal(formatMemory(1_500_000_000), "1.5GB");
  assert.equal(formatMemory(0), "0MB");
});

// ───── WAV 머리 ─────

/** 시험용 WAV 머리. `declared`는 data 조각이 적은 크기(실제 파일 크기와 달라도 된다). */
function wavHead({ sampleRate = 44100, channels = 2, bits = 16, tag = 1, declared = 0, extra = [], magic = "RIFF" } = {}) {
  const parts = [];
  const text = (value) => parts.push(...[...value].map((char) => char.charCodeAt(0)));
  const u16 = (value) => parts.push(value & 255, (value >> 8) & 255);
  const u32 = (value) => parts.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
  const blockAlign = channels * (bits / 8);
  text(magic); u32(0xffffffff); text("WAVE");
  for (const chunk of extra) { text(chunk.id); u32(chunk.bytes.length); parts.push(...chunk.bytes); if (chunk.bytes.length & 1) parts.push(0); }
  text("fmt "); u32(16); u16(tag); u16(channels); u32(sampleRate); u32(sampleRate * blockAlign); u16(blockAlign); u16(bits);
  text("data"); u32(declared);
  return Uint8Array.from(parts);
}

test("WAV 머리에서 샘플레이트·채널·길이를 읽는다", () => {
  const head = wavHead({ declared: 176_400 }); // 44.1kHz 스테레오 16비트 1초
  const info = readWavInfo(head, head.length + 176_400);
  assert.deepEqual(info, { sampleRate: 44100, channels: 2, frames: 44100, seconds: 1 });
});

test("머리만 큰 길이를 적은 가짜 WAV(파일은 44바이트)도 머리가 말하는 길이로 본다", () => {
  const head = wavHead({ declared: 689_000_000 });
  assert.equal(head.length, 44);
  const info = readWavInfo(head, head.length);
  assert.equal(info.frames, 172_250_000);
  assert.ok(Math.abs(info.seconds - 3906.0) < 1);
  // 소리 장치가 48kHz면 풀린 크기는 길이 × 48000 × 2 × 4
  assert.equal(estimateWavDecodedBytes(info, 48000), Math.round(info.seconds * 48000) * 2 * 4);
  assert.ok(estimateWavDecodedBytes(info, 48000) > 1200 * MB);
});

test("풀린 크기는 파일의 샘플레이트가 아니라 소리 장치의 샘플레이트로 계산한다", () => {
  const head = wavHead({ sampleRate: 22050, channels: 1, declared: 44_100 }); // 22.05kHz 모노 16비트 1초
  const info = readWavInfo(head, head.length + 44_100);
  assert.equal(info.seconds, 1);
  assert.equal(estimateWavDecodedBytes(info, 22050), 22050 * 4);
  assert.equal(estimateWavDecodedBytes(info, 48000), 48000 * 4, "48kHz로 맞춰 풀리므로 두 배 넘게 커진다");
});

test("길이를 적지 않은 머리(0 · 0xFFFFFFFF · RF64)는 파일 크기에서 머리를 뺀 만큼으로 본다", () => {
  for (const declared of [0, 0xffffffff]) {
    const head = wavHead({ declared });
    const info = readWavInfo(head, head.length + 352_800); // 2초
    assert.equal(info.seconds, 2, `declared=${declared}`);
  }
  const rf64 = wavHead({ declared: 0xffffffff, magic: "RF64" });
  assert.equal(readWavInfo(rf64, rf64.length + 176_400).seconds, 1);
});

test("data 앞에 다른 조각(LIST 등)이 있어도 건너뛰어 읽는다(홀수 크기 조각의 덧붙인 바이트 포함)", () => {
  const head = wavHead({ declared: 88_200, extra: [{ id: "LIST", bytes: [1, 2, 3, 4, 5] }] });
  const info = readWavInfo(head, head.length + 88_200);
  assert.equal(info.seconds, 0.5);
});

test("확장 형식(0xFFFE)·실수(3)·24비트도 읽고, 압축 WAV(ADPCM)는 알 수 없으니 undefined", () => {
  assert.equal(readWavInfo(wavHead({ tag: 0xfffe, bits: 24, declared: 3 * 2 * 44100 }), 1 << 20).seconds, 1);
  assert.equal(readWavInfo(wavHead({ tag: 3, bits: 32, declared: 4 * 2 * 44100 }), 1 << 20).seconds, 1);
  assert.equal(readWavInfo(wavHead({ tag: 2, bits: 4, declared: 1000 }), 1 << 20), undefined);
});

test("WAV가 아니거나 앞부분이 모자라면 undefined(풀고 난 뒤에 확인한다)", () => {
  assert.equal(readWavInfo(new TextEncoder().encode("ID3\u0003\u0000 mp3 파일 머리"), 5_000_000), undefined);
  assert.equal(readWavInfo(new Uint8Array(8), 8), undefined);
  assert.equal(readWavInfo(new Uint8Array(0), 0), undefined);
  const head = wavHead({ declared: 1000 });
  assert.equal(readWavInfo(head.slice(0, 30), 1000), undefined, "data 조각 앞에서 끊김");
  assert.equal(readWavInfo(wavHead({ channels: 0, declared: 1000 }), 5000), undefined, "채널 0");
});

test("머리를 읽는 크기는 64KB다", () => {
  assert.equal(WAV_HEAD_BYTES, 65_536);
});

// ───── 올리기 검사(풀기 전·푼 뒤) ─────

/** 시험용 파일: 앞부분(`head`)만 읽을 수 있고 크기는 따로 정한다 */
function fakeFile(name, head, size = head.length) {
  return {
    name,
    size,
    slice: (start, end) => ({ arrayBuffer: async () => head.slice(start, end).buffer }),
  };
}
const mp3File = (name, size) => fakeFile(name, new TextEncoder().encode("ID3 ..."), size);
const wavFile = (name, declared, size) => { const head = wavHead({ declared }); return fakeFile(name, head, size ?? head.length); };

/** 묻는 창을 가짜로: `answers`는 묻는 창마다 차례로 줄 대답(true=올리기) */
function makeDeps({ used = 0, rate = 48000, limits = DESKTOP_LIMITS, answers = [] } = {}) {
  const log = { asks: [], informs: [] };
  const deps = {
    usedBytes: () => deps.used,
    used,
    outputRate: () => rate,
    limits: () => limits,
    ask: async (options) => { log.asks.push(options); return answers.length ? answers.shift() : true; },
    inform: async (options) => { log.informs.push(options); },
  };
  return { deps, log };
}

test("풀기 전 — 보통 크기의 WAV는 묻지 않고 지나간다", async () => {
  const { deps, log } = makeDeps();
  const before = await createUploadGuard(deps).beforeDecode(wavFile("곡.wav", 176_400 * 240)); // 4분
  assert.deepEqual(before, { asked: false });
  assert.equal(log.asks.length + log.informs.length, 0);
});

test("풀기 전 — 머리만 큰 가짜 WAV(풀린 크기 1.2GB 넘음)는 풀지 않고 거부하며, 확인 단추만 있는 안내를 한다", async () => {
  const { deps, log } = makeDeps();
  const guard = createUploadGuard(deps);
  await assert.rejects(guard.beforeDecode(wavFile("가짜.wav", 689_000_000, 44)), (error) => {
    assert.ok(error instanceof UploadSkipped);
    assert.equal(error.reason, "refused");
    assert.equal(error.fileName, "가짜.wav");
    return true;
  });
  assert.equal(log.asks.length, 0, "거부는 묻지 않는다");
  assert.equal(log.informs.length, 1);
  assert.equal(log.informs[0].title, "올릴 수 없습니다");
  assert.match(log.informs[0].message, /가짜\.wav/);
  assert.match(log.informs[0].message, /1\.2GB/, "넘은 기준을 알린다");
  assert.equal(log.informs[0].confirmLabel, "확인");
});

test("풀기 전 — 풀린 크기가 안내 기준(600MB)을 넘으면 묻고, 올리지 않겠다고 하면 건너뛴다", async () => {
  const { deps, log } = makeDeps({ answers: [false] });
  const guard = createUploadGuard(deps);
  // 44.1kHz 스테레오 16비트 2083초 ≈ 전체 800MB(48kHz로 풀릴 때)
  await assert.rejects(guard.beforeDecode(wavFile("긴곡.wav", 176_400 * 2083, 44)), (error) => error instanceof UploadSkipped && error.reason === "declined");
  assert.equal(log.asks.length, 1);
  assert.equal(log.asks[0].title, "메모리를 많이 씁니다");
  assert.equal(log.asks[0].confirmLabel, "그래도 올리기");
  assert.equal(log.asks[0].cancelLabel, "올리지 않기");
  assert.equal(log.informs.length, 0);
});

test("풀기 전 — 올리겠다고 하면 올리고, 푼 뒤에 같은 질문을 또 하지 않는다", async () => {
  const { deps, log } = makeDeps({ answers: [true] });
  const guard = createUploadGuard(deps);
  const before = await guard.beforeDecode(wavFile("긴곡.wav", 176_400 * 2083, 44));
  assert.deepEqual(before, { asked: true });
  deps.used = 800 * MB; // 푼 뒤: 올린 소리 전체 800MB
  await guard.afterDecode({ name: "긴곡.wav" }, { duration: 2083, sampleRate: 48000, channels: 2 }, before);
  assert.equal(log.asks.length, 1, "한 번만 묻는다");
});

test("풀기 전 — 이미 올려 둔 소리를 더해서 따진다(500MB가 올라 있으면 150MB짜리도 묻는다)", async () => {
  const { deps, log } = makeDeps({ used: 500 * MB, answers: [true] });
  const seconds = 150 * MB / (48000 * 2 * 4); // 풀린 크기 150MB
  await createUploadGuard(deps).beforeDecode(wavFile("중간.wav", Math.round(seconds * 176_400), 44));
  assert.equal(log.asks.length, 1);
  const quiet = makeDeps({ used: 400 * MB });
  await createUploadGuard(quiet.deps).beforeDecode(wavFile("중간.wav", Math.round(seconds * 176_400), 44));
  assert.equal(quiet.log.asks.length, 0, "합쳐서 550MB면 묻지 않는다");
});

test("풀기 전 — 전체가 정확히 기준과 같으면 통과한다(넘어야 묻는다)", async () => {
  const exactly = 600 * MB;
  const frames = exactly / 8; // 스테레오 · 4바이트
  const { deps, log } = makeDeps({ rate: 48000 });
  const head = wavHead({ sampleRate: 48000, declared: frames * 4 }); // 16비트 스테레오: 프레임당 4바이트
  await createUploadGuard(deps).beforeDecode(fakeFile("딱맞음.wav", head, head.length));
  assert.equal(log.asks.length, 0);
  const over = wavHead({ sampleRate: 48000, declared: (frames + 1) * 4 });
  const next = makeDeps({ rate: 48000, answers: [true] });
  await createUploadGuard(next.deps).beforeDecode(fakeFile("조금넘음.wav", over, over.length));
  assert.equal(next.log.asks.length, 1, "1프레임만 넘어도 묻는다");
});

test("풀기 전 — 압축 파일은 길이를 알 수 없어 파일 크기로만 본다: 300MB 넘으면 묻고, 300MB는 통과", async () => {
  const { deps, log } = makeDeps({ answers: [false] });
  const guard = createUploadGuard(deps);
  await assert.rejects(guard.beforeDecode(mp3File("긴.mp3", 301 * MB)), (error) => error instanceof UploadSkipped && error.reason === "declined");
  assert.equal(log.asks[0].title, "큰 파일입니다");
  assert.match(log.asks[0].message, /301MB/);
  const ok = makeDeps();
  assert.deepEqual(await createUploadGuard(ok.deps).beforeDecode(mp3File("딱.mp3", 300 * MB)), { asked: false });
  assert.equal(ok.log.asks.length, 0);
});

test("풀기 전 — 휴대폰 기준: 250MB는 묻고 450MB는 거부한다", async () => {
  const seconds = (megabytes) => (megabytes * MB) / (48000 * 2 * 4);
  const ask = makeDeps({ limits: PHONE_LIMITS, answers: [true] });
  await createUploadGuard(ask.deps).beforeDecode(wavFile("a.wav", Math.round(seconds(250) * 176_400), 44));
  assert.equal(ask.log.asks.length, 1);
  const refuse = makeDeps({ limits: PHONE_LIMITS });
  await assert.rejects(createUploadGuard(refuse.deps).beforeDecode(wavFile("b.wav", Math.round(seconds(450) * 176_400), 44)), UploadSkipped);
  assert.equal(refuse.log.informs.length, 1);
  assert.match(refuse.log.informs[0].message, /400MB/);
});

test("풀기 전 — 머리를 읽을 수 없는 파일은 압축 파일처럼 다룬다(푼 뒤에 확인)", async () => {
  const broken = { name: "깨짐.wav", size: 1000, slice: () => ({ arrayBuffer: async () => { throw new Error("읽을 수 없음"); } }) };
  const { deps, log } = makeDeps();
  assert.deepEqual(await createUploadGuard(deps).beforeDecode(broken), { asked: false });
  assert.equal(log.asks.length, 0);
});

test("푼 뒤 — 올린 소리 전체가 거부 기준을 넘으면 알리고 건너뛴다(푼 소리를 내려놓는 것은 부르는 쪽)", async () => {
  const { deps, log } = makeDeps({ used: 1300 * MB });
  await assert.rejects(
    createUploadGuard(deps).afterDecode({ name: "긴.mp3" }, { duration: 4000, sampleRate: 48000, channels: 2 }, { asked: false }),
    (error) => error instanceof UploadSkipped && error.reason === "refused",
  );
  assert.equal(log.informs.length, 1);
  assert.equal(log.asks.length, 0);
});

test("푼 뒤 — 안내 기준을 넘고 풀기 전에 묻지 않았다면 이때 묻는다", async () => {
  const declined = makeDeps({ used: 700 * MB, answers: [false] });
  await assert.rejects(
    createUploadGuard(declined.deps).afterDecode({ name: "긴.mp3" }, { duration: 1000, sampleRate: 48000, channels: 2 }, { asked: false }),
    (error) => error instanceof UploadSkipped && error.reason === "declined",
  );
  assert.equal(declined.log.asks.length, 1);
  const accepted = makeDeps({ used: 700 * MB, answers: [true] });
  await createUploadGuard(accepted.deps).afterDecode({ name: "긴.mp3" }, { duration: 1000, sampleRate: 48000, channels: 2 }, { asked: false });
  assert.equal(accepted.log.asks.length, 1);
});

test("푼 뒤 — 기준 안이면 아무것도 묻지 않는다", async () => {
  const { deps, log } = makeDeps({ used: 85 * MB });
  await createUploadGuard(deps).afterDecode({ name: "곡.mp3" }, { duration: 240, sampleRate: 44100, channels: 2 }, { asked: false });
  assert.equal(log.asks.length + log.informs.length, 0);
});

// ───── 읽기(readAudioFile)와 올리기 흐름 ─────

test("readAudioFile — 막힌 파일은 풀지도 않고, 푼 뒤에 막히면 풀어 둔 소리를 내려놓는다", async () => {
  const calls = [];
  const decode = async (file) => {
    calls.push(`decode ${file.name}`);
    return { asset: { id: "tmp", fileName: file.name, duration: 10, sampleRate: 44100, channels: 2, source: "upload" }, registerAs: () => {}, release: () => calls.push("release") };
  };
  const file = new File([new Uint8Array([1, 2, 3])], "곡.wav", { type: "audio/wav" });

  const blockedBefore = { beforeDecode: async () => { throw new UploadSkipped("곡.wav", "declined"); }, afterDecode: async () => { calls.push("after"); } };
  await assert.rejects(readAudioFile(file, decode, blockedBefore), UploadSkipped);
  assert.deepEqual(calls, [], "풀기 전에 막히면 풀지 않는다");

  const blockedAfter = { beforeDecode: async () => ({ asked: false }), afterDecode: async () => { throw new UploadSkipped("곡.wav", "refused"); } };
  await assert.rejects(readAudioFile(file, decode, blockedAfter), UploadSkipped);
  assert.deepEqual(calls, ["decode 곡.wav", "release"]);

  calls.length = 0;
  const allowed = { beforeDecode: async () => ({ asked: false }), afterDecode: async () => { calls.push("after"); } };
  const read = await readAudioFile(file, decode, allowed);
  assert.equal(read.asset.fileName, "곡.wav");
  assert.deepEqual(calls, ["decode 곡.wav", "after"]);

  calls.length = 0;
  await readAudioFile(file, decode); // 검사가 없으면 옛 그대로
  assert.deepEqual(calls, ["decode 곡.wav"]);
});

test("올리기 — 올리지 않기로 한 파일은 클립도 음원도 만들지 않고, 다른 파일은 그대로 올린다", async () => {
  let counter = 0;
  const decode = async (file) => ({
    asset: { id: `tmp${++counter}`, fileName: file.name, duration: 10, sampleRate: 44100, channels: 2, source: "upload", mimeType: file.type || undefined, byteSize: file.size },
    registerAs: () => {},
    release: () => {},
  });
  const guard = {
    beforeDecode: async (file) => { if (file.name === "큰.wav") throw new UploadSkipped(file.name, "declined"); return { asked: false }; },
    afterDecode: async () => {},
  };
  const file = (name, byte) => new File([new Uint8Array([byte])], name, { type: "audio/wav" });
  await importAudioFiles([file("큰.wav", 1), file("작은.wav", 2)], { decode, guard });
  const clips = getDoc().tracks.flatMap((track) => track.clips.map((clip) => clip.name));
  assert.deepEqual(clips, ["작은.wav"]);
  assert.equal(Object.keys(getDoc().assets).length, 1, "음원도 하나만");
  const toasts = useNoticeStore.getState().notices.map((notice) => `${notice.level}:${notice.message}`);
  assert.ok(toasts.some((text) => text.startsWith("warning:2개 중 1개만")), `일부만 올렸다는 알림: ${toasts.join(" | ")}`);
  assert.ok(toasts.every((text) => !text.startsWith("error:")), "올리지 않기로 한 것은 오류 알림이 아니다");
});

// ───── 소리 엔진이 올려 둔 소리의 크기 ─────

test("엔진: 올려 둔 소리의 크기 = 길이 × 채널 수 × 4바이트의 합이고, 같은 소리는 한 번만 센다", async () => {
  const context = new FakeContext();
  assert.equal(audioEngine.getDecodedBytes(), 0);
  const stereo = context.createBuffer(2, 44100, 44100);
  const mono = context.createBuffer(1, 22050, 44100);
  audioEngine.registerBuffer("a", stereo);
  audioEngine.registerBuffer("b", mono);
  assert.equal(audioEngine.getDecodedBytes(), 44100 * 2 * 4 + 22050 * 4);
  audioEngine.registerBuffer("c", stereo); // 같은 소리를 다른 음원 id로(같은 파일을 빠진 음원 여럿에 이을 때)
  assert.equal(audioEngine.getDecodedBytes(), 44100 * 2 * 4 + 22050 * 4, "같은 소리는 한 번만");
  audioEngine.removeBuffer("a");
  assert.equal(audioEngine.getDecodedBytes(), 44100 * 2 * 4 + 22050 * 4, "c가 같은 소리를 아직 들고 있다");
  audioEngine.removeBuffer("c");
  assert.equal(audioEngine.getDecodedBytes(), 22050 * 4);
  audioEngine.clearBuffers();
  assert.equal(audioEngine.getDecodedBytes(), 0);
});

test("엔진: 소리 장치를 열기 전에는 샘플레이트를 모르고, 연 뒤에는 장치의 값이다", async () => {
  assert.equal(audioEngine.getOutputSampleRate(), undefined);
  await audioEngine.ensureContext();
  assert.equal(audioEngine.getOutputSampleRate(), 44100);
});

// ───── 묻는 창 · 기기 기준 ─────

test("묻는 창: 기본은 취소·확인 둘이고, showCancel을 끄면 확인만 있는 안내 창이다", async () => {
  const both = confirmAction({ title: "t", message: "m" });
  assert.equal(useDialogStore.getState().confirm.showCancel, true);
  useDialogStore.getState().close(useDialogStore.getState().confirm.id, true);
  assert.equal(await both, true);
  const only = confirmAction({ title: "t", message: "m", showCancel: false });
  assert.equal(useDialogStore.getState().confirm.showCancel, false);
  useDialogStore.getState().close(useDialogStore.getState().confirm.id, true);
  await only;
});

test("이 기기의 기준: 화면 폭이 768px 미만이거나 알려진 메모리가 4GB 이하면 휴대폰 기준", () => {
  globalThis.window.innerWidth = 1440;
  assert.equal(deviceMemoryLimits(), DESKTOP_LIMITS);
  globalThis.window.innerWidth = 390;
  assert.equal(deviceMemoryLimits(), PHONE_LIMITS);
  globalThis.window.innerWidth = 1440;
  Object.defineProperty(globalThis.navigator, "deviceMemory", { value: 2, configurable: true });
  try {
    assert.equal(deviceMemoryLimits(), PHONE_LIMITS);
  } finally {
    delete globalThis.navigator.deviceMemory;
  }
  assert.equal(deviceMemoryLimits(), DESKTOP_LIMITS);
});
