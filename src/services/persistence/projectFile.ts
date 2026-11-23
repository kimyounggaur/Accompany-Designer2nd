/**
 * 프로젝트 파일(.adproj) 읽기·쓰기(설계서 §P4-2). 검사는 `domain/project/parseProject` 하나가 맡고, 이 파일은 껍데기와 음원 데이터만 다룬다.
 *
 * 쓰기: 압축하지 않은 zip.
 *   project.json                 { format, schemaVersion: 2, doc }
 *   audio/<해시><확장자>          음원 원본 바이트(같은 음원은 한 번만)
 *   음원은 문서의 `assets[id].hash`로 파일을 찾는다(해시를 계산하지 못한 환경에서는 `plain-<음원 id>`가 이름이 된다).
 *
 * 읽기: 앞 4바이트가 `PK\x03\x04`이면 zip. 아니면 옛 JSON이다 —
 *   v0(6월 프로젝트 JSON, 음원 없음) / v1 { format, version: 1, project, audio: { id: "data:…;base64,…" } } / 4단계 중간에 잠시 쓴 v2 JSON.
 * 어느 쪽이든 안쪽 프로젝트는 `parseProject`를 거친다.
 */
import { strFromU8, strToU8, unzipSync, Zip, ZipPassThrough } from "fflate";
import { parseProject } from "../../domain/project/parseProject";
import { serialize } from "../../domain/project/serialize";
import type { Issue } from "../../domain/project/issues";
import type { AssetMeta, ProjectDoc } from "../../domain/types";
import { ko } from "../../i18n/ko";
import { clearPeaks } from "../peaksCache";
import { hashOrUndefined } from "./assetHash";
import { forgetAllAudio, recallAudio, rememberAudio } from "./audioBlobs";

/** 프로젝트 파일의 확장자 */
export const PROJECT_FILE_EXTENSION = ".adproj";
const DOC_ENTRY = "project.json";
const AUDIO_DIR = "audio/";
/** project.json 한 개가 이보다 크면 열지 않는다(트랙 128개·클립 1만 개로도 이보다 한참 작다). */
const MAX_DOC_BYTES = 64 * 1024 * 1024;
/** 음원 원본의 합이 이보다 크면 열지 않는다(한꺼번에 메모리에 올라오므로 탭이 죽기 전에 막는다). */
const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;
/** 음원을 zip에 넣을 때 한 번에 읽는 크기(Blob을 통째로 배열로 만들지 않는다) */
const ZIP_SLICE_BYTES = 8 * 1024 * 1024;

/** 파일(또는 자동 저장 기록)에서 읽어 낸 프로젝트 */
export interface LoadedProject {
  doc: ProjectDoc;
  /** 읽으면서 고친 값들(범위를 벗어난 숫자 등). 비어 있으면 그대로 읽었다. */
  issues: Issue[];
  /** 음원 id → 원본 데이터. 파일에 들어 있던 것만 있다(없는 음원은 "다시 연결"이 필요하다). */
  audio: Record<string, Blob>;
}

/** 못 읽은 이유를 사람이 읽을 한국어 오류로 만든다(화면에는 "프로젝트 불러오기 실패: …"로 보인다). */
export function projectFailure(issues: ReadonlyArray<Issue>): Error {
  const blocking = issues.find((issue) => !issue.fixed);
  if (!blocking) return new Error(ko.error.projectBroken(""));
  if (["", "format", "version", "schemaVersion"].includes(blocking.path)) return new Error(ko.error.projectUnsupported);
  if (blocking.problem === "limit" && /^(tracks|markers)$/.test(blocking.path)) return new Error(ko.error.projectTooBig);
  return new Error(ko.error.projectBroken(blocking.path));
}

const hasOwn = (target: object, key: string): boolean => Object.prototype.hasOwnProperty.call(target, key);

// ───── 쓰기 ─────

const EXTENSION_BY_TYPE = new Map([
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/wave", ".wav"],
  ["audio/vnd.wave", ".wav"],
  ["audio/mpeg", ".mp3"],
  ["audio/mp3", ".mp3"],
  ["audio/mp4", ".m4a"],
  ["audio/x-m4a", ".m4a"],
  ["audio/m4a", ".m4a"],
  ["audio/aac", ".aac"],
  ["audio/ogg", ".ogg"],
  ["audio/webm", ".webm"],
  ["audio/flac", ".flac"],
]);

/** zip 안 음원 파일의 확장자. 종류(MIME)로 정하고, 모르면 원래 파일 이름의 확장자, 그것도 없으면 `.bin`. */
export function extensionOf(mimeType: string, fileName = ""): string {
  const known = EXTENSION_BY_TYPE.get(mimeType.split(";")[0].trim().toLowerCase());
  if (known) return known;
  const fromName = /\.([A-Za-z0-9]{1,5})$/.exec(fileName);
  return fromName ? `.${fromName[1].toLowerCase()}` : ".bin";
}

