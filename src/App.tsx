import { useEffect, useMemo, useRef, useState } from "react";
import { audioEngine } from "./audio/audioEngine";
import { vocalRecorder } from "./audio/recorder";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { TransportBar } from "./components/TransportBar";
import type { AudioAsset, Clip, DawProject } from "./types";
import { createId, getProjectDuration } from "./utils/audioMath";
import { useDawStore } from "./store/useDawStore";
import { exportProject, hasRememberedAudio, loadAutosave, parseProjectFile, rememberAudio, restoreAudio, saveAutosave } from "./storage/projectStorage";

async function decodeStoredAudio(blob: Blob, asset: AudioAsset): Promise<{ asset: AudioAsset; commit: () => void }> {
  // Decode without requiring an autoplay gesture during automatic recovery.
  const context = new OfflineAudioContext(1, 1, 44100);
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  return {
    asset: { ...asset, blobUrl: asset.sourceType === "recording" ? URL.createObjectURL(blob) : undefined },
    commit: () => audioEngine.registerBuffer(asset.id, buffer),
  };
}

function getProjectSnapshot(): DawProject {
  const state = useDawStore.getState();
  const audioAssets = Object.fromEntries(
    Object.entries(state.audioAssets).map(([assetId, asset]) => {
      const { blobUrl, ...serializableAsset } = asset;
      return [assetId, serializableAsset];
    }),
  );

  return {
    id: state.id,
    name: state.name,
    bpm: state.bpm,
    sampleRate: state.sampleRate,
    tracks: state.tracks,
    audioAssets,
    timeMarkers: state.timeMarkers,
  };
}

