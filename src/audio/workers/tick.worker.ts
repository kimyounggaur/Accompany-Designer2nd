/**
 * 예약기용 타이머. 배경 탭에서는 화면(메인 스레드)의 타이머가 늦어지지만 Worker의 타이머는 덜 늦어진다.
 * 메시지 `{ type: "start", interval }`을 받으면 그 간격(ms)마다 "tick"을 보내고, `{ type: "stop" }`을 받으면 멈춘다.
 */
interface TickCommand {
  type: "start" | "stop";
  interval?: number;
}

// 이 파일은 Worker 안에서 돌아가는데 lib.dom에는 Worker 전역이 없어서, 쓰는 부분만 좁혀 선언한다.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<TickCommand>) => void) | null;
  postMessage(message: string): void;
};

let timer: ReturnType<typeof setInterval> | undefined;

scope.onmessage = (event) => {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  if (event.data.type === "start") {
    timer = setInterval(() => scope.postMessage("tick"), event.data.interval ?? 25);
  }
};
