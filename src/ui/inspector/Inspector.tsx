import { useMemo } from "react";
import { EffectRack } from "../../components/EffectRack";
import { LevelMeterRack } from "../../components/LevelMeter";
import { useDawStore } from "../../store/useDawStore";
import { findClip } from "../../utils/audioMath";
import { AnalyzerPanel } from "./AnalyzerPanel";
import { ClipPanel } from "./ClipPanel";
import { CompressorPanel } from "./CompressorPanel";
import { DelayPanel } from "./DelayPanel";
import { EqPanel } from "./EqPanel";
import { MasterPanel } from "./MasterPanel";
import { PanelSection } from "./PanelSection";
import { ReverbPanel } from "./ReverbPanel";
import { TrackMixPanel } from "./TrackMixPanel";

/**
 * 오른쪽 패널. 칸마다 파일이 하나씩 있고(`ClipPanel`·`TrackMixPanel`·`EqPanel`…), 여기서는 어느 트랙의 설정을 보여 줄지만 정해 차례로 놓는다.
 * 보여 줄 트랙: 선택한 클립이 있는 트랙 → 선택한 트랙 → 첫 트랙.
 */
export function Inspector() {
  const tracks = useDawStore((state) => state.tracks);
  const selectedTrackId = useDawStore((state) => state.selectedTrackId);
  const selectedClipId = useDawStore((state) => state.selectedClipId);
  const updateTrack = useDawStore((state) => state.updateTrack);

  const selection = useMemo(() => findClip(tracks, selectedClipId), [selectedClipId, tracks]);
  const track = selection?.track ?? tracks.find((candidate) => candidate.id === selectedTrackId) ?? tracks[0];

  if (!track) {
    return <aside className="inspector" data-testid="inspector" />;
  }

  return (
    <aside className="inspector" data-testid="inspector" aria-label="클립과 트랙 설정">
      <ClipPanel />
      <TrackMixPanel track={track} />
      <MasterPanel />

      <PanelSection id="meter" title="레벨 미터" className="meter-panel">
        <LevelMeterRack />
      </PanelSection>

      <PanelSection id="effect-rack" title="이펙트 랙" className="effect-rack-panel">
        <EffectRack track={track} onChange={(patch) => updateTrack(track.id, patch)} />
      </PanelSection>

      <EqPanel track={track} />
      <CompressorPanel track={track} />
      <DelayPanel track={track} />
      <ReverbPanel track={track} />
      <AnalyzerPanel />
    </aside>
  );
}
