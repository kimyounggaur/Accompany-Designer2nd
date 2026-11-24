// 회귀 스위트용 시험 파일을 만든다: node scripts/make-fixtures.mjs
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";

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

/** 8kHz 모노 16비트 WAV(파일을 작게 두려는 모양: 1시간이 57.6 MB). 앞 절반은 `loud`, 뒤 절반은 `quiet` 크기의 220Hz 사인파. */
function longMonoWav({ seconds, sampleRate = 8000, loud, quiet }) {
  const frames = seconds * sampleRate;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + frames * 2, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(frames * 2, 40);
  const half = frames / 2;
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * (i < half ? loud : quiet) * 32767);
    buffer.writeInt16LE(v, 44 + i * 2);
  }
  return buffer;
}

mkdirSync("e2e/fixtures", { recursive: true });
// 앞 4초 작게(0.05), 뒤 4초 크게(0.8)인 220Hz 사인파 — B1 파형·C8 출력 한계 측정용
writeFileSync("e2e/fixtures/quiet-loud-8s.wav",
  wav({ sample: (t, len) => Math.sin(2 * Math.PI * 220 * t) * (t < len / 2 ? 0.05 : 0.8) }));
// 12초 내내 크기가 같은 220Hz 사인파(0.5) — 재생 중 클립 이동·시크가 만드는 튐(클릭)만 따로 재기 위한 음원(P3-2).
// 정상 신호의 이웃 샘플 차이가 0.02 안팎이라, 튐 기준(0.2)을 넘으면 전부 엔진이 만든 클릭이다.
writeFileSync("e2e/fixtures/steady-220hz-12s.wav",
  wav({ seconds: 12, sample: (t) => Math.sin(2 * Math.PI * 220 * t) * 0.5 }));
// 3분 내내 같은 크기(0.4)의 220Hz 사인파 — 믹스 내보내기(P3-6)의 '3분짜리 곡에서 화면이 멈추지 않는다·진행률·취소'를 재기 위한 긴 음원.
// 파일이 31 MB라 이 음원을 쓰는 시험만 올린다.
writeFileSync("e2e/fixtures/steady-220hz-180s.wav",
  wav({ seconds: 180, sample: (t) => Math.sin(2 * Math.PI * 220 * t) * 0.4 }));
// 1시간 내내 220Hz 사인파(앞 30분 0.8, 뒤 30분 0.2) — P4-3 "한 시간짜리 음원도 파형이 보이고, 파형을 계산하는 동안 화면이 200 ms 넘게 멈추지 않는다"를 재는 음원.
// 파일이 57.6 MB라 이 음원을 쓰는 시험만 올린다. 이미 있으면 다시 만들지 않는다.
const HOUR = "e2e/fixtures/loud-quiet-220hz-1h.wav";
if (!existsSync(HOUR) || statSync(HOUR).size !== 44 + 3600 * 8000 * 2) {
  writeFileSync(HOUR, longMonoWav({ seconds: 3600, loud: 0.8, quiet: 0.2 }));
}
writeFileSync("e2e/fixtures/not-audio.txt", "not audio");
console.log("fixtures ready");
