import {
  ChevronDown,
  ChevronUp,
  Download,
  GripVertical,
  Power,
  Save,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import type { EffectSlot, EffectSlotType, Track } from "../types";

const PRESET_KEY = "browser-daw.effectRackPresets";

const EFFECT_LABELS: Record<EffectSlotType, string> = {
  eq: "EQ",
  comp: "Compressor",
  delay: "Delay",
  reverb: "Reverb",
};

interface EffectRackPreset {
  name: string;
  createdAt: string;
  effectChain: EffectSlot[];
  eq: Track["eq"];
  compressor: Track["compressor"];
  delay: Track["delay"];
  reverb: Track["reverb"];
}

interface EffectRackProps {
  track: Track;
  onChange: (patch: Partial<Omit<Track, "clips">>) => void;
}

function readPresets(): EffectRackPreset[] {
  try {
    const raw = window.localStorage.getItem(PRESET_KEY);
    return raw ? JSON.parse(raw) as EffectRackPreset[] : [];
  } catch {
    return [];
  }
}

function writePresets(presets: EffectRackPreset[]) {
  window.localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
}

function createPreset(track: Track, name: string): EffectRackPreset {
  return {
    name,
    createdAt: new Date().toISOString(),
    effectChain: track.effectChain.map((slot) => ({ ...slot })),
    eq: { ...track.eq },
    compressor: { ...track.compressor },
    delay: { ...track.delay },
    reverb: { ...track.reverb },
  };
}

function getSettingsEnabled(track: Track, type: EffectSlotType) {
  if (type === "eq") {
    return track.eq.enabled;
  }

  if (type === "comp") {
    return track.compressor.enabled;
  }

  if (type === "delay") {
    return track.delay.enabled;
  }

  return track.reverb.enabled;
}

function getEnabledPatch(
  track: Track,
  type: EffectSlotType,
  enabled: boolean,
): Partial<Omit<Track, "clips">> {
  const effectChain = track.effectChain.map((slot) =>
    slot.type === type ? { ...slot, enabled } : slot,
  );

  if (type === "eq") {
    return { effectChain, eq: { ...track.eq, enabled } };
  }

  if (type === "comp") {
    return { effectChain, compressor: { ...track.compressor, enabled } };
  }

  if (type === "delay") {
    return { effectChain, delay: { ...track.delay, enabled } };
  }

  return { effectChain, reverb: { ...track.reverb, enabled } };
}

function reorderSlots(slots: EffectSlot[], sourceId: string, targetId: string) {
  const sourceIndex = slots.findIndex((slot) => slot.id === sourceId);
  const targetIndex = slots.findIndex((slot) => slot.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return slots;
  }

  const next = [...slots];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

function moveSlot(slots: EffectSlot[], slotId: string, direction: -1 | 1) {
  const index = slots.findIndex((slot) => slot.id === slotId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= slots.length) {
    return slots;
  }

  const next = [...slots];
  const [moved] = next.splice(index, 1);
  next.splice(nextIndex, 0, moved);
  return next;
}

export function EffectRack({ track, onChange }: EffectRackProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draggingId, setDraggingId] = useState<string>();
  const [presetName, setPresetName] = useState(`${track.name} Rack`);
  const [selectedPresetName, setSelectedPresetName] = useState("");
  const [presets, setPresets] = useState<EffectRackPreset[]>(readPresets);
  const [message, setMessage] = useState("");

  function savePreset() {
    const name = presetName.trim() || `${track.name} Rack`;
    const preset = createPreset(track, name);
    const next = [
      preset,
      ...presets.filter((candidate) => candidate.name !== name),
    ].slice(0, 24);

    writePresets(next);
    setPresets(next);
    setSelectedPresetName(name);
    setMessage(`${name} 프리셋 저장됨`);
  }

  function loadPreset(preset: EffectRackPreset | undefined) {
    if (!preset) {
      return;
    }

    onChange({
      effectChain: preset.effectChain.map((slot) => ({ ...slot })),
      eq: { ...preset.eq },
      compressor: { ...preset.compressor },
      delay: { ...preset.delay },
      reverb: { ...preset.reverb },
    });
    setPresetName(preset.name);
    setSelectedPresetName(preset.name);
    setMessage(`${preset.name} 프리셋 불러옴`);
  }

  function exportPreset() {
    const name = presetName.trim() || `${track.name} Rack`;
    const preset = createPreset(track, name);
    const blob = new Blob([JSON.stringify(preset, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name.replace(/[\\/:*?"<>|]/g, "-")}.effect-rack.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importPreset(file: File) {
    try {
      const preset = JSON.parse(await file.text()) as EffectRackPreset;
      if (!preset.effectChain?.length) {
        throw new Error("Invalid preset.");
      }
      loadPreset(preset);
    } catch {
      setMessage("프리셋 파일을 불러오지 못했습니다.");
    }
  }

  return (
    <div className="effect-rack">
      <div className="effect-rack-heading">
        <div>
          <h2>이펙트 랙</h2>
          <span>{track.name}</span>
        </div>
        <button className="icon-button" onClick={savePreset} title="랙 프리셋 저장" type="button">
          <Save size={15} />
        </button>
      </div>

      <div className="effect-preset-row">
        <input
          aria-label="프리셋 이름"
          onChange={(event) => setPresetName(event.target.value)}
          value={presetName}
        />
        <select
          aria-label="랙 프리셋"
          onChange={(event) => {
            const name = event.target.value;
            setSelectedPresetName(name);
            loadPreset(presets.find((preset) => preset.name === name));
          }}
          value={selectedPresetName}
        >
          <option value="">프리셋</option>
          {presets.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.name}
            </option>
          ))}
        </select>
        <button className="icon-button" onClick={exportPreset} title="프리셋 파일 내보내기" type="button">
          <Download size={15} />
        </button>
        <input
          ref={fileInputRef}
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void importPreset(file);
              event.target.value = "";
            }
          }}
          type="file"
        />
        <button
          className="icon-button"
          onClick={() => fileInputRef.current?.click()}
          title="프리셋 파일 불러오기"
          type="button"
        >
          <Upload size={15} />
        </button>
      </div>

      <div className="effect-slot-list">
        {track.effectChain.map((slot, index) => {
          const active = slot.enabled && getSettingsEnabled(track, slot.type);
          return (
            <div
              className={`effect-slot ${active ? "on" : ""} ${
                draggingId === slot.id ? "dragging" : ""
              }`}
              draggable
              key={slot.id}
              onDragEnd={() => setDraggingId(undefined)}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={() => setDraggingId(slot.id)}
              onDrop={() => {
                if (!draggingId) {
                  return;
                }
                onChange({ effectChain: reorderSlots(track.effectChain, draggingId, slot.id) });
                setDraggingId(undefined);
              }}
            >
              <GripVertical size={15} />
              <button
                className={`effect-power ${active ? "on" : ""}`}
                onClick={() => onChange(getEnabledPatch(track, slot.type, !active))}
                title={active ? "이펙트 끄기" : "이펙트 켜기"}
                type="button"
              >
                <Power size={13} />
              </button>
              <div className="effect-slot-label">
                <strong>{EFFECT_LABELS[slot.type]}</strong>
                <span>{active ? "ON" : "BYPASS"}</span>
              </div>
              <div className="effect-order-buttons">
                <button
                  className="icon-button mini"
                  disabled={index === 0}
                  onClick={() => onChange({ effectChain: moveSlot(track.effectChain, slot.id, -1) })}
                  title="위로 이동"
                  type="button"
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  className="icon-button mini"
                  disabled={index === track.effectChain.length - 1}
                  onClick={() => onChange({ effectChain: moveSlot(track.effectChain, slot.id, 1) })}
                  title="아래로 이동"
                  type="button"
                >
                  <ChevronDown size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {message && <p className="effect-rack-message">{message}</p>}
    </div>
  );
}
