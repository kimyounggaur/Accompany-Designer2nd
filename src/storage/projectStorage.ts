import type { AudioAsset, DawProject } from "../types";

const DB_NAME = "accompany-designer";
const DB_STORE = "projects";
const DB_KEY = "autosave";
const FORMAT = "accompany-designer-project";
const VERSION = 1;
const audioBlobs = new Map<string, Blob>();

export function rememberAudio(id: string, blob: Blob) { audioBlobs.set(id, blob); }
export function hasRememberedAudio(id: string) { return audioBlobs.has(id); }

function projectCopy(project: DawProject): DawProject {
  return {
    ...project,
    audioAssets: Object.fromEntries(Object.entries(project.audioAssets).map(([id, asset]) => {
      const { blobUrl: _discard, ...safe } = asset;
      return [id, safe];
    })),
  };
}

function validateProject(input: unknown): DawProject {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
  const validId = (id: unknown) => typeof id === "string" && id.length > 0 && id.length < 500 && !["__proto__", "prototype", "constructor"].includes(id);
  const optionalFields = (value: unknown, numbers: string[], bools: string[], enums: Record<string, string[]> = {}) => {
    if (value === undefined) return true; // Earlier projects may omit effects; store normalization supplies defaults.
    if (!object(value)) return false;
    return numbers.every(key => value[key] === undefined || finite(value[key])) &&
      bools.every(key => value[key] === undefined || typeof value[key] === "boolean") &&
      Object.entries(enums).every(([key, allowed]) => value[key] === undefined || (typeof value[key] === "string" && allowed.includes(value[key] as string)));
  };
  const within = (settings: unknown, key: string, min: number, max: number) => !object(settings) || settings[key] === undefined || (finite(settings[key]) && (settings[key] as number) >= min && (settings[key] as number) <= max);
  if (!object(input)) throw new Error("프로젝트 형식이 올바르지 않습니다.");
  const p = input as unknown as DawProject;
  if (!validId(p.id) || typeof p.name !== "string" || !finite(p.bpm) || p.bpm <= 0 || !finite(p.sampleRate) || p.sampleRate <= 0 || !Array.isArray(p.tracks) || !p.tracks.length || !object(p.audioAssets) || !Array.isArray(p.timeMarkers)) throw new Error("프로젝트의 필수 항목이 올바르지 않습니다.");
  const validTracks = p.tracks.every(t => object(t) && validId(t.id) && typeof t.name === "string" && finite(t.volume) && t.volume >= 0 && t.volume <= 2 && finite(t.pan) && t.pan >= -1 && t.pan <= 1 && typeof t.muted === "boolean" && typeof t.solo === "boolean" && Array.isArray(t.clips) &&
    optionalFields(t.eq, ["bassGain", "middleLowGain", "middleHighGain", "highGain", "presenceGain", "lowGain", "midGain"], ["enabled"]) &&
    optionalFields(t.compressor, ["threshold", "ratio", "attack", "release"], ["enabled"]) && within(t.compressor, "threshold", -100, 0) && within(t.compressor, "ratio", 1, 20) && within(t.compressor, "attack", 0, 1) && within(t.compressor, "release", 0, 1) &&
    optionalFields(t.delay, ["delayTimeMs", "feedback", "dry", "wet", "highCutHz"], ["enabled", "syncEnabled", "pingPong"], { syncDivision: ["1/1", "1/2", "1/4", "1/8", "1/16", "1/8d", "1/8t"] }) &&
    optionalFields(t.reverb, ["preDelayMs", "decay", "drive", "dry", "wet", "width", "highPassHz", "lowPassHz", "modAmount", "postEqLowGain", "postEqMidGain", "postEqHighGain"], ["enabled", "modEnabled"], { mode: ["plate", "room", "hall"] }) &&
    (t.effectChain === undefined || (Array.isArray(t.effectChain) && t.effectChain.every(slot => object(slot) && validId(slot.id) && ["eq", "comp", "delay", "reverb"].includes(String(slot.type)) && typeof slot.enabled === "boolean"))) &&
    t.clips.every(c => object(c) && validId(c.id) && validId(c.audioBufferId) && validId(c.trackId) && c.trackId === t.id && typeof c.name === "string" && finite(c.startTime) && c.startTime >= 0 && finite(c.offset) && c.offset >= 0 && finite(c.duration) && c.duration >= 0 && finite(c.sourceBpm) && c.sourceBpm > 0 && ["none", "resample"].includes(String(c.stretchMode)) && finite(c.gain) && c.gain >= 0 && (c.fadeIn === undefined || (finite(c.fadeIn) && c.fadeIn >= 0)) && (c.fadeOut === undefined || (finite(c.fadeOut) && c.fadeOut >= 0)) && (c.fadeCurve === undefined || ["linear", "equalPower"].includes(String(c.fadeCurve))) && (c.muted === undefined || typeof c.muted === "boolean")));
  if (!validTracks) throw new Error("트랙 또는 클립 정보가 올바르지 않습니다.");
  if (!Object.entries(p.audioAssets).every(([id, a]) => validId(id) && object(a) && typeof a.fileName === "string" && a.id === id && finite(a.duration) && (a.duration as number) >= 0 && finite(a.sampleRate) && (a.sampleRate as number) > 0 && finite(a.channels) && (a.channels as number) > 0 && Array.isArray(a.waveformPeaks) && a.waveformPeaks.every(finite))) throw new Error("음원 정보가 올바르지 않습니다.");
  if (!p.timeMarkers.every(m => object(m) && validId(m.id) && typeof m.name === "string" && finite(m.time) && m.time >= 0)) throw new Error("마커 정보가 올바르지 않습니다.");
  // A file must never be able to inject an executable or remote URL.
  return projectCopy(p);
}

