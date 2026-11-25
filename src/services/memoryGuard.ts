/**
 * 큰 음원 막기(설계서 §P6-4, 보고서 D7): 파일을 올릴 때 소리가 쓸 메모리를 미리·풀고 나서 따져 묻거나 거절한다.
 *
 *   풀기 전  WAV  → 파일 머리의 길이로 풀린 크기를 미리 계산한다(머리만 큰 길이를 적은 파일도 큰 소리로 본다).
 *            그 밖 → 파일 크기가 300MB를 넘으면 묻는다.
 *   푼 뒤    모든 파일 → 푼 소리의 길이·샘플레이트·채널로 다시 계산한다. 거부 기준을 넘으면 바로 내려놓고, 안내 기준을 넘으면 묻는다.
 *
 * 기준: 올린 소리 전체(이 파일 포함)가 안내 기준을 넘으면 묻고, 거부 기준을 넘으면 올리지 못하게 한다(`domain/memory/budget`).
 * 소리 엔진과 화면을 모르므로(services는 audio·ui를 모른다) 올린 소리의 크기·기준·묻는 창은 부르는 쪽(app)이 넘겨 준다.
 * 올리지 않기로 하면 `UploadSkipped`를 던진다 — 오류가 아니라 "이 파일은 건너뛴다"는 뜻이다.
 */
import { formatMemory, judgeTotal, decodedBytes, type MemoryLimits } from "../domain/memory/budget";
import { WAV_HEAD_BYTES, estimateWavDecodedBytes, readWavInfo, type WavInfo } from "../domain/memory/wavHeader";
import { ko } from "../i18n/ko";

/** 올리지 않기로 했다(사용자가 묻는 창에서 거절했거나, 기준을 넘어 막았다). 오류 알림을 띄우지 않고 건너뛴다. */
export class UploadSkipped extends Error {
  readonly reason: "declined" | "refused";
  readonly fileName: string;
  constructor(fileName: string, reason: "declined" | "refused") {
    super(`${fileName}: 올리지 않음(${reason})`);
    this.name = "UploadSkipped";
    this.reason = reason;
    this.fileName = fileName;
  }
}

export interface UploadGuardDeps {
  /** 지금 소리 엔진에 올라 있는 소리 전체의 크기(바이트) */
  usedBytes: () => number;
  /** 소리 장치의 샘플레이트(풀면 이 샘플레이트로 맞춰진다) */
  outputRate: () => number;
  limits: () => Readonly<MemoryLimits>;
  /** 묻는 창: 올리면 true, 올리지 않으면 false */
  ask: (options: { title: string; message: string; confirmLabel: string; cancelLabel: string }) => Promise<boolean>;
  /** 알리기만 하는 창(확인 단추만) */
  inform: (options: { title: string; message: string; confirmLabel: string }) => Promise<void>;
}

/** 풀기 전 검사의 결과(풀고 난 뒤에 같은 질문을 두 번 하지 않으려고 쓴다) */
export interface BeforeDecode {
  asked: boolean;
}

export interface UploadGuard {
  /** 파일을 풀기 전에 부른다. 올리지 않기로 하면 `UploadSkipped`를 던진다. */
  beforeDecode: (file: Blob & { name: string }) => Promise<BeforeDecode>;
  /**
   * 파일을 풀어서 소리 엔진에 올린 뒤에 부른다(그 소리까지 `usedBytes`에 들어 있어야 한다).
   * 올리지 않기로 하면 `UploadSkipped`를 던진다. 던지면 부른 쪽이 풀어 둔 소리를 내려놓는다.
   */
  afterDecode: (
    file: { name: string },
    decoded: { duration: number; sampleRate: number; channels: number },
    before: BeforeDecode,
  ) => Promise<void>;
}

async function readWav(file: Blob): Promise<WavInfo | undefined> {
  try {
    const head = new Uint8Array(await file.slice(0, WAV_HEAD_BYTES).arrayBuffer());
    return readWavInfo(head, file.size);
  } catch {
    return undefined; // 머리를 읽지 못하면 풀고 난 뒤 확인한다
  }
}

export function createUploadGuard(deps: UploadGuardDeps): UploadGuard {
  const refuse = async (fileName: string, add: number, total: number, limits: Readonly<MemoryLimits>): Promise<never> => {
    await deps.inform({
      title: ko.memory.refuse.title,
      message: ko.memory.refuse.message(fileName, formatMemory(add), formatMemory(total), formatMemory(limits.reject)),
      confirmLabel: ko.memory.refuse.ok,
    });
    throw new UploadSkipped(fileName, "refused");
  };

  const askTotal = async (fileName: string, add: number, total: number): Promise<void> => {
    const ok = await deps.ask({
      title: ko.memory.askTotal.title,
      message: ko.memory.askTotal.message(fileName, formatMemory(add), formatMemory(total)),
      confirmLabel: ko.memory.uploadAnyway,
      cancelLabel: ko.memory.skip,
    });
    if (!ok) throw new UploadSkipped(fileName, "declined");
  };

  return {
    async beforeDecode(file) {
      const limits = deps.limits();
      const wav = await readWav(file);
      if (wav) {
        const add = estimateWavDecodedBytes(wav, deps.outputRate());
        const total = deps.usedBytes() + add;
        const level = judgeTotal(total, limits);
        if (level === "reject") return refuse(file.name, add, total, limits);
        if (level === "notice") {
          await askTotal(file.name, add, total);
          return { asked: true };
        }
      }
      if (file.size > limits.fileAsk) {
        const ok = await deps.ask({
          title: ko.memory.askFile.title,
          message: ko.memory.askFile.message(file.name, formatMemory(file.size)),
          confirmLabel: ko.memory.uploadAnyway,
          cancelLabel: ko.memory.skip,
        });
        if (!ok) throw new UploadSkipped(file.name, "declined");
        return { asked: true };
      }
      return { asked: false };
    },

    async afterDecode(file, decoded, before) {
      const limits = deps.limits();
      const add = decodedBytes(decoded.duration, decoded.sampleRate, decoded.channels);
      const total = deps.usedBytes();
      const level = judgeTotal(total, limits);
      if (level === "reject") return refuse(file.name, add, total, limits);
      if (level === "notice" && !before.asked) await askTotal(file.name, add, total);
    },
  };
}
