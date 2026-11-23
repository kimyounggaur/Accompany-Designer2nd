/** 프로젝트 전체(이름·템포·음원·마커·통째로 바꾸기)에 대한 문서 변경 함수 */
import { MASTER_VOLUME_DEFAULT_DB, normalizeMasterVolumeDb } from "../../domain/master/volume";
import { createEmptyDoc } from "../../domain/project/defaults";
import type { AssetMeta, ProjectDoc } from "../../domain/types";
import { clamp, createId } from "../../utils/audioMath";
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

export function addAudioAsset(asset: AssetMeta, options?: EditOptions): boolean {
  return history.edit("음원 추가", (doc) => { doc.assets[asset.id] = asset; }, options);
}

/** 음원 정보를 고친다. 값이 모두 같으면 아무것도 하지 않는다. 없는 id면 patch로 새로 만든다(예전 동작). */
export function updateAudioAsset(assetId: string, patch: Partial<AssetMeta>, options?: EditOptions): boolean {
  return history.edit("음원 정보 변경", (doc) => {
    const existing = baseOf(doc).assets[assetId];
    const same = existing && Object.entries(patch).every(([key, value]) => existing[key as keyof AssetMeta] === value);
    if (same) return;
    doc.assets[assetId] = { ...existing, ...patch } as AssetMeta;
  }, options);
}

export function addTimeMarker(time: number, options?: EditOptions): boolean {
  const markerTime = Math.max(0, time);
  const id = createId("marker");
  return history.edit("마커 추가", (doc) => {
    doc.markers.push({ id, time: markerTime, name: `마커 ${doc.markers.length + 1}` });
  }, options);
}

export function clearTimeMarkers(options?: EditOptions): boolean {
  return history.edit("마커 모두 지우기", (doc) => {
    if (!baseOf(doc).markers.length) return;
    doc.markers = [];
  }, options);
}

/**
 * 불러온 프로젝트로 문서를 통째로 바꾼다. 받는 문서는 이미 검사기(parseProject)를 거친 것이어야 한다
 * (빠진 값 채우기·범위 보정은 그쪽에서 한 번만 한다).
 */
export function replaceDoc(project: ProjectDoc, options?: EditOptions): boolean {
  return history.edit("프로젝트 열기", (doc) => { Object.assign(doc, project); }, options);
}

/** 새 프로젝트(트랙 1개) */
export function resetDoc(options?: EditOptions): boolean {
  const empty = createEmptyDoc();
  return history.edit("새 프로젝트", (doc) => { Object.assign(doc, empty); }, options);
}

/** 지금 문서(읽기 전용). 편집 함수 밖에서 값을 확인할 때 */
export const currentDoc = (): ProjectDoc => getDoc();
