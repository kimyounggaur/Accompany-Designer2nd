/**
 * 프로젝트 검사기(설계서 §P4-1): "버전 감지 → 이전 → 검사 + 기본값 채우기 + 범위 보정"을 한 번에 한다.
 * 프로젝트 파일 열기, 자동 저장 복구, 옛 자동 저장(v1) 이전이 모두 이 함수를 쓴다.
 *
 *  - 뼈대(필수 항목·자료형)가 틀리면 `{ ok: false }`. 아무것도 바꾸지 않는다.
 *  - 범위를 벗어난 숫자는 가장 가까운 허용값으로 고치고 `issues`에 남긴다(`fixed: true`).
 *  - 모르는 키는 결과에 없다. 주소처럼 보이는 글자는 기본 글자로 바뀐다.
 *  - 개수 상한: 트랙 128, 클립 10,000, 마커 1,000, 이름 200자.
 */
import { MASTER_VOLUME_MAX_DB, MASTER_VOLUME_MIN_DB, MASTER_VOLUME_DEFAULT_DB, normalizeMasterVolumeDb } from "../master/volume";
import type { AssetMeta, Clip, MasterSettings, ProjectDoc, TimeMarker, TimeSignature, Track } from "../types";
import { runParse, type IssueLog, type Parsed } from "./issues";
import { detectVersion, migrateLegacyProject, SCHEMA_VERSION } from "./migrations";
import {
  ASSET_BYTE_SIZE_RANGE,
  ASSET_CHANNELS_RANGE,
  ASSET_SAMPLE_RATE_RANGE,
  BPM_DEFAULT,
  BPM_RANGE,
  CLIP_GAIN_RANGE,
  CLIP_SOURCE_BPM_RANGE,
  MAX_CLIPS,
  MAX_MARKERS,
  MAX_TRACKS,
  SAMPLE_RATE_DEFAULT,
  SAMPLE_RATE_RANGE,
  TIME_RANGE,
  TIME_SIGNATURE_BEATS_RANGE,
  TRACK_PAN_RANGE,
  TRACK_VOLUME_RANGE,
} from "./ranges";
import {
  at,
  isObject,
  readBool,
  readCompressor,
  readDelay,
  readEffectChain,
  readEnum,
  readEq,
  readId,
  readNumber,
  readOptionalId,
  readOptionalNumber,
  readOptionalString,
  readReverb,
  readText,
  type Obj,
} from "./readers";

const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const DEFAULT_PROJECT_NAME = "가져온 세션";

/** 값이 `undefined`인 키를 뺀다(없는 값은 키도 없게 해서 왕복·비교가 어긋나지 않게) */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function requiredObject(log: IssueLog, raw: unknown, path: string): Obj {
  if (raw === undefined) return log.fail(path, "missing");
  if (!isObject(raw)) return log.fail(path, "type");
  return raw;
}

function requiredArray(log: IssueLog, raw: unknown, path: string): unknown[] {
  if (raw === undefined) return log.fail(path, "missing");
  if (!Array.isArray(raw)) return log.fail(path, "type");
  return raw;
}

// ───────────────────────── 낱개 항목 ─────────────────────────

function readClip(log: IssueLog, raw: unknown, path: string, trackId: string): Clip {
  if (!isObject(raw)) return log.fail(path, "type");
  const id = readId(log, raw.id, at(path, "id"));
  const clipTrackId = readId(log, raw.trackId, at(path, "trackId"));
  if (clipTrackId !== trackId) return log.fail(at(path, "trackId"), "enum"); // 클립은 자기가 들어 있는 트랙을 가리켜야 한다
  const duration = readNumber(log, raw.duration, at(path, "duration"), { range: TIME_RANGE, required: true });
  const half = duration / 2;
  const fade = (key: "fadeIn" | "fadeOut") =>
    Math.min(half, readNumber(log, raw[key], at(path, key), { range: TIME_RANGE, def: 0 })); // 클립 길이의 절반을 넘는 페이드는 조용히 줄인다(지금 동작)
  const clip: Clip = {
    id,
    audioBufferId: readId(log, raw.audioBufferId, at(path, "audioBufferId")),
    name: readText(log, raw.name, at(path, "name"), "클립"),
    trackId,
    startTime: readNumber(log, raw.startTime, at(path, "startTime"), { range: TIME_RANGE, required: true }),
    offset: readNumber(log, raw.offset, at(path, "offset"), { range: TIME_RANGE, required: true }),
    duration,
    sourceBpm: readNumber(log, raw.sourceBpm, at(path, "sourceBpm"), { range: CLIP_SOURCE_BPM_RANGE, required: true, def: BPM_DEFAULT }),
    stretchMode: readEnum(log, raw.stretchMode, at(path, "stretchMode"), ["none", "resample"] as const),
    gain: readNumber(log, raw.gain, at(path, "gain"), { range: CLIP_GAIN_RANGE, required: true, def: 1 }),
    fadeIn: fade("fadeIn"),
    fadeOut: fade("fadeOut"),
    fadeCurve: readEnum(log, raw.fadeCurve, at(path, "fadeCurve"), ["linear", "equalPower"] as const, "equalPower"),
  };
  if (raw.muted !== undefined) clip.muted = readBool(log, raw.muted, at(path, "muted"));
  const groupId = readOptionalId(log, raw.groupId, at(path, "groupId"));
  if (groupId !== undefined) clip.groupId = groupId;
  if (raw.isRecording !== undefined) clip.isRecording = readBool(log, raw.isRecording, at(path, "isRecording"));
  return clip;
}

