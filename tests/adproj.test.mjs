import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, unzipSync, zipSync } from "fflate";
import { createEmptyDoc } from "../src/domain/project/defaults.ts";
import { FORMAT } from "../src/domain/project/serialize.ts";
import { sha256Hex } from "../src/services/persistence/assetHash.ts";
import { exportProjectFile, extensionOf, readProjectFile } from "../src/services/persistence/projectFile.ts";
import { ko } from "../src/i18n/ko.ts";

const asset = (id, fileName, extra = {}) => ({ id, fileName, duration: 2, sampleRate: 44100, channels: 2, source: "upload", mimeType: "audio/wav", ...extra });
const wav = (...bytes) => new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
const bytesOf = async (blob) => [...new Uint8Array(await blob.arrayBuffer())];

/** zip 안 파일 목록과 각 파일의 압축 방식(0 = 압축하지 않음) */
async function inspect(blob) {
  const infos = [];
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()), { filter: (file) => { infos.push({ name: file.name, compression: file.compression }); return true; } });
  return { infos, entries };
}

test("저장 파일은 압축하지 않은 zip이다: project.json + audio/<해시><확장자>", async () => {
  const doc = createEmptyDoc();
  doc.assets.a1 = asset("a1", "반주.wav");
  doc.assets.a2 = asset("a2", "녹음.m4a", { mimeType: "audio/mp4" });
  const first = wav(1, 2, 3);
  const second = new Blob([new Uint8Array([9, 9])], { type: "audio/mp4" });
  const blob = await exportProjectFile(doc, (id) => (id === "a1" ? first : second));

  const head = await bytesOf(blob.slice(0, 4));
  assert.deepEqual(head, [0x50, 0x4b, 0x03, 0x04], "zip 머리");
  const { infos, entries } = await inspect(blob);
  const hash1 = await sha256Hex(first);
  const hash2 = await sha256Hex(second);
  assert.deepEqual(infos.map((info) => info.name).sort(), ["audio/" + hash1 + ".wav", "audio/" + hash2 + ".m4a", "project.json"].sort());
  assert.ok(infos.every((info) => info.compression === 0), "전부 압축하지 않는다");
  assert.deepEqual([...entries["audio/" + hash1 + ".wav"]], [1, 2, 3], "음원 원본 바이트 그대로");

  const json = JSON.parse(new TextDecoder().decode(entries["project.json"]));
  assert.equal(json.format, FORMAT);
  assert.equal(json.schemaVersion, 2);
  assert.equal(json.doc.assets.a1.hash, hash1);
  assert.equal("audio" in json, false, "음원 데이터는 JSON 안에 없다");
});

test("같은 음원을 쓰는 음원 정보가 여럿이어도 데이터는 파일에 한 번만 담기고, 읽으면 모두 받는다", async () => {
  const doc = createEmptyDoc();
  doc.assets.a1 = asset("a1", "같은 파일.wav");
  doc.assets.a2 = asset("a2", "같은 파일 사본.wav");
  const same = (id) => wav(5, 6, 7);
  const blob = await exportProjectFile(doc, same);
  const { infos } = await inspect(blob);
  assert.equal(infos.filter((info) => info.name.startsWith("audio/")).length, 1);

  const loaded = await readProjectFile(blob);
  assert.deepEqual(await bytesOf(loaded.audio.a1), [5, 6, 7]);
  assert.deepEqual(await bytesOf(loaded.audio.a2), [5, 6, 7]);
});

test("데이터가 없는 음원은 파일에 해시만 남기고, 읽으면 '빠진 음원'이 된다", async () => {
  const doc = createEmptyDoc();
  const hash = "d".repeat(64);
  doc.assets.a1 = asset("a1", "빠진 음원.wav", { hash });
  const loaded = await readProjectFile(await exportProjectFile(doc, () => undefined));
  assert.deepEqual(Object.keys(loaded.audio), []);
  assert.equal(loaded.doc.assets.a1.hash, hash, "다시 연결할 때 같은 파일을 알아보는 단서");
});

test("문서에 없는 음원 파일이나 다른 이름의 파일은 읽지 않는다", async () => {
  const doc = createEmptyDoc();
  const hash = "e".repeat(64);
  doc.assets.a1 = asset("a1", "음원.wav", { hash });
  const zip = zipSync({
    "project.json": [strToU8(JSON.stringify({ format: FORMAT, schemaVersion: 2, doc })), { level: 0 }],
    ["audio/" + "f".repeat(64) + ".wav"]: [new Uint8Array([1]), { level: 0 }],
    "notes/readme.txt": [strToU8("메모"), { level: 0 }],
  });
  const loaded = await readProjectFile(new Blob([zip]));
  assert.deepEqual(Object.keys(loaded.audio), [], "해시가 맞는 파일이 없으면 음원은 빠진 것이다");
});

test("압축된 zip도 읽는다(다른 프로그램으로 다시 묶은 파일)", async () => {
  const doc = createEmptyDoc();
  const data = new Uint8Array(2000).fill(3);
  const hash = await sha256Hex(new Blob([data]));
  doc.assets.a1 = asset("a1", "음원.wav", { hash });
  const zip = zipSync({
    "project.json": [strToU8(JSON.stringify({ format: FORMAT, schemaVersion: 2, doc })), { level: 6 }],
    [`audio/${hash}.wav`]: [data, { level: 6 }],
  });
  const loaded = await readProjectFile(new Blob([zip]));
  assert.equal((await bytesOf(loaded.audio.a1)).length, 2000);
});

