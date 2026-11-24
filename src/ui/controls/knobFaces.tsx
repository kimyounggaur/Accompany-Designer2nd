import type { ComponentType, CSSProperties } from "react";
import type { FaceProps } from "./Knob";

/**
 * 노브의 겉모습. 동작(끌기·키보드·이름·값)은 모두 `Knob`가 만들어 `dial`로 넘겨 주고,
 * 모양은 그것을 눈에 보이는 한 요소(svg 또는 span)에 펼쳐 놓고 위치(0~1)에 맞춰 그리기만 한다.
 * 그러므로 여기에는 포인터·키보드를 다루는 코드가 없다.
 *
 * 모양은 노브마다 새로 짜지 않고 옛 노브들의 그림을 그대로 옮겨 왔다(이퀄라이저·트랙 믹스·컴프레서·딜레이·리버브).
 * 모든 모양은 모듈 맨 위에 한 번만 정의한다.
 */
export type KnobFaceName = "eq" | "trax" | "comp" | "arc" | "cap";

const toRad = (deg: number) => (deg - 90) * (Math.PI / 180);

/** 이퀄라이저: 색을 깐 칸 위의 작은 노브. 가운데(0)가 위쪽, ±끝이 ±135° */
function EqFace({ caption, norm, valueNode, color, dial }: FaceProps) {
  const angle = (norm - 0.5) * 270;
  const rad = toRad(angle);
  const cx = 32;
  const cy = 32;
  const r = 20;
  const tx = cx + r * Math.cos(rad);
  const ty = cy + r * Math.sin(rad);

  return (
    <div className="eq-band" style={{ background: color }}>
      <svg className="eq-knob knob" viewBox="0 0 64 64" {...dial}>
        <circle cx={cx} cy={cy} r={28} fill="#2a2a2a" />
        <circle cx={cx} cy={cy} r={22} fill="#3a3a3a" />
        <circle cx={cx} cy={cy} r={20} fill="#444" />
        <line x1={cx} y1={cy} x2={tx} y2={ty} stroke="#e8e8e0" strokeWidth={2.5} strokeLinecap="round" />
      </svg>
      <span className="eq-band-label">{caption}</span>
      <span className="eq-band-value">{valueNode}</span>
    </div>
  );
}

/** 트랙 믹스: 눈금과 점선 아크가 있는 주황 지시선 노브(큰 것은 볼륨, 작은 것은 팬) */
function TraxFace({ caption, norm, valueNode, size, dial }: FaceProps) {
  const large = size === "large";
  const startAngle = -135;
  const endAngle = 135;
  const angle = startAngle + norm * (endAngle - startAngle);

  const box = large ? 80 : 64;
  const cx = box / 2;
  const cy = box / 2;
  const tickR = large ? 36 : 28;
  const knobR = large ? 26 : 20;
  const innerR = large ? 22 : 17;
  const indicatorR = large ? 18 : 14;

  // 점선 아크
  const arcR = large ? 34 : 27;
  const arcStart = toRad(startAngle);
  const arcEnd = toRad(endAngle);
  const arcX1 = cx + arcR * Math.cos(arcStart);
  const arcY1 = cy + arcR * Math.sin(arcStart);
  const arcX2 = cx + arcR * Math.cos(arcEnd);
  const arcY2 = cy + arcR * Math.sin(arcEnd);

  const ticks = large ? 13 : 11;
  const tickAngles = Array.from({ length: ticks }, (_, i) => startAngle + (i / (ticks - 1)) * 270);

  // 주황 지시선
  const indRad = toRad(angle);
  const ix = cx + indicatorR * Math.cos(indRad);
  const iy = cy + indicatorR * Math.sin(indRad);
  const gradient = `traxGrad_${large ? "large" : "small"}`;

  return (
    <div className={`trax-knob-wrap ${large ? "large" : ""}`}>
      <svg className="knob" width={box} height={box} viewBox={`0 0 ${box} ${box}`} style={{ display: "block" }} {...dial}>
        {tickAngles.map((a, i) => {
          const r1 = tickR;
          const r2 = tickR - (large ? 5 : 4);
          const tickRad = toRad(a);
          const isActive = i / (ticks - 1) <= norm;
          return (
            <line
              key={i}
              x1={cx + r1 * Math.cos(tickRad)} y1={cy + r1 * Math.sin(tickRad)}
              x2={cx + r2 * Math.cos(tickRad)} y2={cy + r2 * Math.sin(tickRad)}
              stroke={isActive ? "#f5a623" : "#5a4a2a"}
              strokeWidth={large ? "2" : "1.5"} strokeLinecap="round"
            />
          );
        })}
        <path
          d={`M ${arcX1} ${arcY1} A ${arcR} ${arcR} 0 1 1 ${arcX2} ${arcY2}`}
          fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1"
          strokeDasharray="2 3" strokeLinecap="round"
        />
        <defs>
          <radialGradient id={gradient} cx="40%" cy="30%" r="65%" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#4a3a1a" />
            <stop offset="50%" stopColor="#1a1510" />
            <stop offset="100%" stopColor="#0d0b08" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={knobR + 2} fill="#5a4a20" />
        <circle cx={cx} cy={cy} r={knobR} fill={`url(#${gradient})`} />
        <circle cx={cx} cy={cy} r={innerR} fill="#0f0d09" />
        <line x1={cx} y1={cy} x2={ix} y2={iy} stroke="#f5a623" strokeWidth={large ? "3" : "2.5"} strokeLinecap="round" />
        <circle cx={ix} cy={iy} r={large ? 2 : 1.5} fill="#f5a623" />
      </svg>
      <span className="trax-knob-label">{caption}</span>
      <span className="trax-knob-val">{valueNode}</span>
    </div>
  );
}

