import { useEffect, useMemo, useRef, useState } from "react";
import { audioEngine } from "./audio/audioEngine";
import { vocalRecorder } from "./audio/recorder";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { TransportBar } from "./components/TransportBar";
import type { AudioAsset, Clip, DawProject } from "./types";
import { createId, findClip, getProjectDuration } from "./utils/audioMath";
import { useDawStore } from "./store/useDawStore";

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

    const state = useDawStore.getState();
    const duration = getProjectDuration(state);

    const tick = () => {
      const current = audioEngine.getCurrentPlayhead();

      if (current >= duration) {
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

    const restart = async () => {
      const playhead = audioEngine.getCurrentPlayhead();
      await audioEngine.play(getProjectSnapshot(), playhead);
    };

    void restart();
  }, [isPlaying, schedulingSignature]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (isTyping) {
        return;
      }

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

      if (event.shiftKey && ["1", "2", "3"].includes(event.key)) {
        event.preventDefault();
        setZoom(event.key === "1" ? 72 : event.key === "2" ? 132 : 220);
        return;
      }

      if (event.shiftKey && event.key === "4") {
        event.preventDefault();
        setZoom(72);
        return;
      }

      if (event.shiftKey && event.key === "5") {
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

      const shortcut = event.key.toLowerCase();
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
    selectedClipIds.length,
    setPlaylistTool,
    setZoom,
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

  function playMetronomeClick(context: AudioContext, strong = false) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;

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

    const beatMs = Math.max(80, (60 / state.bpm) * 1000);
    let beatIndex = 0;
    playMetronomeClick(context, true);
    metronomeTimerRef.current = window.setInterval(() => {
      beatIndex += 1;
      playMetronomeClick(context, beatIndex % 4 === 0);
    }, beatMs);
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
      setStatus(`Recording starts in ${beat}...`);
      useDawStore.getState().setCommandMessage(`Recording starts in ${beat}...`);
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

    await audioEngine.play(getProjectSnapshot(), state.playhead);
    state.setIsPlaying(true);
  }

  function handleStop() {
    audioEngine.stop();
    setPlayhead(0);
    setIsPlaying(false);
  }

  async function handleRecordToggle() {
    if (recordingState.status === "counting-in") {
      clearRecordingTimers();
      resetRecordingState();
      setStatus("Recording count-in cancelled.");
      useDawStore.getState().setCommandMessage("Recording count-in cancelled.");
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
      let targetTrack =
        armedTrack ?? findClip(state.tracks, state.selectedClipId)?.track ?? state.tracks[0];

      if (!targetTrack) {
        addTrack();
        targetTrack = useDawStore.getState().tracks[0];
      }

      if (!targetTrack) {
        throw new Error("녹음할 트랙이 없습니다.");
      }

      const recordingIndex =
        Object.values(state.audioAssets).filter(
          (asset) => asset.sourceType === "recording",
        ).length + 1;
      const fileName = `Vocal Recording ${String(recordingIndex).padStart(3, "0")}.wav`;
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
            });
            updateClip(session.clipId, { duration });
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
        setStatus("Recording count-in cancelled.");
        useDawStore.getState().setCommandMessage("Recording count-in cancelled.");
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

      updateAudioAsset(session.assetId, {
        ...asset,
        duration: asset.duration || result.duration,
        waveformPeaks: asset.waveformPeaks.length
          ? asset.waveformPeaks
          : result.peaks,
      });
      updateClip(session.clipId, {
        audioBufferId: asset.id,
        duration: asset.duration || result.duration,
        isRecording: false,
        name: asset.fileName,
        stretchMode: "none",
      });
      setStatus(`${asset.fileName} 녹음 완료`);
      useDawStore.getState().setCommandMessage(`${asset.fileName} 녹음 완료`);
    } catch (error) {
      updateClip(session.clipId, { isRecording: false });
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

        // 매번 최신 state를 읽어 트랙/플레이헤드 정보 반영
        const state = useDawStore.getState();
        const startTime = state.playhead;

        // 첫 번째 파일은 트랙 0 재사용, 이후 파일은 새 트랙 생성
        let targetTrack = state.tracks[i];
        if (!targetTrack) {
          addTrack();
          // addTrack은 동기 zustand set이지만 state 스냅샷은 즉시 반영됨
          targetTrack = useDawStore.getState().tracks[i];
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
          stretchMode: "resample",
          gain: 1,
          fadeIn: 0,
          fadeOut: 0,
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

  function handleSaveProject() {
    const project = getProjectSnapshot();
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("프로젝트 JSON을 저장했습니다. 오디오 원본은 다음 단계에서 IndexedDB로 묶습니다.");
  }

  async function handleLoadProject(file: File) {
    try {
      const text = await file.text();
      const project = JSON.parse(text) as DawProject;
      audioEngine.stop();
      importProject(project);
      setStatus("프로젝트 JSON을 불러왔습니다. 재생하려면 같은 오디오 파일을 다시 업로드해야 합니다.");
    } catch (error) {
      setStatus(`프로젝트 불러오기 실패: ${(error as Error).message}`);
    }
  }

  return (
    <main className="app-shell">
      <TransportBar
        isRecording={isRecording}
        status={commandMessage || status}
        onFiles={handleFiles}
        onLoadProject={handleLoadProject}
        onPlayPause={handlePlayPause}
        onRecordToggle={handleRecordToggle}
        onSaveProject={handleSaveProject}
        onStop={handleStop}
      />
      <div className={`workspace ${playlistDetached ? "detached" : ""}`}>
        <Timeline />
        <Inspector />
      </div>
    </main>
  );
}
