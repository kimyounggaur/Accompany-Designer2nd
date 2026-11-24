import { useEffect } from "react";
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
import { useDawStore } from "./store/useDawStore";

export default function App() {
  const isRecording = useRecordingStore((state) => state.status !== "idle");

  // 자동 저장 시작·저장된 프로젝트 복구·키보드 단축키·화면 갱신 루프는 app/bootstrap.ts가 맡는다
  // (키는 services/shortcuts.ts의 표 + app/keyboard.ts, 재생선·시간 표시는 services/frameLoop.ts + app/playbackLoop.ts).
  useEffect(() => startApp(), []);

  useEffect(() => {
    const onPlayFrom = (event: Event) => {
      // 녹음하는 동안에는 재생 위치를 옮기지 않는다.
      if (isRecordingBusy()) return;
      const startAt = Math.max(
        0,
        Number((event as CustomEvent<number>).detail) || 0,
      );
      const state = useDawStore.getState();

      state.setCursor(startAt);
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
