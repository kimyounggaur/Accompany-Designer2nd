/**
 * 프로젝트 파일(.json) 읽기·쓰기. 검사는 `domain/project/parseProject` 하나가 맡고, 이 파일은 껍데기와 음원 데이터만 다룬다.
 *
 * 지금 파일 모양(4단계 P4-2에서 `.adproj`(zip)로 바뀐다. 아래 읽기는 옛 JSON 둘을 계속 읽는다):
 *   쓰기: { format, schemaVersion: 2, doc, audio: { <음원 id>: "data:…;base64,…" } }
 *   읽기: v0 프로젝트 JSON(음원 없음) / v1 { format, version: 1, project, audio } / 위의 v2 JSON
 */
import { parseProject } from "../../domain/project/parseProject";
import { serialize } from "../../domain/project/serialize";
import type { Issue } from "../../domain/project/issues";
import type { AssetMeta, ProjectDoc } from "../../domain/types";
import { ko } from "../../i18n/ko";
import { clearPeaks } from "../peaksCache";
import { forgetAllAudio, recallAudio, rememberAudio } from "./audioBlobs";

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

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  // FileReader가 없는 곳(시험 환경)에서도 같은 모양의 주소를 만든다.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

/** 프로젝트를 파일 내용(Blob)으로 만든다. 음원은 문서의 음원 목록 중 데이터를 기억하고 있는 것만 담는다. */
export async function exportProject(doc: ProjectDoc, audioFor: (assetId: string) => Blob | undefined = recallAudio): Promise<Blob> {
  const audio: Record<string, string> = {};
  for (const assetId of Object.keys(doc.assets)) {
    const blob = audioFor(assetId);
    if (blob) audio[assetId] = await blobToDataUrl(blob);
  }
  return new Blob([JSON.stringify({ ...serialize(doc), audio })], { type: "application/json" });
}

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
  // 껍데기(format이 있는 파일)는 음원 목록(audio)이 있어야 한다. 6월 형식은 껍데기도 음원도 없다.
  const audio = "format" in container ? decodeAudio(parsed.value, container.audio) : {};
  return { doc: parsed.value, issues: parsed.issues, audio };
}

export async function readProjectFile(file: Blob): Promise<LoadedProject> {
  return projectFromJson(JSON.parse(await file.text()) as unknown);
}

/**
 * 읽어 낸 음원 데이터를 소리 데이터로 풀어 둔다. 풀기까지 모두 끝나야 `commit()`을 부를 수 있다(중간에 실패해도 지금 프로젝트는 그대로).
 * `commit()`이 기억하던 음원·파형을 비우고 새 것으로 바꾸며(소리 엔진에 올리는 일은 `decode`가 돌려준 `commit`이 한다) 음원 데이터를 기억한다.
 */
export async function restoreAudio(
  loaded: Pick<LoadedProject, "doc" | "audio">,
  decode: (blob: Blob, asset: AssetMeta) => Promise<{ commit: () => void }>,
): Promise<{ doc: ProjectDoc; missing: number; commit: () => void }> {
  const staged: Array<{ id: string; blob: Blob; commit: () => void }> = [];
  let missing = 0;
  for (const [id, asset] of Object.entries(loaded.doc.assets)) {
    const blob = hasOwn(loaded.audio, id) ? loaded.audio[id] : undefined;
    if (!(blob instanceof Blob)) {
      missing += 1;
      continue;
    }
    const decoded = await decode(blob, asset);
    staged.push({ id, blob, commit: decoded.commit });
  }
  return {
    doc: loaded.doc,
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