type Stored = { format: string; version: number; project: DawProject; audio: Record<string, Blob> };
function snapshot(project: DawProject): Stored {
  const audio: Record<string, Blob> = {};
  for (const id of Object.keys(project.audioAssets)) {
    const blob = audioBlobs.get(id);
    if (blob) audio[id] = blob;
  }
  return { format: FORMAT, version: VERSION, project: projectCopy(project), audio };
}
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("자동 저장 공간을 열 수 없습니다."));
    request.onblocked = () => reject(new Error("자동 저장 공간이 다른 탭에서 사용 중입니다."));
  });
}
export async function saveAutosave(project: DawProject): Promise<void> {
  const db = await openDb();
  const data = snapshot(project);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(data, DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("자동 저장에 실패했습니다."));
      tx.onabort = () => reject(tx.error ?? new Error("자동 저장이 취소되었습니다."));
    });
  } finally { db.close(); }
}
export async function loadAutosave(): Promise<Stored | undefined> {
  const db = await openDb();
  try {
    const value = await new Promise<Stored | undefined>((resolve, reject) => {
      const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(DB_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!value) return undefined;
    if (value.format !== FORMAT || value.version !== VERSION) throw new Error("지원하지 않는 자동 저장 형식입니다.");
    return { ...value, project: validateProject(value.project) };
  } finally { db.close(); }
}
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
export async function exportProject(project: DawProject): Promise<Blob> {
  const data = snapshot(project);
  const audio = Object.fromEntries(await Promise.all(Object.entries(data.audio).map(async ([id, blob]) => [id, await blobToDataUrl(blob)])));
  return new Blob([JSON.stringify({ ...data, audio })], { type: "application/json" });
}
export async function parseProjectFile(file: File): Promise<Stored> {
  const value: unknown = JSON.parse(await file.text());
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("프로젝트 파일이 올바르지 않습니다.");
  const input = value as Record<string, unknown>;
  // Read older project-only JSON safely; it cannot contain reusable source audio.
  if (!("format" in input)) return { format: FORMAT, version: VERSION, project: validateProject(value), audio: {} };
  if (input.format !== FORMAT || input.version !== VERSION || !input.audio || typeof input.audio !== "object" || Array.isArray(input.audio)) throw new Error("지원하지 않는 프로젝트 파일 형식입니다.");
  const project = validateProject(input.project);
  const audio: Record<string, Blob> = {};
  for (const [id, encoded] of Object.entries(input.audio as Record<string, unknown>)) {
    if (!(id in project.audioAssets) || typeof encoded !== "string" || !/^data:[\w.+/-]*;base64,[A-Za-z0-9+/=]*$/.test(encoded)) throw new Error("음원 데이터가 올바르지 않습니다.");
    const raw = encoded.slice(encoded.indexOf(",") + 1);
    const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    audio[id] = new Blob([bytes], { type: project.audioAssets[id].mimeType || "application/octet-stream" });
  }
  return { format: FORMAT, version: VERSION, project, audio };
}
export async function restoreAudio(data: Stored, decode: (blob: Blob, asset: AudioAsset) => Promise<{ asset: AudioAsset; commit: () => void }>): Promise<{project: DawProject; missing: number; commit: () => void}> {
  const assets: Record<string, AudioAsset> = {};
  const staged: Array<{ id: string; blob: Blob; commit: () => void }> = [];
  let missing = 0;
  for (const [id, asset] of Object.entries(data.project.audioAssets)) {
    const blob = data.audio?.[id];
    if (!(blob instanceof Blob)) { assets[id] = asset; missing++; continue; }
    const decoded = await decode(blob, asset);
    staged.push({ id, blob, commit: decoded.commit });
    assets[id] = { ...asset, blobUrl: decoded.asset.blobUrl };
  }
  return { project: { ...data.project, audioAssets: assets }, missing, commit: () => {
    audioBlobs.clear();
    for (const item of staged) { item.commit(); rememberAudio(item.id, item.blob); }
  } };
}