function readTrack(log: IssueLog, raw: unknown, path: string, index: number): Track {
  if (!isObject(raw)) return log.fail(path, "type");
  const id = readId(log, raw.id, at(path, "id"));
  const eq = readEq(log, raw.eq, at(path, "eq"));
  const compressor = readCompressor(log, raw.compressor, at(path, "compressor"));
  const delay = readDelay(log, raw.delay, at(path, "delay"));
  const reverb = readReverb(log, raw.reverb, at(path, "reverb"));
  const clipsRaw = requiredArray(log, raw.clips, at(path, "clips"));
  return {
    id,
    name: readText(log, raw.name, at(path, "name"), `트랙 ${index + 1}`),
    volume: readNumber(log, raw.volume, at(path, "volume"), { range: TRACK_VOLUME_RANGE, required: true, def: 0.86 }),
    pan: readNumber(log, raw.pan, at(path, "pan"), { range: TRACK_PAN_RANGE, required: true, def: 0 }),
    muted: readBool(log, raw.muted, at(path, "muted")),
    solo: readBool(log, raw.solo, at(path, "solo")),
    eq,
    compressor,
    delay,
    reverb,
    effectChain: readEffectChain(log, raw.effectChain, at(path, "effectChain"), { eq, compressor, delay, reverb }),
    clips: clipsRaw.map((clip, clipIndex) => readClip(log, clip, at(at(path, "clips"), clipIndex), id)),
  };
}

function readAsset(log: IssueLog, raw: unknown, path: string, key: string): AssetMeta {
  if (!isObject(raw)) return log.fail(path, "type");
  const id = readId(log, raw.id, at(path, "id"));
  if (id !== key) return log.fail(at(path, "id"), "enum"); // 음원 목록의 이름과 음원의 id가 같아야 한다
  const asset: AssetMeta = {
    id,
    fileName: readText(log, raw.fileName, at(path, "fileName"), "음원"),
    duration: readNumber(log, raw.duration, at(path, "duration"), { range: TIME_RANGE, required: true }),
    sampleRate: readNumber(log, raw.sampleRate, at(path, "sampleRate"), { range: ASSET_SAMPLE_RATE_RANGE, required: true, def: SAMPLE_RATE_DEFAULT }),
    channels: readNumber(log, raw.channels, at(path, "channels"), { range: ASSET_CHANNELS_RANGE, required: true, def: 1, integer: true }),
    source: readEnum(log, raw.source, at(path, "source"), ["upload", "recording"] as const, "upload"),
  };
  const hash = readOptionalString(log, raw.hash, at(path, "hash"), (text) => SHA256_HEX.test(text));
  const mimeType = readOptionalString(log, raw.mimeType, at(path, "mimeType"), (text) => MIME_TYPE.test(text));
  const recordedAt = readOptionalString(log, raw.recordedAt, at(path, "recordedAt"), (text) => ISO_DATE.test(text) && Number.isFinite(Date.parse(text)));
  const byteSize = readOptionalNumber(log, raw.byteSize, at(path, "byteSize"), { range: ASSET_BYTE_SIZE_RANGE, integer: true });
  const detectedBpm = readOptionalNumber(log, raw.detectedBpm, at(path, "detectedBpm"), { range: BPM_RANGE });
  return compact({ ...asset, hash, mimeType, byteSize, detectedBpm, recordedAt });
}

