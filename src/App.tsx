import { useEffect, useRef } from "react";
import { audioEngine } from "./audio/currentEngine";
import { vocalRecorder } from "./audio/recorder";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { AppShell } from "./app/AppShell";
import { quantizeSelectedClips, redo, undo, zoomToSelectedClips, deleteSelectedClips } from "./app/actions";
import { startApp } from "./app/bootstrap";
import { decodeStoredAudio, saveProjectFile } from "./app/projectFile";
import { getProjectSnapshot } from "./app/projectSnapshot";
import { ko } from "./i18n/ko";
import { confirmAction } from "./services/confirm";
import { CountInCancelledError, isCountInCancelled } from "./services/errors";
import { notify, notifyError } from "./services/notify";
import { useDialogStore } from "./state/dialogStore";
import { TopBar } from "./ui/transport/TopBar";
import type { AudioAsset, Clip } from "./types";
import { createId, getProjectDuration } from "./utils/audioMath";
import { useDawStore } from "./store/useDawStore";
import { hasRememberedAudio, parseProjectFile, rememberAudio, restoreAudio } from "./storage/projectStorage";

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
  const recordingState = useDawStore((state) => state.recording);
  const setRecordingState = useDawStore((state) => state.setRecordingState);
  const resetRecordingState = useDawStore((state) => state.resetRecordingState);
  const copiedClips = useRef<Clip[]>([]);
  const isRecording =
    recordingState.status === "counting-in" ||
    recordingState.status === "recording" ||
    recordingState.status === "stopping";
  const animationRef = useRef<number | undefined>(undefined);
  const countInTimerRef = useRef<number | undefined>(undefined);
  const countInResolveRef = useRef<(() => void) | undefined>(undefined);
  const metronomeTimerRef = useRef<number | undefined>(undefined);
  const recordingRef = useRef<
    | {
        assetId: string;
        clipId: string;
        fileName: string;
        startTime: number;
        trackId: string;
      }
    | undefined
  >(undefined);

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
      if (current >= audioEngine.getPlaybackEnd(state) && state.recording.status !== "recording") {
        audioEngine.stop();
        setPlayhead(duration);
        setIsPlaying(false);
        return;
      }

      setPlayhead(state.recording.status === "recording" ? current : Math.min(current, duration));
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

      // 확인창이 열려 있는 동안에는 뒤의 화면을 건드리는 단축키(삭제·재생 등)를 막는다.
      if (useDialogStore.getState().confirm) {
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
      clearRecordingTimers();
      vocalRecorder.cancel();
      audioEngine.stop();
    };
  }, []);

  function clearRecordingTimers() {
    if (countInTimerRef.current) {
      window.clearTimeout(countInTimerRef.current);
      countInTimerRef.current = undefined;
    }
    countInResolveRef.current?.();
    countInResolveRef.current = undefined;

    if (metronomeTimerRef.current) {
      window.clearInterval(metronomeTimerRef.current);
      metronomeTimerRef.current = undefined;
    }
  }

  function playMetronomeClick(context: AudioContext, strong = false, at = context.currentTime) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = at;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(strong ? 1320 : 880, now);
    gain.gain.setValueAtTime(strong ? 0.18 : 0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    oscillator.connect(gain);
    // 메트로놈은 모니터 길로 보낸다(마스터 길·미터·내보내기에 섞이지 않고, 모니터 볼륨을 따른다).
    gain.connect(audioEngine.getMonitorInput() ?? context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.06);
  }

  function startRecordingMetronome(context: AudioContext) {
    const state = useDawStore.getState();
    if (!state.recording.metronomeEnabled) {
      return;
    }

    const beatSeconds = 60 / state.bpm;
    let beatIndex = 0;
    let nextBeat = context.currentTime;
    metronomeTimerRef.current = window.setInterval(() => {
      while (nextBeat < context.currentTime + 0.1) {
        playMetronomeClick(context, beatIndex % 4 === 0, nextBeat);
        nextBeat += beatSeconds;
        beatIndex += 1;
      }
    }, 25);
  }

  async function runCountIn(context: AudioContext) {
    const { recording, bpm } = useDawStore.getState();
    const totalBeats = recording.countInBeats;

    if (totalBeats <= 0) {
      return;
    }

    const beatMs = Math.max(80, (60 / bpm) * 1000);
    setRecordingState({
      status: "counting-in",
      countInRemaining: totalBeats,
      elapsed: 0,
      waveformPeaks: [],
    });

    for (let beat = totalBeats; beat > 0; beat -= 1) {
      setRecordingState({
        status: "counting-in",
        countInRemaining: beat,
      });
      notify("info", ko.notice.countInStarted(beat));
      playMetronomeClick(context, beat === totalBeats);
      await new Promise<void>((resolve) => {
        countInResolveRef.current = resolve;
        countInTimerRef.current = window.setTimeout(resolve, beatMs);
      });
      countInTimerRef.current = undefined;
      countInResolveRef.current = undefined;

      if (useDawStore.getState().recording.status !== "counting-in") {
        throw new CountInCancelledError();
      }
    }

    countInTimerRef.current = undefined;
  }

  async function handlePlayPause() {
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
    if (useDawStore.getState().recording.status === "counting-in") {
      clearRecordingTimers();
      resetRecordingState();
    } else if (recordingRef.current) {
      void stopRecording();
    }
    audioEngine.stop();
    setPlayhead(0);
    setIsPlaying(false);
  }

  async function handleRecordToggle() {
    if (recordingState.status === "counting-in") {
      clearRecordingTimers();
      resetRecordingState();
      notify("info", ko.notice.countInCancelled);
      return;
    }

    if (recordingRef.current || vocalRecorder.isRecording()) {
      await stopRecording();
      return;
    }

    await startRecording();
  }

  async function startRecording() {
    try {
      const context = await audioEngine.ensureContext();
      await runCountIn(context);
      const state = useDawStore.getState();
      const armedTrack = state.tracks.find(
        (track) => track.id === state.recording.armedTrackId,
      );
      let targetTrack = armedTrack ?? state.tracks.find(track => track.clips.length === 0);

      if (!targetTrack) {
        addTrack();
        targetTrack = useDawStore.getState().tracks.at(-1);
      }

      if (!targetTrack) {
        throw new Error("녹음할 트랙이 없습니다.");
      }

      const recordingIndex =
        Object.values(state.audioAssets).filter(
          (asset) => asset.sourceType === "recording",
        ).length + 1;
      const fileName = `녹음 ${String(recordingIndex).padStart(3, "0")}.wav`;
      const assetId = createId("asset");
      const clipId = createId("clip");
      const startTime = state.playhead;

      await vocalRecorder.start(
        context,
        {
          onPeaks: (waveformPeaks, elapsed) => {
            const session = recordingRef.current;
            if (!session) {
              return;
            }

            const duration = Math.max(0.05, elapsed);
            updateAudioAsset(session.assetId, {
              duration,
              waveformPeaks,
            }, { history: false });
            updateClip(session.clipId, { duration }, { history: false });
            setRecordingState({
              elapsed: duration,
              waveformPeaks,
            });

            if (!useDawStore.getState().isPlaying) {
              setPlayhead(session.startTime + elapsed);
            }
          },
        },
        {
          inputDeviceId: state.recording.inputDeviceId,
          monitoringEnabled: state.recording.monitoringEnabled,
          monitorOutput: audioEngine.getMonitorInput(),
        },
      );

      const tempAsset: AudioAsset = {
        id: assetId,
        fileName,
        duration: 0.05,
        sampleRate: context.sampleRate,
        channels: 1,
        waveformPeaks: [0],
        sourceType: "recording",
      };
      const clip: Clip = {
        id: clipId,
        audioBufferId: assetId,
        name: fileName,
        trackId: targetTrack.id,
        startTime,
        offset: 0,
        duration: 0.05,
        sourceBpm: state.bpm,
        stretchMode: "none",
        gain: 1,
        fadeIn: 0,
        fadeOut: 0,
        fadeCurve: "equalPower",
        muted: false,
        isRecording: true,
      };

      recordingRef.current = {
        assetId,
        clipId,
        fileName,
        startTime,
        trackId: targetTrack.id,
      };
      if (!useDawStore.getState().isPlaying) {
        await audioEngine.play(getProjectSnapshot(), startTime);
        setIsPlaying(true);
      }
      startRecordingMetronome(context);
      addAudioAsset(tempAsset);
      addClip(targetTrack.id, clip);
      setRecordingState({
        status: "recording",
        trackId: targetTrack.id,
        clipId,
        startedAtProjectTime: startTime,
        elapsed: 0,
        inputDeviceId: state.recording.inputDeviceId,
        countInRemaining: 0,
        waveformPeaks: [],
      });
      notify("info", ko.notice.recordingNow(fileName));
    } catch (error) {
      clearRecordingTimers();
      vocalRecorder.cancel();
      recordingRef.current = undefined;
      resetRecordingState();
      if (isCountInCancelled(error)) {
        notify("info", ko.notice.countInCancelled);
      } else {
        notifyError(error, { kind: "microphone", title: ko.failed.recordStart });
      }
    }
  }

  async function stopRecording() {
    const session = recordingRef.current;
    if (!session) {
      return;
    }

    try {
      setRecordingState({ status: "stopping" });
      notify("info", ko.notice.recordingSaving(session.fileName));
      const result = vocalRecorder.stop();
      const { asset } = await audioEngine.decodeBlob(
        result.blob,
        session.fileName,
        session.assetId,
        "recording",
      );

      rememberAudio(session.assetId, result.blob);
      updateAudioAsset(session.assetId, {
        ...asset,
        duration: asset.duration || result.duration,
        waveformPeaks: asset.waveformPeaks.length
          ? asset.waveformPeaks
          : result.peaks,
      }, { history: false });
      updateClip(session.clipId, {
        audioBufferId: asset.id,
        duration: asset.duration || result.duration,
        isRecording: false,
        name: asset.fileName,
        stretchMode: "none",
      }, { history: false });
      notify("success", ko.notice.recordingDone(asset.fileName));
    } catch (error) {
      updateClip(session.clipId, { isRecording: false }, { history: false });
      notifyError(error, { kind: "generic", title: ko.failed.recordSave });
    } finally {
      clearRecordingTimers();
      recordingRef.current = undefined;
      resetRecordingState();
    }
  }

  async function handleFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (!fileArray.length) return;

    notify("info", ko.notice.decoding(fileArray.length));
    let uploaded = 0;

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      try {
        const { asset } = await audioEngine.decodeFile(file);
        rememberAudio(asset.id, file);

        const state = useDawStore.getState();
        const missingAsset = Object.values(state.audioAssets).find((existing) =>
          !hasRememberedAudio(existing.id) && existing.fileName === file.name && Math.abs(existing.duration - asset.duration) < 0.25,
        );
        if (missingAsset) {
          const buffer = audioEngine.getBuffer(asset.id);
          if (buffer) audioEngine.registerBuffer(missingAsset.id, buffer);
          rememberAudio(missingAsset.id, file);
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

  async function handleExportMix() {
    try {
      notify("info", ko.notice.mixRendering);
      const project = getProjectSnapshot();
      const blob = await audioEngine.renderMix(project);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project.name.replace(/[\\/:*?"<>|\s]+/g, "-") || "project"}-mix.wav`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("success", ko.notice.mixSaved);
    } catch (error) {
      notifyError(error, { kind: "generic", title: ko.failed.mixSave });
    }
  }

  async function handleLoadProject(file: File) {
    try {
      const data = await parseProjectFile(file);
      const confirmed = await confirmAction({
        title: ko.confirm.loadProject.title,
        message: ko.confirm.loadProject.message,
        confirmLabel: ko.confirm.loadProject.confirmLabel,
        tone: "danger",
      });
      if (!confirmed) return;
      const restored = await restoreAudio(data, decodeStoredAudio);
      audioEngine.stop();
      audioEngine.clearBuffers();
      restored.commit();
      importProject(restored.project);
      if (restored.missing) notify("warning", ko.notice.projectLoadedMissing(restored.missing));
      else notify("success", ko.notice.projectLoaded);
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
          onExportMix={handleExportMix}
          onStop={handleStop}
        />
      }
      timeline={<Timeline />}
      inspector={<Inspector />}
    />
  );
}
