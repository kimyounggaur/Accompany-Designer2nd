// 회귀 스위트용 시험 파일을 만든다: node scripts/make-fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";

function wav({ seconds = 8, sampleRate = 44100, sample }) {
  const frames = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + frames * 4); // 16비트 스테레오
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + frames * 4, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 4, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.max(-1, Math.min(1, sample(i / sampleRate, seconds))) * 32767);
    buffer.writeInt16LE(v, 44 + i * 4); buffer.writeInt16LE(v, 46 + i * 4);
  }
  return buffer;
}

mkdirSync("e2e/fixtures", { recursive: true });
// 앞 4초 작게(0.05), 뒤 4초 크게(0.8)인 220Hz 사인파 — B1 파형·C8 출력 한계 측정용
writeFileSync("e2e/fixtures/quiet-loud-8s.wav",
  wav({ sample: (t, len) => Math.sin(2 * Math.PI * 220 * t) * (t < len / 2 ? 0.05 : 0.8) }));
writeFileSync("e2e/fixtures/not-audio.txt", "not audio");
console.log("fixtures ready");
