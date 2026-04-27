import { useEffect, useMemo, useRef, useState } from "react";
import { audioEngine } from "./audio/audioEngine";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { TransportBar } from "./components/TransportBar";
import type { Clip, DawProject } from "./types";
import { createId, getProjectDuration } from "./utils/audioMath";
import { useDawStore } from "./store/useDawStore";

function getProjectSnapshot(): DawProject {
  const state = useDawStore.getState();
  return {
    id: state.id,
    name: state.name,
    bpm: state.bpm,
    sampleRate: state.sampleRate,
    tracks: state.tracks,
    audioAssets: state.audioAssets,
  };
}

export default function App() {
  const isPlaying = useDawStore((state) => state.isPlaying);
  const tracks = useDawStore((state) => state.tracks);
  const bpm = useDawStore((state) => state.bpm);
  const setIsPlaying = useDawStore((state) => state.setIsPlaying);
  const setPlayhead = useDawStore((state) => state.setPlayhead);
  const addAudioAsset = useDawStore((state) => state.addAudioAsset);
  const addClip = useDawStore((state) => state.addClip);
  const importProject = useDawStore((state) => state.importProject);
  const deleteClip = useDawStore((state) => state.deleteClip);
  const selectedClipId = useDawStore((state) => state.selectedClipId);
  const setPlaylistTool = useDawStore((state) => state.setPlaylistTool);
  const [status, setStatus] = useState("오디오 파일을 업로드하면 첫 트랙에 클립이 생성됩니다.");
  const animationRef = useRef<number | undefined>(undefined);

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

      if ((event.key === "Delete" || event.key === "Backspace") && selectedClipId) {
        deleteClip(selectedClipId);
      }

      const shortcut = event.key.toLowerCase();
      if (shortcut === "p") {
        setPlaylistTool("draw");
      } else if (shortcut === "b") {
        setPlaylistTool("paint");
      } else if (shortcut === "d") {
        setPlaylistTool("delete");
      } else if (shortcut === "t") {
        setPlaylistTool("mute");
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
  }, [deleteClip, selectedClipId, setPlaylistTool]);

  useEffect(() => {
    return () => audioEngine.stop();
  }, []);

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

  async function handleFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (!fileArray.length) {
      return;
    }

    setStatus("오디오를 디코딩하고 파형을 만드는 중입니다...");

    for (const file of fileArray) {
      try {
        const { asset } = await audioEngine.decodeFile(file);
        const state = useDawStore.getState();
        const targetTrack = state.tracks[0];
        const clip: Clip = {
          id: createId("clip"),
          audioBufferId: asset.id,
          name: asset.fileName,
          trackId: targetTrack.id,
          startTime: state.playhead,
          offset: 0,
          duration: asset.duration,
          sourceBpm: state.bpm,
          stretchMode: "resample",
          gain: 1,
          fadeIn: 0,
          fadeOut: 0,
        };

        addAudioAsset(asset);
        addClip(targetTrack.id, clip);
        setStatus(`${asset.fileName} 업로드 완료`);
      } catch (error) {
        setStatus(`${file.name} 디코딩 실패: ${(error as Error).message}`);
      }
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
        status={status}
        onFiles={handleFiles}
        onLoadProject={handleLoadProject}
        onPlayPause={handlePlayPause}
        onSaveProject={handleSaveProject}
        onStop={handleStop}
      />
      <div className="workspace">
        <Timeline />
        <Inspector />
      </div>
    </main>
  );
}