test("프로젝트가 아닌 zip과 망가진 zip은 한국어 사유로 거부한다", async () => {
  const noDoc = zipSync({ "readme.txt": strToU8("hi") });
  await assert.rejects(readProjectFile(new Blob([noDoc])), { message: ko.error.projectUnsupported });

  const junk = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);
  await assert.rejects(readProjectFile(new Blob([junk])), { message: ko.error.projectInvalid });

  const badJson = zipSync({ "project.json": strToU8("{ 깨진") });
  await assert.rejects(readProjectFile(new Blob([badJson])), SyntaxError);

  const newer = zipSync({ "project.json": strToU8(JSON.stringify({ format: FORMAT, schemaVersion: 99, doc: createEmptyDoc() })) });
  await assert.rejects(readProjectFile(new Blob([newer])), { message: ko.error.projectUnsupported });
});

test("풀면 너무 커지는 zip은 풀기 전에 거부한다", async () => {
  // 0으로 채운 65MB는 압축하면 수십 KB다. 선언된 풀린 크기(project.json 64MB 상한)로 걸러야 풀다가 메모리가 터지지 않는다.
  const bomb = zipSync({ "project.json": new Uint8Array(65 * 1024 * 1024) });
  assert.ok(bomb.length < 1024 * 1024, "압축된 파일은 작다");
  await assert.rejects(readProjectFile(new Blob([bomb])), { message: ko.error.projectFileTooBig });
});

test("JSON 프로젝트: 앞의 BOM·공백은 허용하고, 프로젝트가 아닌 파일은 통째로 글자로 바꾸기 전에 거부한다", async () => {
  const doc = createEmptyDoc();
  const json = JSON.stringify({ format: FORMAT, schemaVersion: 2, doc, audio: {} });
  const withBom = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), strToU8("\n  " + json)]);
  const loaded = await readProjectFile(withBom);
  assert.equal(loaded.doc.id, doc.id);

  await assert.rejects(readProjectFile(new Blob([new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0])])), SyntaxError, "mp3 같은 다른 파일");
  await assert.rejects(readProjectFile(new Blob([])), SyntaxError, "빈 파일");
});

test("확장자: 종류(MIME)로 정하고, 모르면 원래 이름의 확장자, 그것도 없으면 .bin", () => {
  assert.equal(extensionOf("audio/wav"), ".wav");
  assert.equal(extensionOf("audio/x-wav"), ".wav");
  assert.equal(extensionOf("audio/mpeg"), ".mp3");
  assert.equal(extensionOf("audio/mp4"), ".m4a");
  assert.equal(extensionOf("audio/ogg; codecs=opus"), ".ogg");
  assert.equal(extensionOf("", "녹음 1.FLAC"), ".flac");
  assert.equal(extensionOf("application/octet-stream", "소리"), ".bin");
  assert.equal(extensionOf("constructor"), ".bin", "객체의 기본 속성 이름이 종류로 들어와도 안전하다");
});

test("수용 기준: 4분 WAV 2개(약 85MB) 프로젝트 파일은 원본 합의 1.01배 이하이고, 옛 base64 JSON보다 약 25% 작다", async () => {
  const bytesPerWav = 4 * 60 * 44100 * 2 * 2; // 4분 · 44.1kHz · 스테레오 · 16비트 ≈ 42.3MB
  const make = (seed) => {
    const data = new Uint8Array(bytesPerWav);
    for (let i = 0; i < data.length; i += 997) data[i] = (i * seed + seed) & 255; // 서로 다른 데이터(같은 해시로 합쳐지지 않게)
    return new Blob([data], { type: "audio/wav" });
  };
  const files = { a1: make(3), a2: make(5) };
  const doc = createEmptyDoc();
  doc.assets.a1 = asset("a1", "반주 1.wav", { duration: 240, byteSize: bytesPerWav });
  doc.assets.a2 = asset("a2", "반주 2.wav", { duration: 240, byteSize: bytesPerWav });

  const blob = await exportProjectFile(doc, (id) => files[id]);
  const total = files.a1.size + files.a2.size;
  assert.ok(total > 84e6 && total < 86e6, `원본 합 ${total}`); // 설계서의 "약 85MB"
  assert.ok(blob.size <= total * 1.01, `파일 ${blob.size} ≤ 원본 합 ${total} × 1.01`);
  const oldJsonSize = 2 * 4 * Math.ceil(bytesPerWav / 3); // 11월 형식: 음원을 base64 글자로 넣었다
  assert.ok(blob.size < oldJsonSize * 0.76, `새 형식 ${blob.size} < 옛 형식 ${oldJsonSize} × 0.76`);

  // 큰 음원도 조각으로 이어 붙인 결과가 원본과 한 바이트도 다르지 않다.
  const loaded = await readProjectFile(blob);
  assert.equal(await sha256Hex(loaded.audio.a1), await sha256Hex(files.a1));
  assert.equal(await sha256Hex(loaded.audio.a2), await sha256Hex(files.a2));
  assert.equal(loaded.doc.assets.a1.hash, await sha256Hex(files.a1));
});
