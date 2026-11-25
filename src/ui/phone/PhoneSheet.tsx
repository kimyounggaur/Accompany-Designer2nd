import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { toggleRecordingArm } from "../../app/actions";
import { DEFAULT_TRACK_VOLUME } from "../../domain/project/defaults";
import { ko } from "../../i18n/ko";
import { history } from "../../state/history";
import { usePhoneSheetStore } from "../../state/phoneSheetStore";
import { useRecordingStore } from "../../state/recordingStore";
import { useDawStore } from "../../store/useDawStore";
import { countRender } from "../debug/renderCount";
import { Slider } from "../controls/Slider";
import { RecordOptions } from "../transport/RecordOptions";

/**
 * 휴대폰 "재생·녹음" 모드의 아래 시트(설계서 §P6-5). 오른쪽 패널 대신 아래에서 올라오며 트랙 볼륨·녹음 대기·음소거·솔로와 녹음 설정만 담는다.
 * 이퀄라이저·이펙트 같은 노브 화면은 넓은 화면에서 한다. 볼륨은 노브가 아니라 가로 슬라이더다(숫자 칸은 두지 않는다).
 * 닫혀 있어도 그대로 그려 둔다(숨김): 녹음 설정의 모니터 볼륨을 소리 엔진에 알리는 일이 이 부품 안에 있어서, 시트를 안 열어도 기억해 둔 값이 적용된다.
 */
export function PhoneSheet() {
  countRender("PhoneSheet");
  const open = usePhoneSheetStore((state) => state.open);
  const setOpen = usePhoneSheetStore((state) => state.setOpen);
  const tracks = useDawStore((state) => state.tracks);
  const updateTrack = useDawStore((state) => state.updateTrack);
  const armedTrackId = useRecordingStore((state) => state.armedTrackId);
  const isRecording = useRecordingStore((state) => state.status !== "idle");
  const rootRef = useRef<HTMLElement>(null);

  // 열려 있을 때 Escape로 닫는다(물리 키보드가 붙은 태블릿·접근성 도구). 초점은 시트 머리의 닫기 단추로 옮겨 시트 안에서 시작한다.
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>("[data-sheet-close]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      document.querySelector<HTMLElement>('[data-testid="phone-sheet-toggle"]')?.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, setOpen]);

  return (
    <>
      <div className="phone-scrim" data-open={open} data-testid="phone-scrim" aria-hidden="true" onPointerDown={() => setOpen(false)} />
      <aside
        id="phone-sheet"
        ref={rootRef}
        className="phone-sheet"
        data-open={open}
        data-testid="phone-sheet"
        role="dialog"
        aria-modal="false"
        aria-label={ko.phone.sheetTitle}
        inert={!open}
      >
        <header className="phone-sheet__header">
          <h2>{ko.phone.sheetTitle}</h2>
          <button type="button" className="icon-button" data-sheet-close="" aria-label={ko.phone.close} title={ko.phone.close} onClick={() => setOpen(false)}>
            <X size={20} />
          </button>
        </header>

        <section className="phone-sheet__section" aria-label={ko.phone.tracksHeading}>
          <h3>{ko.phone.tracksHeading}</h3>
          <ul className="phone-tracks">
            {tracks.map((track) => (
              <li className="phone-track" key={track.id} data-testid="phone-track">
                <div className="phone-track__top">
                  <span className="phone-track__name">{track.name}</span>
                  <div className="phone-track__toggles">
                    <button
                      type="button"
                      className={armedTrackId === track.id ? "toggle arm-toggle active" : "toggle arm-toggle"}
                      disabled={isRecording}
                      aria-pressed={armedTrackId === track.id}
                      aria-label={`${track.name} ${ko.trackHeader.arm}`}
                      title={ko.trackHeader.armHint}
                      onClick={() => toggleRecordingArm(track.id)}
                    >
                      {ko.trackHeader.arm}
                    </button>
                    <button
                      type="button"
                      className={track.muted ? "toggle active danger" : "toggle"}
                      aria-pressed={track.muted}
                      aria-label={`${track.name} ${ko.trackHeader.mute}`}
                      onClick={() => updateTrack(track.id, { muted: !track.muted })}
                    >
                      {ko.trackHeader.mute}
                    </button>
                    <button
                      type="button"
                      className={track.solo ? "toggle active" : "toggle"}
                      aria-pressed={track.solo}
                      aria-label={`${track.name} ${ko.trackHeader.solo}`}
                      onClick={() => updateTrack(track.id, { solo: !track.solo })}
                    >
                      {ko.trackHeader.solo}
                    </button>
                  </div>
                </div>
                <label className="phone-track__volume">
                  <span>{ko.trackHeader.volume}</span>
                  <Slider
                    label={`${track.name} 볼륨`}
                    min={0}
                    max={1}
                    step={0.01}
                    value={track.volume}
                    defaultValue={DEFAULT_TRACK_VOLUME}
                    format={(volume) => `${Math.round(volume * 100)}%`}
                    testId="phone-track-volume"
                    onChangeStart={() => history.beginGesture(`track:${track.id}:volume`)}
                    onChange={(volume) => updateTrack(track.id, { volume })}
                    onChangeEnd={() => history.endGesture()}
                  />
                  <output className="phone-track__value">{Math.round(track.volume * 100)}%</output>
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section className="phone-sheet__section" aria-label={ko.phone.recordHeading}>
          <h3>{ko.phone.recordHeading}</h3>
          <RecordOptions isRecording={isRecording} variant="sheet" />
        </section>
      </aside>
    </>
  );
}
