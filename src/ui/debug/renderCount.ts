/**
 * 다시 그리기 계수기(설계서 §P5-3 수용 기준: 재생 5초 동안 `Timeline` 다시 그리기 0회).
 *
 * 평소에는 아무 일도 하지 않는다. 시험이나 개발자가 `window.__renders = {}`를 만들어 두면 부품이 그려질 때마다 이름별로 센다
 * (배포 빌드에서도 켤 수 있다. React Profiler는 배포 빌드에서 꺼져 있어 쓰지 않았다).
 * 세는 곳은 "재생 중 다시 그려지면 안 되는 큰 부품"(타임라인·상단 바·툴바)뿐이다.
 */
export function countRender(name: string): void {
  const bag = (globalThis as { __renders?: Record<string, number> }).__renders;
  if (bag) bag[name] = (bag[name] ?? 0) + 1;
}
