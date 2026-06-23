import { useEffect, useRef, useState } from "react";
import { audioEngine } from "../audio/audioEngine";
import { useDawStore } from "../store/useDawStore";

const MIN_DB = -60;
const MAX_DB = 6;
const COMMIT_INTERVAL_MS = 50;
const CLIP_HOLD_MS = 1400;

export interface MeterReading {
  peakDb: number;
  rmsDb: number;
  holdDb: number;
  clipped: boolean;
}

const SILENT_READING: MeterReading = {
  peakDb: MIN_DB,
  rmsDb: MIN_DB,
  holdDb: MIN_DB,
  clipped: false,
};

function amplitudeToDb(value: number) {
  return 20 * Math.log10(Math.max(0.000001, value));
}

function clampDb(value: number) {
  return Math.max(MIN_DB, Math.min(MAX_DB, value));
}

function dbToPercent(value: number) {
  return ((clampDb(value) - MIN_DB) / (MAX_DB - MIN_DB)) * 100;
}

function calculateReading(
  analyser: AnalyserNode | undefined,
  buffer: Float32Array<ArrayBuffer> | undefined,
  previous: MeterReading,
  clipped: boolean,
) {
  if (!analyser || !buffer) {
    return {
      peakDb: Math.max(MIN_DB, previous.peakDb - 2.2),
      rmsDb: Math.max(MIN_DB, previous.rmsDb - 2.2),
      holdDb: Math.max(MIN_DB, previous.holdDb - 1.1),
      clipped,
    };
  }

  analyser.getFloatTimeDomainData(buffer);

  let peak = 0;
  let sumSquares = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const sample = buffer[index];
    const abs = Math.abs(sample);
    peak = Math.max(peak, abs);
    sumSquares += sample * sample;
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, buffer.length));
  const peakDb = clampDb(amplitudeToDb(peak));
  const rmsDb = clampDb(amplitudeToDb(rms));
  const holdDb = peakDb > previous.holdDb
    ? peakDb
    : Math.max(MIN_DB, previous.holdDb - 0.65);

  return {
    peakDb,
    rmsDb,
    holdDb,
    clipped,
  };
}

function getAnalyserForMeter(id: string) {
  return id === "master"
    ? audioEngine.getMasterAnalyser()
    : audioEngine.getTrackAnalyser(id);
}

export function LevelMeter({
  label,
  reading = SILENT_READING,
  tone = "track",
}: {
  label: string;
  reading?: MeterReading;
  tone?: "master" | "track";
}) {
  const peakHeight = dbToPercent(reading.peakDb);
  const rmsHeight = dbToPercent(reading.rmsDb);
  const holdPosition = dbToPercent(reading.holdDb);

  return (
    <div className={`level-meter ${tone}`}>
      <div className={`level-meter-clip ${reading.clipped ? "on" : ""}`} />
      <div className="level-meter-scale" aria-hidden="true">
        <span>0</span>
        <span>-18</span>
        <span>-60</span>
      </div>
      <div className="level-meter-bar" title={`${label} peak ${reading.peakDb.toFixed(1)} dB`}>
        <span className="level-meter-zone hot" />
        <span className="level-meter-zone warm" />
        <span className="level-meter-rms" style={{ height: `${rmsHeight}%` }} />
        <span className="level-meter-peak" style={{ height: `${peakHeight}%` }} />
        <span className="level-meter-hold" style={{ bottom: `${holdPosition}%` }} />
      </div>
      <div className="level-meter-label">
        <strong>{label}</strong>
        <span>{reading.peakDb.toFixed(1)} dB</span>
      </div>
    </div>
  );
}

export function LevelMeterRack() {
  const tracks = useDawStore((state) => state.tracks);
  const [readings, setReadings] = useState<Record<string, MeterReading>>({});
  const readingsRef = useRef<Record<string, MeterReading>>({});
  const buffersRef = useRef(new Map<string, Float32Array<ArrayBuffer>>());
  const clipUntilRef = useRef(new Map<string, number>());
  const lastCommitRef = useRef(0);
  const trackSignature = tracks.map((track) => `${track.id}:${track.name}`).join("|");

  useEffect(() => {
    let rafId = 0;
    let disposed = false;

    const tick = (time: number) => {
      const meterIds = ["master", ...tracks.map((track) => track.id)];
      const nextReadings: Record<string, MeterReading> = {};

      for (const id of meterIds) {
        const analyser = getAnalyserForMeter(id);
        let buffer = analyser ? buffersRef.current.get(id) : undefined;
        if (analyser && (!buffer || buffer.length !== analyser.fftSize)) {
          buffer = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>;
          buffersRef.current.set(id, buffer);
        }

        if (buffer) {
          analyser?.getFloatTimeDomainData(buffer);
          const clips = buffer.some((sample) => Math.abs(sample) >= 1);
          if (clips) {
            clipUntilRef.current.set(id, time + CLIP_HOLD_MS);
          }
        }

        const clipped = (clipUntilRef.current.get(id) ?? 0) > time;
        const previous = readingsRef.current[id] ?? SILENT_READING;
        nextReadings[id] = calculateReading(analyser, buffer, previous, clipped);
      }

      readingsRef.current = nextReadings;
      if (time - lastCommitRef.current >= COMMIT_INTERVAL_MS) {
        setReadings(nextReadings);
        lastCommitRef.current = time;
      }

      if (!disposed) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
    };
  }, [trackSignature]);

  return (
    <div className="meter-rack">
      <div className="meter-rack-heading">
        <h2>레벨 미터</h2>
        <span>Peak / RMS</span>
      </div>
      <div className="meter-list">
        <LevelMeter
          label="MASTER"
          reading={readings.master}
          tone="master"
        />
        {tracks.map((track) => (
          <LevelMeter
            key={track.id}
            label={track.name}
            reading={readings[track.id]}
          />
        ))}
      </div>
    </div>
  );
}
