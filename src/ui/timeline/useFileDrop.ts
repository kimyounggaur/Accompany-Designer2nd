import type { DragEvent, RefObject } from "react";
import { useCallback, useEffect, useState } from "react";
import { dropPlacementAt, type DropPlacement } from "../../domain/timeline/drop";
import { useDawStore } from "../../store/useDawStore";

/** 끌고 있는 것에 파일이 들어 있는가(끌기 중에는 파일 내용은 못 보지만 종류 목록은 볼 수 있다) */
function carriesFiles(event: { dataTransfer: DataTransfer | null }): boolean {
  return event.dataTransfer !== null && Array.from(event.dataTransfer.types).includes("Files");
}

interface FileDropOptions {
  /** 눈금 영역(`.lanes`): 놓은 자리를 이 상자 기준 좌표로 바꾼다(가로 스크롤은 상자 위치에 이미 반영되어 있다) */
  lanesRef: RefObject<HTMLElement | null>;
  trackHeight: number;
  /** 파일을 놓았을 때: 놓은 파일들과 놓일 자리 */
  onFiles: (files: File[], placement: DropPlacement) => void;
}

/**
 * 타임라인에 파일을 끌어다 놓는 동작(P5-5). 끄는 동안 놓일 자리(`hint`)를 알려 주고, 놓으면 `onFiles`에 파일과 자리를 넘긴다.
 * 놓일 자리는 순수 계산(`domain/timeline/drop`)이 정하고, 여기는 이벤트를 좌표로 바꾸는 일만 한다.
 *
 * 앱의 다른 곳에 파일을 놓아도 브라우저가 그 파일을 열어 이 화면을 떠나 버리지 않도록, 창 전체에서 파일 끌기·놓기의 기본 동작을 막는다.
 */
export function useFileDrop({ lanesRef, trackHeight, onFiles }: FileDropOptions) {
  const [hint, setHint] = useState<DropPlacement | undefined>();

  useEffect(() => {
    const guard = (event: Event) => {
      const drag = event as globalThis.DragEvent;
      if (!carriesFiles(drag) || drag.defaultPrevented) return; // 타임라인이 이미 받았다
      drag.preventDefault();
      if (drag.dataTransfer) drag.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);

  const placementOf = useCallback(
    (event: DragEvent): DropPlacement | undefined => {
      const rect = lanesRef.current?.getBoundingClientRect();
      if (!rect) return undefined;
      const state = useDawStore.getState();
      return dropPlacementAt(event.clientX - rect.left, event.clientY - rect.top, {
        zoomPxPerSecond: state.zoomPxPerSecond,
        trackHeight,
        trackCount: state.tracks.length,
        bpm: state.bpm,
        snap: state.snapEnabled && !event.altKey,
        gridDivision: state.gridDivision,
      });
    },
    [lanesRef, trackHeight],
  );

  const onDragOver = useCallback(
    (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      const next = placementOf(event);
      // 마우스가 같은 자리에 머무는 동안은(끌기 이벤트가 계속 온다) 다시 그리지 않는다.
      setHint((current) => (current && next && current.row === next.row && current.time === next.time ? current : next));
    },
    [placementOf],
  );

  const onDragLeave = useCallback((event: DragEvent) => {
    // 안쪽 요소로 옮겨 가는 것은 떠난 것이 아니다.
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setHint(undefined);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setHint(undefined);
      const files = Array.from(event.dataTransfer.files);
      const placement = placementOf(event);
      if (files.length && placement) onFiles(files, placement);
    },
    [onFiles, placementOf],
  );

  return { hint, dragHandlers: { onDragOver, onDragLeave, onDrop } };
}