function readMarker(log: IssueLog, raw: unknown, path: string, index: number): TimeMarker {
  if (!isObject(raw)) return log.fail(path, "type");
  return {
    id: readId(log, raw.id, at(path, "id")),
    time: readNumber(log, raw.time, at(path, "time"), { range: TIME_RANGE, required: true }),
    name: readText(log, raw.name, at(path, "name"), `마커 ${index + 1}`),
  };
}

function readTimeSignature(log: IssueLog, raw: unknown): TimeSignature {
  const o = requiredObject(log, raw, "timeSignature");
  const unit = o.unit === undefined ? 4 : o.unit;
  if (unit !== 4 && unit !== 8) return log.fail("timeSignature.unit", typeof unit === "number" ? "enum" : "type");
  return { beats: readNumber(log, o.beats, "timeSignature.beats", { range: TIME_SIGNATURE_BEATS_RANGE, def: 4, integer: true }), unit };
}

function readMaster(log: IssueLog, raw: unknown): MasterSettings {
  const o = requiredObject(log, raw, "master");
  const volumeDb = readNumber(log, o.volumeDb, "master.volumeDb", {
    range: [MASTER_VOLUME_MIN_DB, MASTER_VOLUME_MAX_DB],
    required: true,
    def: MASTER_VOLUME_DEFAULT_DB,
  });
  return { volumeDb: normalizeMasterVolumeDb(volumeDb) }; // 소수 첫째 자리까지만 남긴다(조용히)
}

// ───────────────────────── 문서 ─────────────────────────

/** v2 모양(검사 전)을 검사해 문서로 만든다 */
function readDoc(log: IssueLog, raw: unknown): ProjectDoc {
  if (!isObject(raw)) return log.fail("", "type");
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SCHEMA_VERSION) return log.fail("schemaVersion", "enum");

  const tracksRaw = requiredArray(log, raw.tracks, "tracks");
  if (tracksRaw.length === 0) return log.fail("tracks", "missing");
  if (tracksRaw.length > MAX_TRACKS) return log.fail("tracks", "limit");
  const clipCount = tracksRaw.reduce<number>((sum, track) => sum + (isObject(track) && Array.isArray(track.clips) ? track.clips.length : 0), 0);
  if (clipCount > MAX_CLIPS) return log.fail("tracks", "limit");
  const markersRaw = requiredArray(log, raw.markers, "markers");
  if (markersRaw.length > MAX_MARKERS) return log.fail("markers", "limit");
  const assetsRaw = requiredObject(log, raw.assets, "assets");

  const id = readId(log, raw.id, "id");
  const name = readText(log, raw.name, "name", DEFAULT_PROJECT_NAME) || DEFAULT_PROJECT_NAME;
  const bpm = readNumber(log, raw.bpm, "bpm", { range: BPM_RANGE, required: true, def: BPM_DEFAULT });
  const timeSignature = readTimeSignature(log, raw.timeSignature);
  const sampleRate = readNumber(log, raw.sampleRate, "sampleRate", { range: SAMPLE_RATE_RANGE, required: true, def: SAMPLE_RATE_DEFAULT });
  const master = readMaster(log, raw.master);
  const tracks = tracksRaw.map((track, index) => readTrack(log, track, at("tracks", index), index));
  const assets: Record<string, AssetMeta> = {};
  for (const [key, value] of Object.entries(assetsRaw)) {
    const path = at("assets", key);
    assets[readId(log, key, path)] = readAsset(log, value, path, key);
  }
  const markers = markersRaw.map((marker, index) => readMarker(log, marker, at("markers", index), index));

  return { schemaVersion: SCHEMA_VERSION, id, name, bpm, timeSignature, sampleRate, master, tracks, assets, markers };
}

/**
 * 프로젝트 값(파일에서 읽은 JSON, 자동 저장 기록의 문서 …)을 문서로 읽는다.
 * 받는 모양: v0 프로젝트 JSON, v1 `{ format, version: 1, project }`, v2 `{ format, schemaVersion: 2, doc }`, v2 문서 자체.
 * (껍데기의 `audio` 같은 음원 데이터는 이 함수가 보지 않는다. 파일을 읽는 쪽이 따로 다룬다.)
 */
export function parseProject(raw: unknown): Parsed<ProjectDoc> {
  return runParse((log) => {
    const detected = detectVersion(log, raw);
    return readDoc(log, detected.kind === "legacy" ? migrateLegacyProject(detected.project, log) : detected.doc);
  });
}
