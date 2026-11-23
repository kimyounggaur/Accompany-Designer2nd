import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useDawStore } from "../../store/useDawStore";
import { getProjectDuration } from "../../utils/audioMath";

/** 확대 · 축소 · 전체 맞춤 */
export function ZoomControls() {
  const zoomPxPerSecond = useDawStore((state) => state.zoomPxPerSecond);
  const setZoom = useDawStore((state) => state.setZoom);

  /** 프로젝트 전체가 타임라인 폭에 들어오도록 확대 배율을 정한다. */
  function fitToProject() {
    const { bpm, tracks } = useDawStore.getState();
    const duration = getProjectDuration({ bpm, tracks });
    const viewport = document.querySelector<HTMLElement>(".timeline-scroll")?.clientWidth ?? 0;
    if (duration <= 0 || viewport <= 0) return;
    setZoom((viewport - 24) / duration);
  }

  return (
    <div className="transport-group">
      <button className="icon-button" onClick={() => setZoom(zoomPxPerSecond - 16)} title="축소" type="button">
        <ZoomOut size={17} />
      </button>
      <button className="icon-button" onClick={() => setZoom(zoomPxPerSecond + 16)} title="확대" type="button">
        <ZoomIn size={17} />
      </button>
      <button className="text-button" onClick={fitToProject} title="프로젝트 전체가 보이게 맞춤" type="button">
        <Maximize2 size={16} />
        <span>맞춤</span>
      </button>
    </div>
  );
}