/** zip 안 음원 파일 이름에서 확장자를 뗀 부분. 문서의 음원이 이 값으로 파일을 찾는다. */
function audioKey(asset: Pick<AssetMeta, "id" | "hash">): string {
  return asset.hash ?? `plain-${asset.id}`;
}

interface ZipEntry {
  name: string;
  data: Uint8Array | Blob;
}

/** 압축하지 않은 zip을 만든다. 음원 Blob은 조각으로 읽어 넣으므로 원본 전체를 한 번에 메모리에 올리지 않는다. */
async function zipEntries(entries: ReadonlyArray<ZipEntry>): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  let failure: unknown;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else chunks.push(chunk);
  });
  for (const entry of entries) {
    const file = new ZipPassThrough(entry.name);
    zip.add(file);
    if (entry.data instanceof Uint8Array) {
      file.push(entry.data, true);
      continue;
    }
    for (let start = 0; start < entry.data.size; start += ZIP_SLICE_BYTES) {
      file.push(new Uint8Array(await entry.data.slice(start, start + ZIP_SLICE_BYTES).arrayBuffer()), false);
    }
    file.push(new Uint8Array(0), true);
  }
  zip.end();
  if (failure) throw failure;
  return new Blob(chunks as BlobPart[], { type: "application/zip" });
}

/**
 * 프로젝트를 파일 내용(zip Blob)으로 만든다. 음원은 문서의 음원 목록 중 데이터를 기억하고 있는 것만 담는다.
 * 문서에 적는 음원 해시는 담은 데이터에서 다시 계산한 값이다(문서에 없던 해시도 이때 채워진다).
 */
export async function exportProjectFile(doc: ProjectDoc, audioFor: (assetId: string) => Blob | undefined = recallAudio): Promise<Blob> {
  const assets: Record<string, AssetMeta> = {};
  const audio = new Map<string, ZipEntry>();
  for (const [assetId, asset] of Object.entries(doc.assets)) {
    const blob = audioFor(assetId);
    if (!blob) {
      assets[assetId] = asset; // 데이터가 없는 음원은 문서에만 남긴다(다시 연결할 때 해시가 단서가 된다).
      continue;
    }
    const hash = await hashOrUndefined(blob);
    const described = hash ? { ...asset, hash } : asset;
    assets[assetId] = described;
    const key = audioKey(described);
    if (!audio.has(key)) audio.set(key, { name: `${AUDIO_DIR}${key}${extensionOf(blob.type, asset.fileName)}`, data: blob });
  }
  const json = strToU8(JSON.stringify(serialize({ ...doc, assets })));
  return zipEntries([{ name: DOC_ENTRY, data: json }, ...audio.values()]);
}

// ───── 읽기 ─────

const DATA_URL = /^data:[\w.+/-]*;base64,[A-Za-z0-9+/=]*$/;

function decodeAudio(doc: ProjectDoc, encodedAudio: unknown): Record<string, Blob> {
  if (!encodedAudio || typeof encodedAudio !== "object" || Array.isArray(encodedAudio)) throw new Error(ko.error.projectUnsupported);
  const audio: Record<string, Blob> = {};
  for (const [id, encoded] of Object.entries(encodedAudio)) {
    if (!hasOwn(doc.assets, id) || typeof encoded !== "string" || !DATA_URL.test(encoded)) throw new Error(ko.error.projectAudioData);
    const bytes = Uint8Array.from(atob(encoded.slice(encoded.indexOf(",") + 1)), (c) => c.charCodeAt(0));
    audio[id] = new Blob([bytes], { type: doc.assets[id].mimeType || "application/octet-stream" });
  }
  return audio;
}

/** 파일에서 읽은 JSON 값을 프로젝트로 읽는다(검사 + 음원 풀기). 읽을 수 없으면 한국어 사유로 던진다. */
export function projectFromJson(value: unknown): LoadedProject {
  const parsed = parseProject(value);
  if (!parsed.ok) throw projectFailure(parsed.issues);
  const container = value as Record<string, unknown>;
  // 껍데기(format이 있는 JSON)는 음원 목록(audio)이 있어야 한다. 6월 형식은 껍데기도 음원도 없다.
  const audio = "format" in container ? decodeAudio(parsed.value, container.audio) : {};
  return { doc: parsed.value, issues: parsed.issues, audio };
}

/** zip 파일 안에서 읽을 것(project.json과 audio/ 아래 파일)만 고르고, 풀었을 때의 크기가 너무 크면 거부한다. */
function zipFilter(): (file: { name: string; originalSize: number }) => boolean {
  let audioBytes = 0;
  return (file) => {
    if (file.name === DOC_ENTRY) {
      if (file.originalSize > MAX_DOC_BYTES) throw new Error(ko.error.projectFileTooBig);
      return true;
    }
    if (file.name.startsWith(AUDIO_DIR) && !file.name.endsWith("/")) {
      audioBytes += file.originalSize;
      if (audioBytes > MAX_AUDIO_BYTES) throw new Error(ko.error.projectFileTooBig);
      return true;
    }
    return false;
  };
}

