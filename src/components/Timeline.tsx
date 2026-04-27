import { Plus } from "lucide-react";
import { useMemo, useRef } from "react";
import { useDawStore } from "../store/useDawStore";
import { getBeatSeconds, getProjectDuration, snapTime } from "../utils/audioMath";
import { ClipView } from "./ClipView";

const TRACK_HEIGHT = 116;

export function Timeline() {
  const lanesRef = useRef<HTMLDivElement>(null);
  const tracks = useDawStore((state) => state.tracks);
  const audioAssets = useDawStore((state) => state.audioAssets);
  const bpm = useDawStore((state) => state.bpm);
  const playhead = useDawStore((state) => state.playhead);
  const zoomPxPerSecond = useDawStore((state) => state.zoomPxPerSecond);
  const snapEnabled = useDawStore((state) => state.snapEnabled);
  const gridDivision = useDawStore((state) => state.gridDivision);
  const setPlayhead = useDawStore((state) => state.setPlayhead);
  const selectClip = useDawStore((state) => state.selectClip);
  const addTrack = useDawStore((state) => state.addTrack);
  const updateTrack = useDawStore((state) => state.updateTrack);

  const projectDuration = useMemo(
    () => getProjectDuration({ bpm, tracks }),
    [bpm, tracks],
  );
  const width = Math.max(1200, projectDuration * zoomPxPerSecond);
  const beatSeconds = getBeatSeconds(bpm);
  const beatWidth = beatSeconds * zoomPxPerSecond;
  const subdivisionWidth = beatWidth / gridDivision;

  const rulerTicks = useMemo(() => {
    const totalBeats = Math.ceil(projectDuration / beatSeconds);
    return Array.from({ length: totalBeats + 1 }, (_, beat) => ({
      beat,
      left: beat * beatWidth,
      label: beat % 4 === 0 ? String(beat / 4 + 1) : "",
    }));
  }, [beatSeconds, beatWidth, projectDuration]);
  const timelineClips = useMemo(
    () =>
      tracks.flatMap((track, trackIndex) =>
        track.clips.map((clip) => ({
          clip,
          trackIndex,
        })),
      ),
    [tracks],
  );
  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);

  function seekFromPointer(clientX: number) {
    const rect = lanesRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const seconds = Math.max(0, (clientX - rect.left) / zoomPxPerSecond);
    setPlayhead(snapTime(seconds, bpm, snapEnabled, gridDivision));
  }

  return (
    <section className="playlist" aria-label="Playlist">
      <div className="track-column">
        <div className="ruler-corner">
          <span>Playlist</span>
          <button className="add-track-button" onClick={addTrack} title="Add track">
            <Plus size={15} />
            <span>Track</span>
          </button>
        </div>
        {tracks.map((track) => (
          <div className="track-header" key={track.id}>
            <input
              value={track.name}
              onChange={(event) => updateTrack(track.id, { name: event.target.value })}
            />
            <div className="track-toggles">
              <button
                className={track.muted ? "toggle active danger" : "toggle"}
                onClick={() => updateTrack(track.id, { muted: !track.muted })}
              >
                M
              </button>
              <button
                className={track.solo ? "toggle active" : "toggle"}
                onClick={() => updateTrack(track.id, { solo: !track.solo })}
              >
                S
              </button>
            </div>
            <label>
              Vol
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={track.volume}
                onChange={(event) =>
                  updateTrack(track.id, { volume: Number(event.target.value) })
                }
              />
            </label>
          </div>
        ))}
      </div>

      <div className="timeline-scroll">
        <div className="ruler" style={{ width }}>
          {rulerTicks.map((tick) => (
            <div
              className={`ruler-tick ${tick.label ? "major" : ""}`}
              key={tick.beat}
              style={{ left: tick.left }}
            >
              {tick.label && <span>{tick.label}</span>}
            </div>
          ))}
        </div>

        <div
          className="lanes"
          ref={lanesRef}
          style={{
            width,
            minHeight: tracks.length * TRACK_HEIGHT,
            backgroundSize: `${subdivisionWidth}px 100%`,
          }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              selectClip(undefined);
            }
            seekFromPointer(event.clientX);
          }}
        >
          <div
            className="playhead"
            style={{
              left: playhead * zoomPxPerSecond,
              height: tracks.length * TRACK_HEIGHT,
            }}
          />
          {tracks.map((track, index) => (
            <div
              className="track-lane"
              key={track.id}
              style={{
                height: TRACK_HEIGHT,
                top: index * TRACK_HEIGHT,
              }}
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                  selectClip(undefined);
                }
                seekFromPointer(event.clientX);
              }}
            />
          ))}
          {timelineClips.map(({ clip, trackIndex }) => (
            <ClipView
              asset={audioAssets[clip.audioBufferId]}
              clip={clip}
              key={clip.id}
              lanesRef={lanesRef}
              trackHeight={TRACK_HEIGHT}
              trackIndex={trackIndex}
              trackIds={trackIds}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
