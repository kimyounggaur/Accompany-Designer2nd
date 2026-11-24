import { useAnnounceStore } from "../state/announceStore";

/** 화면 낭독기에게만 읽어 줄 안내를 보낸다. 눈에 보이는 안내는 `notify`를 쓴다. */
export function announce(message: string): void {
  useAnnounceStore.getState().announce(message);
}