/** zip을 프로젝트로 읽는다. 음원은 문서의 해시로 `audio/` 아래 파일을 찾는다(없으면 "다시 연결"이 필요한 음원이 된다). */
function projectFromZip(bytes: Uint8Array): LoadedProject {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: zipFilter() });
  } catch (error) {
    if (error instanceof Error && error.message === ko.error.projectFileTooBig) throw error;
    throw new Error(ko.error.projectInvalid); // fflate의 영어 오류는 보이지 않는다
  }
  const docBytes = hasOwn(entries, DOC_ENTRY) ? entries[DOC_ENTRY] : undefined;
  if (!docBytes) throw new Error(ko.error.projectUnsupported);

  const parsed = parseProject(JSON.parse(strFromU8(docBytes)) as unknown);
  if (!parsed.ok) throw projectFailure(parsed.issues);

  const byKey = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (name.startsWith(AUDIO_DIR)) byKey.set(name.slice(AUDIO_DIR.length).replace(/\.[^./]*$/, ""), data);
  }
  const audio: Record<string, Blob> = {};
  const blobByKey = new Map<string, Blob>(); // 같은 음원을 쓰는 음원 정보는 Blob 하나를 함께 쓴다(해시를 한 번만 계산)
  for (const [id, asset] of Object.entries(parsed.value.assets)) {
    const key = audioKey(asset);
    const data = byKey.get(key);
    if (!data) continue;
    let blob = blobByKey.get(key);
    if (!blob) {
      blob = new Blob([data as BlobPart], { type: asset.mimeType || "application/octet-stream" });
      blobByKey.set(key, blob);
    }
    audio[id] = blob;
  }
  return { doc: parsed.value, issues: parsed.issues, audio };
}

/** 프로젝트 파일을 읽는다. zip(.adproj)과 옛 JSON(v0·v1)을 모두 읽는다. 읽을 수 없으면 한국어 사유로 던진다. */
export async function readProjectFile(file: Blob): Promise<LoadedProject> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    return projectFromZip(new Uint8Array(await file.arrayBuffer()));
  }
  // 옛 JSON: 맨 앞(BOM·공백 뒤)이 `{`가 아니면 JSON 프로젝트가 아니다. 커다란 다른 파일을 통째로 글자로 바꾸지 않도록 먼저 거른다.
  let start = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  while (start < head.length && (head[start] === 0x20 || head[start] === 0x09 || head[start] === 0x0a || head[start] === 0x0d)) start += 1;
  if (head[start] !== 0x7b) throw new SyntaxError("not a project file");
  return projectFromJson(JSON.parse(await file.text()) as unknown);
}

/**
 * 읽어 낸 음원 데이터를 소리 데이터로 풀어 둔다. 풀기까지 모두 끝나야 `commit()`을 부를 수 있다(중간에 실패해도 지금 프로젝트는 그대로).
 * `commit()`이 기억하던 음원·파형을 비우고 새 것으로 바꾸며(소리 엔진에 올리는 일은 `decode`가 돌려준 `commit`이 한다) 음원 데이터를 기억한다.
 * 해시가 기록되지 않은 옛 음원(v1·옛 자동 저장)은 데이터에서 계산해 돌려주는 문서에 채운다(다음에 저장할 때 해시로 다시 연결할 수 있다).
 */
export async function restoreAudio(
  loaded: Pick<LoadedProject, "doc" | "audio">,
  decode: (blob: Blob, asset: AssetMeta) => Promise<{ commit: () => void }>,
): Promise<{ doc: ProjectDoc; missing: number; commit: () => void }> {
  const staged: Array<{ id: string; blob: Blob; commit: () => void }> = [];
  let assets = loaded.doc.assets;
  let missing = 0;
  for (const [id, asset] of Object.entries(loaded.doc.assets)) {
    const blob = hasOwn(loaded.audio, id) ? loaded.audio[id] : undefined;
    if (!(blob instanceof Blob)) {
      missing += 1;
      continue;
    }
    const decoded = await decode(blob, asset);
    staged.push({ id, blob, commit: decoded.commit });
    if (!asset.hash) {
      const hash = await hashOrUndefined(blob);
      if (hash) {
        if (assets === loaded.doc.assets) assets = { ...assets };
        assets[id] = { ...asset, hash };
      }
    }
  }
  return {
    doc: assets === loaded.doc.assets ? loaded.doc : { ...loaded.doc, assets },
    missing,
    commit: () => {
      forgetAllAudio();
      clearPeaks();
      for (const item of staged) {
        item.commit();
        rememberAudio(item.id, item.blob);
      }
    },
  };
}
