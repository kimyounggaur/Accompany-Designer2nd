import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { zoomToFit } from "../../app/actions";
import { useDawStore } from "../../store/useDawStore";

/** 확대 · 축소 · 전체 보기 */
export function ZoomControls() {
  const zoomPxPerSecond = useDawStore((state) => state.zoomPxPerSecond);
  const setZoom = useDawStore((state) => state.setZoom);

  return (
    <div className="transport-group">
      <button className="icon-button" onClick={() => setZoom(zoomPxPerSecond - 16)} title="축소" type="button">
        <ZoomOut size={17} />
      </button>
      <button className="icon-button" onClick={() => setZoom(zoomPxPerSecond + 16)} title="확대" type="button">
        <ZoomIn size={17} />
      </button>
      <button
        aria-keyshortcuts="Shift+0"
        className="text-button"
        data-testid="zoom-fit"
        onClick={zoomToFit}
        title="프로젝트 전체가 보이게 줄이기 (시프트+0)"
        type="button"
      >
        <Maximize2 size={16} />
        <span>전체 보기</span>
      </button>
    </div>
  );
}
