import { useEffect, useRef } from "react";
import { audioEngine } from "./audio/currentEngine";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { AppShell } from "./app/AppShell";
import { quantizeSelectedClips, redo, undo, zoomToSelectedClips, deleteSelectedClips } from "./app/actions";
import { startApp } from "./app/bootstrap";
import { decodeStoredAudio, saveProjectFile } from "./app/projectFile";
import { getProjectSnapshot } from "./app/projectSnapshot";
import { openExportDialog, resetExport } from "./app/exporting";
import { cancelRecording, disposeRecording, stopRecording, toggleRecording } from "./app/recording";
import { countFixed } from "./domain/project/issues";
import { ko } from "./i18n/ko";
import { confirmAction } from "./services/confirm";
import { notify, notifyError } from "./services/notify";
import { setPeaks } from "./services/peaksCache";
import { hasRememberedAudio, rememberAudio } from "./services/persistence/audioBlobs";
import { readProjectFile, restoreAudio } from "./services/persistence/projectFile";
import { useDialogStore } from "./state/dialogStore";
import { isExportOpen } from "./state/exportStore";
import { isRecordingBusy, useRecordingStore } from "./state/recordingStore";
import { TopBar } from "./ui/transport/TopBar";
import type { Clip } from "./domain/types";
import { createId, getProjectDuration } from "./utils/audioMath";
import { useDawStore } from "./store/useDawStore";

