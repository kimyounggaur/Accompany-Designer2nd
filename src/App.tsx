import { useEffect, useRef } from "react";
import { audioEngine } from "./audio/currentEngine";
import { Inspector } from "./ui/inspector/Inspector";
import { Timeline } from "./components/Timeline";
import { AppShell } from "./app/AppShell";
import { startApp } from "./app/bootstrap";
import { importAudioFiles } from "./app/importing";
import { loadProjectFile, saveProjectFile } from "./app/projectFile";
import { getProjectSnapshot } from "./app/projectSnapshot";
import { openExportDialog, resetExport } from "./app/exporting";
import { disposeRecording, toggleRecording } from "./app/recording";
import { openRelinkDialog } from "./app/relinking";
import { stopPlayback, togglePlayback } from "./app/transport";
import { isRecordingBusy, useRecordingStore } from "./state/recordingStore";
import { TopBar } from "./ui/transport/TopBar";
import { getProjectDuration } from "./utils/audioMath";
import { useDawStore } from "./store/useDawStore";

export default function App() {
  const isPlaying = useDawStore((state) => state.isPlaying);
  const setIsPlaying = useDawStore((state) => state.setIsPlaying);
  const setPlayhead = useDawStore((state) => state.setPlayhead);
  const isRecording = useRecordingStore((state) => state.status !== "idle");
  const animationRef = useRef<number | undefined>(undefined);

  // 자동 저장 시작·저장된 프로젝트 복구·키보드 단축키는 app/bootstrap.ts가 맡는다(키는 services/shortcuts.ts의 표 + app/keyboard.ts).
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

  function handleRecordToggle() {
    void toggleRecording();
  }

  return (
    <AppShell
      topBar={
        <TopBar
          isRecording={isRecording}
          onFiles={importAudioFiles}
          onLoadProject={loadProjectFile}
          onPlayPause={togglePlayback}
          onRecordToggle={handleRecordToggle}
          onSaveProject={saveProjectFile}
          onExportMix={openExportDialog}
          onRelink={openRelinkDialog}
          onStop={stopPlayback}
        />
      }
      timeline={<Timeline />}
      inspector={<Inspector />}
    />
  );
}
