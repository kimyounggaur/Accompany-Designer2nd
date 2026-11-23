import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { ko } from "../i18n/ko";
import { buildCrashReport } from "./crashReport";
import { markSkipRecoverOnce } from "./recoverFlag";

interface State {
  error?: unknown;
  componentStack?: string;
}

/**
 * 화면 부품에서 오류가 나면 빈 화면 대신 안내를 보인다.
 * 자동 저장은 앱 시작(bootstrap) 때 이미 켜져 있고 문서는 화면과 따로 저장되므로 "작업은 자동 저장되어 있다".
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? undefined });
    console.error(error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error === undefined) return this.props.children;
    return <CrashScreen error={this.state.error} componentStack={this.state.componentStack} />;
  }
}

function CrashScreen({ error, componentStack }: { error: unknown; componentStack?: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const report = buildCrashReport({
    error,
    componentStack,
    buildCommit: __BUILD_COMMIT__,
    buildTime: __BUILD_TIME__,
    now: new Date(),
    userAgent: navigator.userAgent,
    page: `${location.origin}${location.pathname}`,
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <main className="crash-screen" role="alert" data-testid="crash-screen">
      <h1 className="crash-screen__title">{ko.crash.title}</h1>
      <p className="crash-screen__message">{ko.crash.message}</p>
      <div className="crash-screen__actions">
        <button type="button" className="crash-screen__primary" onClick={() => location.reload()} data-testid="crash-reload">
          {ko.crash.reload}
        </button>
        <button type="button" onClick={() => void copy()} data-testid="crash-copy">
          {copyState === "copied" ? ko.crash.copied : ko.crash.copy}
        </button>
      </div>
      {copyState === "failed" && <p className="crash-screen__note">{ko.crash.copyFailed}</p>}
      <details className="crash-screen__details" open={copyState === "failed"}>
        <summary>{ko.crash.detailsSummary}</summary>
        <pre data-testid="crash-report">{report}</pre>
      </details>
      <p className="crash-screen__note">{ko.crash.skipRecoverHint}</p>
      <button
        type="button"
        className="crash-screen__secondary"
        onClick={() => {
          markSkipRecoverOnce();
          location.reload();
        }}
        data-testid="crash-skip-recover"
      >
        {ko.crash.skipRecover}
      </button>
    </main>
  );
}

/** 시험용: 주소에 `?crash=1`이 있으면 그리는 즉시 오류를 던져 위의 안내 화면을 확인할 수 있게 한다. */
export function CrashOnPurpose(): null {
  if (new URLSearchParams(location.search).get("crash") === "1") throw new Error("일부러 낸 화면 오류(?crash=1)");
  return null;
}
