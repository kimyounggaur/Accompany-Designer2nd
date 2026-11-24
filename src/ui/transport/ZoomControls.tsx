import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { zoomIn, zoomOut, zoomToFit } from "../../app/actions";
import { ariaKeys, keyLabel } from "../../services/shortcuts";

/** 확대 · 축소 · 전체 보기. 단추에 적는 키는 단축키 표(services/shortcuts.ts)에서 읽는다. */
export function ZoomControls() {
  return (
    <div className="transport-group">
      <button aria-keyshortcuts={ariaKeys("zoomOut")} className="icon-button" onClick={zoomOut} title="축소" type="button">
        <ZoomOut size={17} />
      </button>
      <button aria-keyshortcuts={ariaKeys("zoomIn")} className="icon-button" onClick={zoomIn} title="확대" type="button">
        <ZoomIn size={17} />
      </button>
      <button
        aria-keyshortcuts={ariaKeys("zoomFit")}
        className="text-button"
        data-testid="zoom-fit"
        onClick={zoomToFit}
        title={`프로젝트 전체가 보이게 줄이기 (${keyLabel("zoomFit")})`}
        type="button"
      >
        <Maximize2 size={16} />
        <span>전체 보기</span>
      </button>
    </div>
  );
}