export default function App() {
  const isPlaying = useDawStore((state) => state.isPlaying);
  const setIsPlaying = useDawStore((state) => state.setIsPlaying);
  const setPlayhead = useDawStore((state) => state.setPlayhead);
  const addAudioAsset = useDawStore((state) => state.addAudioAsset);
  const updateAudioAsset = useDawStore((state) => state.updateAudioAsset);
  const addClip = useDawStore((state) => state.addClip);
  const updateClip = useDawStore((state) => state.updateClip);
  const addTrack = useDawStore((state) => state.addTrack);
  const importProject = useDawStore((state) => state.importProject);
  const selectedClipIds = useDawStore((state) => state.selectedClipIds);
  const setPlaylistTool = useDawStore((state) => state.setPlaylistTool);
  const setZoom = useDawStore((state) => state.setZoom);
  const zoomPxPerSecond = useDawStore((state) => state.zoomPxPerSecond);
  const copiedClips = useRef<Clip[]>([]);
  const isRecording = useRecordingStore((state) => state.status !== "idle");
  const animationRef = useRef<number | undefined>(undefined);

  // 자동 저장 시작과 저장된 프로젝트 복구는 app/bootstrap.ts가 맡는다.
  useEffect(() => startApp(), []);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const tick = () => {
      const current = audioEngine.getCurrentPlayhead();
      const state = useDawStore.getState();
      const duration = getProjectDuration(state);

      // 이펙트 꼬리가 남은 동안에는 소리를 이어 가되, 화면의 재생 위치는 곡 끝에서 멈춘다.
      if (current >= audioEngine.getPlaybackEnd(state) && !isRecordingBusy()) {
        audioEngine.stop();
        setPlayhead(duration);
        setIsPlaying(false);
        return;
      }

      setPlayhead(isRecordingBusy() ? current : Math.min(current, duration));
      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, setIsPlaying, setPlayhead]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        (target?.tagName === "INPUT" && (target as HTMLInputElement).type !== "range") ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      if (isTyping) {
        return;
      }

      // 확인창·내보내기 대화상자가 열려 있는 동안에는 뒤의 화면을 건드리는 단축키(삭제·재생 등)를 막는다.
      if (useDialogStore.getState().confirm || isExportOpen()) {
        return;
      }

      const hasCommandModifier = event.ctrlKey || event.metaKey;
      const shortcutKey = event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();

      if (hasCommandModifier && shortcutKey === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (hasCommandModifier && shortcutKey === "y") {
        event.preventDefault();
        redo();
        return;
      }

      if (hasCommandModifier && shortcutKey === "s") {
        event.preventDefault();
        void saveProjectFile();
        return;
      }
      if (hasCommandModifier && shortcutKey === "c") {
        event.preventDefault();
        const state = useDawStore.getState();
        copiedClips.current = state.tracks.flatMap(track => track.clips.filter(clip => state.selectedClipIds.includes(clip.id))).map(clip => ({ ...clip }));
        notify("info", copiedClips.current.length ? ko.notice.clipsCopied(copiedClips.current.length) : ko.notice.copyNeedsSelection);
        return;
      }
      if (hasCommandModifier && shortcutKey === "v") {
        event.preventDefault();
        const state = useDawStore.getState();
        const first = Math.min(...copiedClips.current.map(clip => clip.startTime));
        for (const clip of copiedClips.current) {
          if (state.tracks.some(track => track.id === clip.trackId))
            state.addClip(clip.trackId, { ...clip, id: createId("clip"), startTime: state.playhead + clip.startTime - first });
        }
        notify("info", copiedClips.current.length ? ko.notice.clipsPasted(copiedClips.current.length) : ko.notice.pasteNeedsCopy);
        return;
      }
      if (hasCommandModifier || event.altKey && shortcutKey !== "q") return;

      if (event.altKey && event.key.toLowerCase() === "q") {
        event.preventDefault();
        quantizeSelectedClips();
        return;
      }

      if (event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        zoomToSelectedClips();
        return;
      }

      if (event.shiftKey && ["Digit1", "Digit2", "Digit3"].includes(event.code)) {
        event.preventDefault();
        setZoom(event.code === "Digit1" ? 72 : event.code === "Digit2" ? 132 : 220);
        return;
      }

      if (event.shiftKey && event.code === "Digit4") {
        event.preventDefault();
        setZoom(72);
        return;
      }

      if (event.shiftKey && event.code === "Digit5") {
        event.preventDefault();
        zoomToSelectedClips();
        return;
      }

      if (event.key === "PageUp") {
        event.preventDefault();
        setZoom(zoomPxPerSecond + 16);
        return;
      }

      if (event.key === "PageDown") {
        event.preventDefault();
        setZoom(zoomPxPerSecond - 16);
        return;
      }

      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedClipIds.length
      ) {
        deleteSelectedClips();
        return;
      }

      const shortcut = shortcutKey;
      if (shortcut === "v") {
        setPlaylistTool("move");
      } else if (shortcut === "p") {
        setPlaylistTool("draw");
      } else if (shortcut === "b") {
        setPlaylistTool("paint");
      } else if (shortcut === "d") {
        setPlaylistTool("delete");
      } else if (shortcut === "t") {
        setPlaylistTool("mute");
      } else if (shortcut === "s") {
        setPlaylistTool("slip");
      } else if (shortcut === "c") {
        setPlaylistTool("slice");
      } else if (shortcut === "e") {
        setPlaylistTool("select");
      } else if (shortcut === "z") {
        setPlaylistTool("zoom");
      } else if (shortcut === "y") {
        setPlaylistTool("play-selected");
      }

      if (event.code === "Space") {
        event.preventDefault();
        void handlePlayPause();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedClipIds.length, setPlaylistTool, setZoom, zoomPxPerSecond]);

  useEffect(() => {
    const onPlayFrom = (event: Event) => {
      // 녹음하는 동안에는 재생 위치를 옮기지 않는다.
      if (isRecordingBusy()) return;
      const startAt = Math.max(
        0,
        Number((event as CustomEvent<number>).detail) || 0,
      );
      const state = useDawStore.getState();

      state.setPlayhead(startAt);
      void audioEngine.play(getProjectSnapshot(), startAt).then(() => {
        state.setIsPlaying(true);
      });
    };

    window.addEventListener("playlist-play-from", onPlayFrom);
    return () => window.removeEventListener("playlist-play-from", onPlayFrom);
  }, []);

  useEffect(() => {
    return () => {
      resetExport();
      disposeRecording();
      audioEngine.stop();
    };
  }, []);

  async function handlePlayPause() {
    // 녹음하는 동안 재생 단추와 스페이스는 녹음을 멈춘다(녹음이 도는데 재생만 멈추면 소리가 어긋난다).
    if (isRecordingBusy()) {
      await stopRecording();
      return;
    }
    const state = useDawStore.getState();

    if (state.isPlaying) {
      const pausedAt = audioEngine.getCurrentPlayhead();
      audioEngine.stop();
      state.setPlayhead(pausedAt);
      state.setIsPlaying(false);
      return;
    }

    const duration = getProjectDuration(state);
    const startAt = state.playhead >= duration ? 0 : state.playhead;
    state.setPlayhead(startAt);
    await audioEngine.play(getProjectSnapshot(), startAt);
    state.setIsPlaying(true);
  }

  function handleStop() {
    // 녹음 중이면 녹음도 끝낸다(준비·카운트인 중이면 취소). 재생 위치는 처음으로 돌아간다.
    if (isRecordingBusy()) void stopRecording();
    audioEngine.stop();
    setPlayhead(0);
    setIsPlaying(false);
  }

  function handleRecordToggle() {
    void toggleRecording();
  }

  async function handleFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (!fileArray.length) return;

    notify("info", ko.notice.decoding(fileArray.length));
    let uploaded = 0;

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      try {
        const { asset, peaks } = await audioEngine.decodeFile(file);

        const state = useDawStore.getState();
        const missingAsset = Object.values(state.assets).find((existing) =>
          !hasRememberedAudio(existing.id) && existing.fileName === file.name && Math.abs(existing.duration - asset.duration) < 0.25,
        );
        if (missingAsset) {
          const buffer = audioEngine.getBuffer(asset.id);
          if (buffer) audioEngine.registerBuffer(missingAsset.id, buffer);
          rememberAudio(missingAsset.id, file);
          setPeaks(missingAsset.id, peaks);
          updateAudioAsset(missingAsset.id, { ...asset, id: missingAsset.id }, { history: false });
          notify("success", ko.notice.relinked(file.name));
          uploaded += 1;
          continue;
        }
        const startTime = state.playhead;
        const selected = state.tracks.find((track) => track.id === state.selectedTrackId);
        let targetTrack = selected ?? state.tracks[0];
        const overlaps = (track: typeof targetTrack) => track.clips.some((clip) =>
          clip.startTime < startTime + asset.duration && clip.startTime + clip.duration > startTime,
        );
        if (!targetTrack || overlaps(targetTrack)) {
          addTrack();
          const allTracks = useDawStore.getState().tracks;
          targetTrack = allTracks[allTracks.length - 1];
        }

        const clip: Clip = {
          id: createId("clip"),
          audioBufferId: asset.id,
          name: asset.fileName,
          trackId: targetTrack.id,
          startTime,
          offset: 0,
          duration: asset.duration,
          sourceBpm: state.bpm,
          stretchMode: "none",
          gain: 1,
          fadeIn: 0,
          fadeOut: 0,
          fadeCurve: "equalPower",
          muted: false,
        };

        rememberAudio(asset.id, file);
        setPeaks(asset.id, peaks);
        addAudioAsset(asset);
        addClip(targetTrack.id, clip);
        uploaded += 1;
        if (fileArray.length > 1) notify("info", ko.notice.uploadProgress(i + 1, fileArray.length, asset.fileName));
        else notify("success", ko.notice.uploadDone(asset.fileName));
      } catch (error) {
        notifyError(error, { kind: "decode", title: ko.failed.decode(file.name), fileName: file.name });
      }
    }

    if (fileArray.length > 1) {
      if (uploaded === fileArray.length) notify("success", ko.notice.uploadAllDone(fileArray.length));
      else if (uploaded > 0) notify("warning", ko.notice.uploadPartial(fileArray.length, uploaded));
    }
  }

  async function handleLoadProject(file: File) {
    try {
      const loaded = await readProjectFile(file);
      const confirmed = await confirmAction({
        title: ko.confirm.loadProject.title,
        message: ko.confirm.loadProject.message,
        confirmLabel: ko.confirm.loadProject.confirmLabel,
        tone: "danger",
      });
      if (!confirmed) return;
      const restored = await restoreAudio(loaded, decodeStoredAudio);
      cancelRecording();
      audioEngine.stop();
      audioEngine.clearBuffers();
      restored.commit();
      importProject(restored.doc);
      if (restored.missing) notify("warning", ko.notice.projectLoadedMissing(restored.missing));
      else notify("success", ko.notice.projectLoaded);
      const fixed = countFixed(loaded.issues);
      if (fixed) notify("info", ko.notice.valuesFixed(fixed));
    } catch (error) {
      notifyError(error, { kind: "projectFile", title: ko.failed.projectLoad });
    }
  }

  return (
    <AppShell
      topBar={
        <TopBar
          isRecording={isRecording}
          onFiles={handleFiles}
          onLoadProject={handleLoadProject}
          onPlayPause={handlePlayPause}
          onRecordToggle={handleRecordToggle}
          onSaveProject={saveProjectFile}
          onExportMix={openExportDialog}
          onStop={handleStop}
        />
      }
      timeline={<Timeline />}
      inspector={<Inspector />}
    />
  );
}
