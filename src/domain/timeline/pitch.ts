/**
 * 재생 배율과 음정(P4-4, 보고서 B4).
 * "템포 맞춤"은 지금 속도를 바꾸는 만큼 음정도 함께 바뀐다(재생 속도를 바꾸는 방식). 배율 r이면 음정은 12·log2(r)반음 달라진다.
 * 음정을 유지하는 방식(타임 스트레치)은 나중에 추가한다.
 */

/** 재생 배율 → 음정 변화(반음). 배율이 올바른 수가 아니면 0 */
export function rateToSemitones(rate: number): number {
  return Number.isFinite(rate) && rate > 0 ? 12 * Math.log2(rate) : 0;
}

/** 화면에 보일 글자. 소수 둘째 자리까지: 1.025배 → "+0.43반음", 0.9배 → "-1.82반음", 변화가 없으면 "0반음" */
export function formatSemitones(semitones: number): string {
  const rounded = Math.round(semitones * 100) / 100;
  if (rounded === 0 || !Number.isFinite(rounded)) return "0반음";
  return `${rounded > 0 ? "+" : "-"}${Math.abs(rounded).toFixed(2)}반음`;
}

/**
 * 재생 배율의 화면 글자. 소수 둘째 자리까지 보이되, 셋째 자리가 0이 아니면 셋째 자리까지 보인다(1.025배를 "1.02×"로
 * 잘못 읽지 않도록): 1 → "1.00×", 1.1 → "1.10×", 1.025 → "1.025×". 올바른 수가 아니면 "1.00×".
 */
export function formatPlaybackRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "1.00×";
  const fixed = rate.toFixed(3);
  return `${fixed.endsWith("0") ? fixed.slice(0, -1) : fixed}×`;
}
