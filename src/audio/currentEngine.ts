import { audioEngine as legacyEngine, type BrowserAudioEngine } from "./audioEngine";
import { AudioEngineV2 } from "./engine/AudioEngine";
import { readEngineChoice } from "./engine/engineChoice";

/** 이번 실행에서 쓰는 엔진 종류. 화면에는 보이지 않지만 `<html data-engine>`에 적어 둔다. */
export const engineChoice = readEngineChoice();

/** 화면이 쓰는 소리 엔진 하나. 기본은 옛 엔진이고, `?engine=v2`일 때만 새 엔진이다. */
export const audioEngine: BrowserAudioEngine = engineChoice === "v2" ? new AudioEngineV2() : legacyEngine;

if (typeof document !== "undefined") document.documentElement.dataset.engine = engineChoice;
