import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const { encodePcmWav, wavByteLength, WAV_HEADER_BYTES } = await import("../src/utils/wavEncoder.ts");
const { encodeWavInWorker } = await import("../src/audio/engine/wavWorkerClient.ts");
const { MixCancelledError, isMixCancelled } = await import("../src/audio/engine/mixErrors.ts");

const text = (view, offset, length) => String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));
/** 24비트 두 보수(little-endian) 읽기 */
function int24(view, offset) {
  const value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
  return value & 0x800000 ? value - 0x1000000 : value;
}

test("16비트 PCM WAV: 머리말의 모든 칸과 좌우 번갈아 쌓는 순서", () => {
  const left = Float32Array.of(0, 0.5, -0.5);
  const right = Float32Array.of(1, -1, 0.25);
  const buffer = encodePcmWav([left, right], 48000, 16);
  const view = new DataView(buffer);
  assert.equal(buffer.byteLength, wavByteLength(3, 16, 2));
  assert.equal(buffer.byteLength, WAV_HEADER_BYTES + 3 * 2 * 2);
  assert.equal(text(view, 0, 4), "RIFF");
  assert.equal(view.getUint32(4, true), buffer.byteLength - 8, "RIFF 크기 = 전체 − 8");
  assert.equal(text(view, 8, 4), "WAVE");
  assert.equal(text(view, 12, 4), "fmt ");
  assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1, "PCM");
  assert.equal(view.getUint16(22, true), 2, "채널 수");
  assert.equal(view.getUint32(24, true), 48000, "샘플레이트");
  assert.equal(view.getUint32(28, true), 48000 * 4, "초당 바이트");
  assert.equal(view.getUint16(32, true), 4, "프레임당 바이트");
  assert.equal(view.getUint16(34, true), 16, "비트 수");
  assert.equal(text(view, 36, 4), "data");
  assert.equal(view.getUint32(40, true), 12, "데이터 크기");
  const samples = Array.from({ length: 6 }, (_, index) => view.getInt16(44 + index * 2, true));
  assert.deepEqual(samples, [0, 32767, 16384, -32768, -16384, 8192], "L0 R0 L1 R1 L2 R2");
});

test("16비트: ±1은 끝값, 범위 밖은 자르고, 숫자가 아닌 값은 0, 가까운 정수로 반올림한다", () => {
  const view = new DataView(encodePcmWav([Float32Array.of(2, -2, NaN, 1 / 32767 + 1e-7, 0.4 / 32767, -0.6 / 32768)], 44100, 16));
  const read = (index) => view.getInt16(WAV_HEADER_BYTES + index * 2, true);
  assert.equal(read(0), 32767);
  assert.equal(read(1), -32768);
  assert.equal(read(2), 0);
  assert.equal(read(3), 1);
  assert.equal(read(4), 0, "0.4 → 0");
  assert.equal(read(5), -1, "−0.6 → −1");
});

test("24비트 PCM WAV: 3바이트 little-endian 두 보수, 머리말의 비트 수·블록 크기", () => {
  const buffer = encodePcmWav([Float32Array.of(1, 0.5, -1, -0.5), Float32Array.of(0, 0, 0, 0)], 44100, 24);
  const view = new DataView(buffer);
  assert.equal(buffer.byteLength, wavByteLength(4, 24, 2));
  assert.equal(view.getUint16(32, true), 6, "프레임당 바이트 = 2채널 × 3");
  assert.equal(view.getUint16(34, true), 24);
  assert.equal(view.getUint32(28, true), 44100 * 6);
  assert.equal(view.getUint32(40, true), 4 * 6);
  assert.equal(int24(view, 44), 0x7fffff, "+1");
  assert.equal(int24(view, 44 + 3), 0, "오른쪽 0");
  assert.equal(int24(view, 44 + 6), 4194304, "+0.5");
  assert.equal(int24(view, 44 + 12), -0x800000, "−1");
  assert.equal(int24(view, 44 + 18), -4194304, "−0.5");
  assert.deepEqual([view.getUint8(44), view.getUint8(45), view.getUint8(46)], [0xff, 0xff, 0x7f], "바이트 순서(낮은 자리부터)");
});

test("채널 길이가 다르면 짧은 쪽에 맞추고, 모노·빈 입력도 만든다", () => {
  const uneven = new DataView(encodePcmWav([new Float32Array(5), new Float32Array(3)], 44100, 16));
  assert.equal(uneven.getUint32(40, true), 3 * 2 * 2);
  const mono = new DataView(encodePcmWav([Float32Array.of(0.5, -0.5)], 8000, 16));
  assert.equal(mono.getUint16(22, true), 1);
  assert.equal(mono.getUint16(32, true), 2);
  assert.equal(mono.getUint32(40, true), 4);
  const empty = encodePcmWav([new Float32Array(0), new Float32Array(0)], 44100, 24);
  assert.equal(empty.byteLength, WAV_HEADER_BYTES);
  assert.equal(new DataView(empty).getUint32(40, true), 0);
});

test("같은 입력이면 늘 같은 바이트(파일 해시가 같다)", () => {
  const make = () => {
    const l = new Float32Array(10000);
    const r = new Float32Array(10000);
    for (let i = 0; i < l.length; i += 1) { l[i] = Math.sin(i / 17) * 0.9; r[i] = Math.cos(i / 31) * 0.7; }
    return [l, r];
  };
  const hash = (bits) => createHash("sha256").update(Buffer.from(encodePcmWav(make(), 44100, bits))).digest("hex");
  assert.equal(hash(16), hash(16));
  assert.equal(hash(24), hash(24));
  assert.notEqual(hash(16), hash(24));
});

test("Worker를 쓸 수 없는 환경에서는 그 자리에서 만들어 audio/wav Blob으로 돌려준다", async () => {
  assert.equal(typeof Worker, "undefined", "Node에는 Worker가 없다");
  const blob = await encodeWavInWorker([Float32Array.of(0.5, -0.5), Float32Array.of(0, 1)], 44100, 16);
  assert.equal(blob.type, "audio/wav");
  assert.equal(blob.size, WAV_HEADER_BYTES + 2 * 2 * 2);
  const view = new DataView(await blob.arrayBuffer());
  assert.equal(view.getInt16(44, true), 16384);
  assert.equal(view.getInt16(48, true), -16384);
});

test("이미 취소된 신호로 부르면 만들지 않고 취소로 끝난다", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(encodeWavInWorker([new Float32Array(4), new Float32Array(4)], 44100, 16, controller.signal), (error) => {
    assert.ok(error instanceof MixCancelledError);
    assert.ok(isMixCancelled(error));
    return true;
  });
  assert.equal(isMixCancelled(new Error("다른 오류")), false);
});
