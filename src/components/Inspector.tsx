import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { estimateBpm } from "../audio/bpmDetector";
import { audioEngine } from "../audio/audioEngine";
import { useDawStore } from "../store/useDawStore";
import type { CompressorSettings, EqSettings } from "../types";
import {
  findClip,
  getClipPlaybackRate,
  getClipTimelineDuration,
} from "../utils/audioMath";

export function Inspector() {
  const [bpmStatus, setBpmStatus] = useState("");
  const tracks = useDawStore((state) => state.tracks);
  const audioAssets = useDawStore((state) => state.audioAssets);
  const selectedClipId = useDawStore((state) => state.selectedClipId);
  const bpm = useDawStore((state) => state.bpm);
  const updateClip = useDawStore((state) => state.updateClip);
  const updateTrack = useDawStore((state) => state.updateTrack);
  const updateAudioAsset = useDawStore((state) => state.updateAudioAsset);
  const deleteClip = useDawStore((state) => state.deleteClip);

  const selection = useMemo(
    () => findClip(tracks, selectedClipId),
    [selectedClipId, tracks],
  );
  const selectedTrack = selection?.track ?? tracks[0];
  const selectedClip = selection?.clip;
  const asset = selectedClip ? audioAssets[selectedClip.audioBufferId] : undefined;

  function updateEq(patch: Partial<EqSettings>) {
    updateTrack(selectedTrack.id, {
      eq: {
        ...selectedTrack.eq,
        ...patch,
      },
    });
  }

  function updateCompressor(patch: Partial<CompressorSettings>) {
    updateTrack(selectedTrack.id, {
      compressor: {
        ...selectedTrack.compressor,
        ...patch,
      },
    });
  }

  function detectClipBpm() {
    if (!selectedClip) {
      return;
    }

    const buffer = audioEngine.getBuffer(selectedClip.audioBufferId);
    if (!buffer) {
      setBpmStatus("오디오 버퍼가 없어 BPM을 분석할 수 없습니다.");
      return;
    }

    setBpmStatus("BPM 분석 중...");
    window.setTimeout(() => {
      const detected = estimateBpm(buffer);
      if (!detected) {
        setBpmStatus("BPM을 안정적으로 추정하지 못했습니다.");
        return;
      }

      updateClip(selectedClip.id, { sourceBpm: detected });
      updateAudioAsset(selectedClip.audioBufferId, { detectedBpm: detected });
      setBpmStatus(`추정 BPM ${detected}`);
    }, 30);
  }

  if (!selectedTrack) {
    return <aside className="inspector" />;
  }

  return (
    <aside className="inspector">
      <section className="panel">
        <div className="panel-heading">
          <h2>Clip</h2>
          {selectedClip && (
            <button
              className="icon-button danger"
              onClick={() => deleteClip(selectedClip.id)}
              title="Delete clip"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>

        {selectedClip ? (
          <div className="control-stack">
            <label>
              Name
              <input
                value={selectedClip.name}
                onChange={(event) =>
                  updateClip(selectedClip.id, { name: event.target.value })
                }
              />
            </label>
            <label>
              Source BPM
              <input
                min={20}
                max={300}
                type="number"
                value={selectedClip.sourceBpm}
                onChange={(event) =>
                  updateClip(selectedClip.id, {
                    sourceBpm: Number(event.target.value) || bpm,
                  })
                }
              />
            </label>
            <label>
              Gain
              <input
                max={2}
                min={0}
                step={0.01}
                type="range"
                value={selectedClip.gain}
                onChange={(event) =>
                  updateClip(selectedClip.id, { gain: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Stretch
              <select
                value={selectedClip.stretchMode}
                onChange={(event) =>
                  updateClip(selectedClip.id, {
                    stretchMode: event.target.value as "none" | "resample",
                  })
                }
              >
                <option value="resample">Realtime playbackRate</option>
                <option value="none">Original speed</option>
              </select>
            </label>
            <div className="mini-readout">
              <span>Rate {getClipPlaybackRate(bpm, selectedClip).toFixed(2)}x</span>
              <span>
                Length {getClipTimelineDuration(bpm, selectedClip).toFixed(2)}s
              </span>
            </div>
            <button className="text-button full" onClick={detectClipBpm}>
              Detect BPM
            </button>
            {asset && (
              <p className="asset-meta">
                {asset.fileName} · {asset.duration.toFixed(2)}s · {asset.sampleRate}Hz
              </p>
            )}
            {bpmStatus && <p className="asset-meta">{bpmStatus}</p>}
          </div>
        ) : (
          <p className="empty-state">클립을 선택하면 편집 값이 표시됩니다.</p>
        )}
      </section>

      <section className="panel">
        <h2>Track Mix</h2>
        <div className="control-stack">
          <label>
            Volume
            <input
              max={1}
              min={0}
              step={0.01}
              type="range"
              value={selectedTrack.volume}
              onChange={(event) =>
                updateTrack(selectedTrack.id, { volume: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Pan
            <input
              max={1}
              min={-1}
              step={0.01}
              type="range"
              value={selectedTrack.pan}
              onChange={(event) =>
                updateTrack(selectedTrack.id, { pan: Number(event.target.value) })
              }
            />
          </label>
          <div className="button-row">
            <button
              className={selectedTrack.muted ? "toggle active danger" : "toggle"}
              onClick={() =>
                updateTrack(selectedTrack.id, { muted: !selectedTrack.muted })
              }
            >
              Mute
            </button>
            <button
              className={selectedTrack.solo ? "toggle active" : "toggle"}
              onClick={() =>
                updateTrack(selectedTrack.id, { solo: !selectedTrack.solo })
              }
            >
              Solo
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>EQ</h2>
        <div className="control-stack">
          <label>
            Low
            <input
              max={12}
              min={-12}
              step={0.5}
              type="range"
              value={selectedTrack.eq.lowGain}
              onChange={(event) => updateEq({ lowGain: Number(event.target.value) })}
            />
          </label>
          <label>
            Mid
            <input
              max={12}
              min={-12}
              step={0.5}
              type="range"
              value={selectedTrack.eq.midGain}
              onChange={(event) => updateEq({ midGain: Number(event.target.value) })}
            />
          </label>
          <label>
            High
            <input
              max={12}
              min={-12}
              step={0.5}
              type="range"
              value={selectedTrack.eq.highGain}
              onChange={(event) => updateEq({ highGain: Number(event.target.value) })}
            />
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Compressor</h2>
          <button
            className={selectedTrack.compressor.enabled ? "toggle active" : "toggle"}
            onClick={() =>
              updateCompressor({ enabled: !selectedTrack.compressor.enabled })
            }
          >
            On
          </button>
        </div>
        <div className="control-stack">
          <label>
            Threshold
            <input
              max={0}
              min={-60}
              step={1}
              type="range"
              value={selectedTrack.compressor.threshold}
              onChange={(event) =>
                updateCompressor({ threshold: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Ratio
            <input
              max={20}
              min={1}
              step={0.5}
              type="range"
              value={selectedTrack.compressor.ratio}
              onChange={(event) =>
                updateCompressor({ ratio: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Attack
            <input
              max={1}
              min={0.001}
              step={0.001}
              type="range"
              value={selectedTrack.compressor.attack}
              onChange={(event) =>
                updateCompressor({ attack: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Release
            <input
              max={1}
              min={0.01}
              step={0.01}
              type="range"
              value={selectedTrack.compressor.release}
              onChange={(event) =>
                updateCompressor({ release: Number(event.target.value) })
              }
            />
          </label>
        </div>
      </section>
    </aside>
  );
}