const COMP_TICK_ANGLES = [-135, -90, -45, 0, 45, 90, 135];

/** 컴프레서: 7개 눈금과 은회색 지시선 */
function CompFace({ caption, norm, valueNode, dial }: FaceProps) {
  const angle = -135 + norm * 270;
  const rad = toRad(angle);

  return (
    <div className="comp-knob-wrap">
      <svg className="comp-knob-svg knob" viewBox="0 0 80 80" {...dial}>
        {COMP_TICK_ANGLES.map((a, i) => {
          const r1 = 37;
          const r2 = 33;
          const tickRad = toRad(a);
          return (
            <line
              key={i}
              x1={40 + r1 * Math.cos(tickRad)} y1={40 + r1 * Math.sin(tickRad)}
              x2={40 + r2 * Math.cos(tickRad)} y2={40 + r2 * Math.sin(tickRad)}
              stroke="#888" strokeWidth="1.5" strokeLinecap="round"
            />
          );
        })}
        <circle cx="40" cy="40" r="28" fill="url(#compKnobGrad)" />
        <circle cx="40" cy="40" r="24" fill="#1a1a1a" />
        <circle cx="40" cy="40" r="22" fill="#222" />
        <line
          x1="40" y1="40"
          x2={40 + 17 * Math.cos(rad)} y2={40 + 17 * Math.sin(rad)}
          stroke="#ddd" strokeWidth="2.5" strokeLinecap="round"
        />
        <defs>
          <radialGradient id="compKnobGrad" cx="40%" cy="35%" r="60%" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#555" />
            <stop offset="100%" stopColor="#1c1c1c" />
          </radialGradient>
        </defs>
      </svg>
      <span className="comp-knob-label">{caption}</span>
      <span className="comp-knob-sub">{valueNode}</span>
    </div>
  );
}

const ARC_MIN_ANGLE = -145;
const ARC_MAX_ANGLE = 145;
const ARC_BOX = 56;

/** 딜레이: 나무 장비의 호(arc) 노브. 값만큼 색 호가 차오른다 */
function ArcFace({ caption, norm, valueNode, color = "#d97a30", dial }: FaceProps) {
  const angle = ARC_MIN_ANGLE + norm * (ARC_MAX_ANGLE - ARC_MIN_ANGLE);
  const r = ARC_BOX / 2 - 4;
  const cx = ARC_BOX / 2;
  const cy = ARC_BOX / 2;

  const arcX1 = cx + r * Math.cos(toRad(ARC_MIN_ANGLE));
  const arcY1 = cy + r * Math.sin(toRad(ARC_MIN_ANGLE));
  const arcX2 = cx + r * Math.cos(toRad(angle));
  const arcY2 = cy + r * Math.sin(toRad(angle));
  const largeArc = angle - ARC_MIN_ANGLE > 180 ? 1 : 0;

  const iR = r - 5;
  const iX = cx + iR * Math.cos(toRad(angle));
  const iY = cy + iR * Math.sin(toRad(angle));

  return (
    <div className="dly-knob-wrap">
      <svg className="knob" width={ARC_BOX} height={ARC_BOX} viewBox={`0 0 ${ARC_BOX} ${ARC_BOX}`} style={{ display: "block" }} {...dial}>
        <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1.5} />
        <defs>
          <radialGradient id={`dkg-${caption}`} cx="40%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#5a4535" />
            <stop offset="100%" stopColor="#1e1208" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill={`url(#dkg-${caption})`} />
        <path
          d={`M ${arcX1} ${arcY1} A ${r} ${r} 0 1 1 ${cx + r * Math.cos(toRad(ARC_MAX_ANGLE))} ${cy + r * Math.sin(toRad(ARC_MAX_ANGLE))}`}
          fill="none"
          stroke="rgba(0,0,0,0.4)"
          strokeWidth={3}
          strokeLinecap="round"
        />
        {norm > 0 && (
          <path
            d={`M ${arcX1} ${arcY1} A ${r} ${r} 0 ${largeArc} 1 ${arcX2} ${arcY2}`}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
          />
        )}
        <circle cx={iX} cy={iY} r={3} fill={color} />
      </svg>
      <div className="dly-knob-label">{caption}</div>
      <div className="dly-knob-value">{valueNode}</div>
    </div>
  );
}

/** 리버브: CSS로 그린 동그란 마개(지시선은 `--angle`만큼 돈다) */
function CapFace({ caption, norm, valueNode, size, dial }: FaceProps) {
  const angle = -135 + norm * 270;

  return (
    <div className={`reverb-knob ${size === "small" ? "small" : "medium"}`}>
      <span>{caption}</span>
      <span className="reverb-knob-cap knob" style={{ "--angle": `${angle}deg` } as CSSProperties} {...dial} />
      <strong>{valueNode}</strong>
    </div>
  );
}

export const KNOB_FACES: Readonly<Record<KnobFaceName, ComponentType<FaceProps>>> = {
  eq: EqFace,
  trax: TraxFace,
  comp: CompFace,
  arc: ArcFace,
  cap: CapFace,
};
