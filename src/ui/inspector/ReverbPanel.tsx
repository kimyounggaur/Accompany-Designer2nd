import { ReverbPluginPanel } from "../../components/ReverbPluginPanel";
import { effectPatch } from "../../domain/project/effectPatch";
import type { ReverbSettings, Track } from "../../domain/types";
import { useDawStore } from "../../store/useDawStore";
import { PanelSection } from "./PanelSection";

/** 리버브 칸: 선택한 트랙의 리버브 설정을 고친다 */
export function ReverbPanel({ track }: { track: Track }) {
  const updateTrack = useDawStore((state) => state.updateTrack);

  return (
    <PanelSection id="reverb" title="리버브" className="reverb-panel">
      <ReverbPluginPanel
        reverb={track.reverb}
        onChange={(patch: Partial<ReverbSettings>) => updateTrack(track.id, effectPatch(track, "reverb", patch))}
      />
    </PanelSection>
  );
}