export default function App() {
  const isPlaying = useDawStore((state) => state.isPlaying);
  const tracks = useDawStore((state) => state.tracks);
  const bpm = useDawStore((state) => state.bpm);
  const setIsPlaying = useDawStore((state) => state.setIsPlaying);
  const setPlayhead = useDawStore((state) => state.setPlayhead);
  const addAudioAsset = useDawStore((state) => state.addAudioAsset);
  const updateAudioAsset = useDawStore((state) => state.updateAudioAsset);
  const addClip = useDawStore((state) => state.addClip);
  const updateClip = useDawStore((state) => state.updateClip);
  const addTrack = useDawStore((state) => state.addTrack);
  const importProject = useDawStore((state) => state.importProject);
  const deleteSelectedClips = useDawStore((state) => state.deleteSelectedClips);
  const selectedClipIds = useDawStore((state) => state.selectedClipIds);
  const undo = useDawStore((state) => state.undo);
  const redo = useDawStore((state) => state.redo);
  const setPlaylistTool = useDawStore((state) => state.setPlaylistTool);
  const quantizeSelectedClips = useDawStore((state) => state.quantizeSelectedClips);
  const zoomToSelectedClips = useDawStore((state) => state.zoomToSelectedClips);
  const setZoom = useDawStore((state) => state.setZoom);
  const zoomPxPerSecond = useDawStore((state) => state.zoomPxPerSecond);
  const commandMessage = useDawStore((state) => state.commandMessage);
  const playlistDetached = useDawStore((state) => state.playlistDetached);
  const recordingState = useDawStore((state) => state.recording);
  const setRecordingState = useDawStore((state) => state.setRecordingState);
  const resetRecordingState = useDawStore((state) => state.resetRecordingState);
  const [status, setStatus] = useState("오디오 파일을 업로드하면 첫 트랙에 클립이 생성됩니다.");
  const copiedClips = useRef<Clip[]>([]);
  useEffect(() => { if (commandMessage) setStatus(commandMessage); }, [commandMessage]);
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

  useEffect(() => {
    let cancelled = false;
    let ready = false;
    let timer: number | undefined;
    let unsaved = false;
    let pending: Promise<void> = Promise.resolve();
    const initial = getProjectSnapshot();
    const subscribe = useDawStore.subscribe((state, previous) => {
      if (!ready || state.recording.status !== "idle") return;
      if (previous.recording.status === "idle" && state.name === previous.name && state.bpm === previous.bpm && state.tracks === previous.tracks && state.audioAssets === previous.audioAssets && state.timeMarkers === previous.timeMarkers) return;
      if (timer) window.clearTimeout(timer);
      unsaved = true;
      timer = window.setTimeout(() => {
        timer = undefined;
        const project = getProjectSnapshot();
        pending = pending.catch(() => {}).then(() => saveAutosave(project)).then(() => {
          if (!timer) unsaved = false;
        }).catch(() => {
          if (!cancelled) setStatus("자동 저장에 실패했습니다. 프로젝트 파일을 따로 저장해 주세요.");
        });
      }, 1200);
    });
    const recover = async () => {
      try {
        const data = await loadAutosave();
        if (cancelled) return;
        const now = getProjectSnapshot();
        // Do not overwrite edits made while the saved session was loading.
        if (data && now.tracks === initial.tracks && now.name === initial.name && now.bpm === initial.bpm && Object.keys(now.audioAssets).length === 0) {
          const restored = await restoreAudio(data, decodeStoredAudio);
          if (cancelled) return;
          const current = getProjectSnapshot();
          if (current.tracks === initial.tracks && current.name === initial.name && current.bpm === initial.bpm && Object.keys(current.audioAssets).length === 0) {
            audioEngine.clearBuffers();
            restored.commit();
            importProject(restored.project);
            setStatus(restored.missing ? `자동 저장된 프로젝트를 복구했습니다. 음원 ${restored.missing}개를 다시 연결해 주세요.` : "자동 저장된 프로젝트와 음원을 복구했습니다.");
          }
        }
      } catch {
        if (!cancelled) setStatus("자동 저장된 작업을 복구하지 못했습니다. 프로젝트 파일을 확인해 주세요.");
      } finally { ready = true; }
    };
    void recover();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (unsaved || useDawStore.getState().recording.status !== "idle") { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { cancelled = true; subscribe(); window.removeEventListener("beforeunload", beforeUnload); if (timer) window.clearTimeout(timer); };
  }, [importProject]);

  const schedulingSignature = useMemo(
    () =>
      JSON.stringify({
        bpm,
        tracks,
      }),
    [bpm, tracks],
  );

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const tick = () => {
      const current = audioEngine.getCurrentPlayhead();
      const state = useDawStore.getState();
      const duration = getProjectDuration(state);

      if (current >= duration && state.recording.status !== "recording") {
        audioEngine.stop();
        setPlayhead(duration);
        setIsPlaying(false);
        return;
      }

      setPlayhead(current);
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
    if (!isPlaying) {
      return;
    }

    audioEngine.sync(getProjectSnapshot());
  }, [isPlaying, schedulingSignature]);

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
        void handleSaveProject();
        return;
      }
      if (hasCommandModifier && shortcutKey === "c") {
        event.preventDefault();
        const state = useDawStore.getState();
        copiedClips.current = state.tracks.flatMap(track => track.clips.filter(clip => state.selectedClipIds.includes(clip.id))).map(clip => ({ ...clip }));
        setStatus(`클립 ${copiedClips.current.length}개 복사됨`);
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
        if (copiedClips.current.length) setStatus(`클립 ${copiedClips.current.length}개 붙여넣기 완료`);
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
  }, [
    deleteSelectedClips,
    quantizeSelectedClips,
    redo,
    selectedClipIds.length,
    setPlaylistTool,
    setZoom,
    undo,
    zoomPxPerSecond,
    zoomToSelectedClips,
  ]);

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
    gain.connect(context.destination);
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
      setStatus(`${beat}박 후 녹음 시작`);
      useDawStore.getState().setCommandMessage(`${beat}박 후 녹음 시작`);
      playMetronomeClick(context, beat === totalBeats);
      await new Promise<void>((resolve) => {
        countInResolveRef.current = resolve;
        countInTimerRef.current = window.setTimeout(resolve, beatMs);
      });
      countInTimerRef.current = undefined;
      countInResolveRef.current = undefined;

      if (useDawStore.getState().recording.status !== "counting-in") {
        throw new Error("Count-in cancelled.");
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
      setStatus("녹음 카운트인이 취소되었습니다.");
      useDawStore.getState().setCommandMessage("녹음 카운트인이 취소되었습니다.");
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
      setStatus(`${fileName} 녹음 중...`);
      useDawStore.getState().setCommandMessage(`${fileName} 녹음 중...`);
    } catch (error) {
      clearRecordingTimers();
      vocalRecorder.cancel();
      recordingRef.current = undefined;
      resetRecordingState();
      if ((error as Error).message === "Count-in cancelled.") {
        setStatus("녹음 카운트인이 취소되었습니다.");
        useDawStore.getState().setCommandMessage("녹음 카운트인이 취소되었습니다.");
      } else {
        setStatus(`녹음 시작 실패: ${(error as Error).message}`);
        useDawStore
          .getState()
          .setCommandMessage(`녹음 시작 실패: ${(error as Error).message}`);
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
      setStatus(`${session.fileName} 저장 중...`);
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
      setStatus(`${asset.fileName} 녹음 완료`);
      useDawStore.getState().setCommandMessage(`${asset.fileName} 녹음 완료`);
    } catch (error) {
      updateClip(session.clipId, { isRecording: false }, { history: false });
      setStatus(`녹음 저장 실패: ${(error as Error).message}`);
      useDawStore
        .getState()
        .setCommandMessage(`녹음 저장 실패: ${(error as Error).message}`);
    } finally {
      clearRecordingTimers();
      recordingRef.current = undefined;
      resetRecordingState();
    }
  }

  async function handleFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (!fileArray.length) return;

    setStatus(`${fileArray.length}개 파일 디코딩 중...`);

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
          setStatus(`${file.name} 음원을 기존 클립에 다시 연결했습니다.`);
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
        setStatus(
          fileArray.length > 1
            ? `(${i + 1}/${fileArray.length}) ${asset.fileName} 완료`
            : `${asset.fileName} 업로드 완료`,
        );
      } catch (error) {
        setStatus(`${file.name} 디코딩 실패: ${(error as Error).message}`);
      }
    }

    if (fileArray.length > 1) {
      setStatus(`${fileArray.length}개 파일 업로드 완료`);
    }
  }

  async function handleSaveProject() {
    try {
      const project = getProjectSnapshot();
      const blob = await exportProject(project);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project.name.replace(/[\\/:*?"<>|\s]+/g, "-").toLowerCase() || "project"}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("음원을 포함한 프로젝트 파일을 저장했습니다.");
    } catch (error) {
      setStatus(`프로젝트 저장 실패: ${(error as Error).message}`);
    }
  }

  async function handleExportMix() {
    try {
      setStatus("믹스 WAV를 만드는 중입니다...");
      const project = getProjectSnapshot();
      const blob = await audioEngine.renderMix(project);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project.name.replace(/[\\/:*?"<>|\s]+/g, "-") || "project"}-mix.wav`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("믹스 WAV 파일을 저장했습니다.");
    } catch (error) {
      setStatus(`믹스 저장 실패: ${(error as Error).message}`);
    }
  }

  async function handleLoadProject(file: File) {
    try {
      const data = await parseProjectFile(file);
      if (!window.confirm("현재 프로젝트를 불러온 내용으로 바꾸시겠습니까? 현재 작업은 먼저 파일로 저장할 수 있습니다.")) return;
      const restored = await restoreAudio(data, decodeStoredAudio);
      audioEngine.stop();
      audioEngine.clearBuffers();
      restored.commit();
      importProject(restored.project);
      setStatus(restored.missing ? `프로젝트를 불러왔습니다. 음원 ${restored.missing}개가 파일에 포함되지 않았습니다.` : "프로젝트와 음원을 불러왔습니다.");
    } catch (error) {
      setStatus(`프로젝트 불러오기 실패: ${(error as Error).message}`);
    }
  }

  return (
    <main className="app-shell">
      <TransportBar
        isRecording={isRecording}
        status={status}
        onFiles={handleFiles}
        onLoadProject={handleLoadProject}
        onPlayPause={handlePlayPause}
        onRecordToggle={handleRecordToggle}
        onSaveProject={handleSaveProject}
        onExportMix={handleExportMix}
        onStop={handleStop}
      />
      <div className={`workspace ${playlistDetached ? "detached" : ""}`}>
        <Timeline />
        <Inspector />
      </div>
    </main>
  );
}
