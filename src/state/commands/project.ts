/** 프로젝트 전체(이름·템포·음원·마커·통째로 바꾸기)에 대한 문서 변경 함수 */
import { MASTER_VOLUME_DEFAULT_DB, normalizeMasterVolumeDb } from "../../domain/master/volume";
import type { AudioAsset, ProjectDoc } from "../../types";
import { clamp, createId } from "../../utils/audioMath";
import { createDefaultTrack, createEmptyDoc, normalizeTrack } from "../docDefaults";
import { history, type EditOptions } from "../history";
import { getDoc } from "../projectStore";
import { baseOf } from "./locate";

export function setBpm(bpm: number, options?: EditOptions): boolean {
  const value = clamp(Number(bpm) || 120, 20, 300);
  return history.edit("템포 변경", (doc) => { doc.bpm = value; }, options);
}

export function setProjectName(name: string, options?: EditOptions): boolean {
  return history.edit("프로젝트 이름 변경", (doc) => { doc.name = name; }, options);
}

/**
 * 마스터 볼륨(dB)을 바꾼다. 범위(−60 ~ +6)로 맞추고 소수 첫째 자리까지만 남긴다.
 * 슬라이더를 끄는 동안 이어지는 변경은 같은 key로 한 단계로 묶인다.
 */
export function setMasterVolumeDb(volumeDb: number, options?: EditOptions): boolean {
  const value = normalizeMasterVolumeDb(volumeDb);
  return history.edit("마스터 볼륨 변경", (doc) => {
    // master가 없는 옛 문서는 0 dB로 본다. 값이 그대로면 이력에 남기지 않는다.
    if ((baseOf(doc).master?.volumeDb ?? MASTER_VOLUME_DEFAULT_DB) === value) return;
    doc.master = { volumeDb: value };
  }, { key: "master-volume", ...options });
}

export function addAudioAsset(asset: AudioAsset, options?: EditOptions): boolean {
  return history.edit("음원 추가", (doc) => { doc.audioAssets[asset.id] = asset; }, options);
}

/** 음원 정보를 고친다. 값이 모두 같으면 아무것도 하지 않는다. 없는 id면 patch로 새로 만든다(예전 동작). */
export function updateAudioAsset(assetId: string, patch: Partial<AudioAsset>, options?: EditOptions): boolean {
  return history.edit("음원 정보 변경", (doc) => {
    const existing = baseOf(doc).audioAssets[assetId];
    const same = existing && Object.entries(patch).every(([key, value]) => existing[key as keyof AudioAsset] === value);
    if (same) return;
    doc.audioAssets[assetId] = { ...existing, ...patch } as AudioAsset;
  }, options);
}

export function addTimeMarker(time: number, options?: EditOptions): boolean {
  const markerTime = Math.max(0, time);
  const id = createId("marker");
  return history.edit("마커 추가", (doc) => {
    doc.timeMarkers.push({ id, time: markerTime, name: `마커 ${doc.timeMarkers.length + 1}` });
  }, options);
}

export function clearTimeMarkers(options?: EditOptions): boolean {
  return history.edit("마커 모두 지우기", (doc) => {
    if (!baseOf(doc).timeMarkers.length) return;
    doc.timeMarkers = [];
  }, options);
}

/** 불러온 프로젝트로 문서를 통째로 바꾼다. 빠진 값은 기본값으로 채우고 범위를 보정한다. */
export function replaceDoc(project: ProjectDoc, options?: EditOptions): boolean {
  return history.edit("프로젝트 열기", (doc) => {
    doc.id = project.id || createId("project");
    doc.name = project.name || "가져온 세션";
    doc.bpm = clamp(project.bpm || 120, 20, 300);
    doc.sampleRate = project.sampleRate || 44100;
    doc.master = { volumeDb: normalizeMasterVolumeDb(project.master?.volumeDb ?? MASTER_VOLUME_DEFAULT_DB) };
    doc.tracks = project.tracks?.length
      ? project.tracks.map((track, index) => normalizeTrack(track, index))
      : [createDefaultTrack(1)];
    doc.audioAssets = project.audioAssets || {};
    doc.timeMarkers = project.timeMarkers || [];
  }, options);
}

/** 새 프로젝트(트랙 1개) */
export function resetDoc(options?: EditOptions): boolean {
  const empty = createEmptyDoc();
  return history.edit("새 프로젝트", (doc) => { Object.assign(doc, empty); }, options);
}

/** 지금 문서(읽기 전용). 편집 함수 밖에서 값을 확인할 때 */
export const currentDoc = (): ProjectDoc => getDoc();
