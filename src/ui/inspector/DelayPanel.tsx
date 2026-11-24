import { DelayPluginPanel } from "../../components/DelayPluginPanel";
import { effectPatch } from "../../domain/project/effectPatch";
import type { DelaySettings, Track } from "../../domain/types";
import { useDawStore } from "../../store/useDawStore";
import { PanelSection } from "./PanelSection";

/** 딜레이 칸: 선택한 트랙의 딜레이 설정을 고친다(곡 빠르기에 맞추는 값 계산을 위해 bpm을 넘긴다) */
export function DelayPanel({ track }: { track: Track }) {
  const updateTrack = useDawStore((state) => state.updateTrack);
  const bpm = useDawStore((state) => state.bpm);

  return (
    <PanelSection id="delay" title="딜레이" className="delay-panel">
      <DelayPluginPanel
        bpm={bpm}
        delay={track.delay}
        onChange={(patch: Partial<DelaySettings>) => updateTrack(track.id, effectPatch(track, "delay", patch))}
      />
    </PanelSection>
  );
}
