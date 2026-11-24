/**
 * 점검 보고서(2026-11-12) 회귀 측정 스위트.
 * - 보고서가 '실측'한 항목을 같은 방법으로 다시 잰다.
 * - 아직 해결 전인 항목은 test.fail(…)로 표시한다. 고쳐지면 이 테스트가 '예상 밖 통과'로
 *   실패하므로, 그때 test.fail 줄을 지우면 된다(=해결 확인).
 * - 선택자는 S 한 곳에만 둔다. 화면 부품에는 data-testid를 붙여 두었으므로 CSS 이름이 바뀌어도(6단계) 깨지지 않는다.
 */
import { expect, test, type Download, type Locator, type Page, type TestInfo } from "@playwright/test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const WAV = path.join(here, "fixtures", "quiet-loud-8s.wav"); // 앞 4초 작게(0.05), 뒤 4초 크게(0.8)
const NOT_AUDIO = path.join(here, "fixtures", "not-audio.txt");
const STEADY = path.join(here, "fixtures", "steady-220hz-12s.wav"); // 12초 내내 같은 크기(0.5)의 220Hz — 엔진이 만드는 클릭만 재기 위한 음원
const HOUR = path.join(here, "fixtures", "loud-quiet-220hz-1h.wav"); // 1시간, 앞 30분 0.8 · 뒤 30분 0.2의 220Hz(8kHz 모노라 57.6 MB) — P4-3 긴 음원 시험
const CLICK_10MIN = path.join(here, "fixtures", "click-120bpm-10min.wav"); // 10분, 120 BPM 클릭 곡(8kHz 모노라 9.6 MB) — P4-4 BPM 감지 시험

/** 모든 시험을 한 엔진으로 돌려 비교할 때: E2E_ENGINE=v1|v2. 비우면 앱의 기본 엔진(v2, P3 기본 전환 이후). 옛 엔진 전체 돌리기는 E2E_ENGINE=v1. 주소에 engine이 이미 있으면 그대로 둔다. */
const ENGINE = process.env.E2E_ENGINE;
function withEngine(query = "") {
  if (!ENGINE) return query;
  const params = new URLSearchParams(query);
  if (!params.has("engine")) params.set("engine", ENGINE);
  return `?${params}`;
}

const S = {
  inspector: '[data-testid="inspector"]',
  transport: '[data-testid="topbar"]',
  status: '[data-testid="status-line"]',
  upload: '[data-testid="upload-input"]',
  play: '[data-testid="transport-play"]',
  stop: '[data-testid="transport-stop"]',
  record: '[data-testid="transport-record"]',
  zoomOut: 'button[title="축소"]',
  tempo: '[data-testid="tempo-input"]',
  ruler: '[data-testid="ruler"]',
  clip: '[data-testid="clip"]',
  trackVolume: '[data-testid="track-volume"]',
  trackName: '[data-testid="track-name"]',
  timeDisplay: '[data-testid="time-display"]',
  statusbar: '[data-testid="statusbar"]',
  trackHeader: '[data-testid="track-header"]',
  fileMenuTrigger: '[data-testid="file-menu-trigger"]',
  fileMenuPanel: '[data-testid="file-menu-panel"]',
  recordOptionsToggle: '[data-testid="record-options-toggle"]',
  countIn: 'select[aria-label="녹음 카운트인"]',
  inspectorToggle: '[data-testid="inspector-toggle"]',
  warpToggle: '[data-testid="warp-toggle"]',
  projectInput: '[data-testid="project-input"]',
  toast: '[data-testid="toast"]',
  confirmDialog: '[data-testid="confirm-dialog"]',
  confirmOk: '[data-testid="confirm-ok"]',
  confirmCancel: '[data-testid="confirm-cancel"]',
  layoutNotice: '[data-testid="layout-notice"]',
  layoutNoticeDismiss: '[data-testid="layout-notice-dismiss"]',
  eqBassKnob: '[role=slider][aria-label="저음 이퀄라이저"]',
  autosave: '[data-testid="autosave-status"]',
  crashScreen: '[data-testid="crash-screen"]',
  exportDialog: '[data-testid="export-dialog"]',
  exportSummary: '[data-testid="export-summary"]',
  exportStart: '[data-testid="export-start"]',
  exportCancel: '[data-testid="export-cancel"]',
  exportProgress: '[data-testid="export-progress"]',
  exportSampleRate: '[data-testid="export-sample-rate"]',
  exportBitDepth: '[data-testid="export-bit-depth"]',
  relinkDialog: '[data-testid="relink-dialog"]',
  relinkRow: '[data-testid="relink-row"]',
  relinkInput: '[data-testid="relink-input"]',
  relinkConfirm: '[data-testid="relink-confirm"]',
  relinkClose: '[data-testid="relink-close"]',
  zoomFit: '[data-testid="zoom-fit"]',
  waveform: '[data-testid="clip-waveform"]',
  timelineScroll: ".timeline-scroll",
  sourceBpm: '[data-testid="source-bpm-input"]',
  warpRate: '[data-testid="warp-rate"]',
  warpPitch: '[data-testid="warp-pitch"]',
  clipGain: '[data-testid="clip-gain"]',
  clipGainInput: '[data-testid="clip-gain-input"]',
  masterVolume: '[data-testid="master-volume"]',
  masterVolumeInput: '[data-testid="master-volume-input"]',
  masterVolumeValue: '[data-testid="master-volume-value"]',
  bpmDetect: '[data-testid="bpm-detect"]',
  bpmProgress: '[data-testid="bpm-progress"]',
  bpmCancel: '[data-testid="bpm-cancel"]',
  bpmResult: '[data-testid="bpm-result"]',
  bpmResultText: '[data-testid="bpm-result-text"]',
  bpmHalf: '[data-testid="bpm-half"]',
  bpmDouble: '[data-testid="bpm-double"]',
  bpmApplyClip: '[data-testid="bpm-apply-clip"]',
  bpmApplyProject: '[data-testid="bpm-apply-project"]',
  bpmStatus: '[data-testid="bpm-status"]',
};

/** 소리 소스 시작 횟수, rAF 호출 수, 최종 출력 분석기를 잡아 두는 측정 훅 */
const PROBES = `(() => {
  window.__starts = 0;
  window.__startLog = [];
  window.__stopLog = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { window.__starts++; window.__startLog.push([this.context.currentTime, ...a]); return start.apply(this, a); };
  const stop = AudioScheduledSourceNode.prototype.stop;
  AudioScheduledSourceNode.prototype.stop = function (...a) { window.__stopLog.push([this.context.currentTime, ...a]); return stop.apply(this, a); };
  window.__raf = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { window.__raf++; return raf(cb); };
  window.__destGains = [];
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (this instanceof AnalyserNode && dest instanceof AudioDestinationNode) window.__out = this;
    // 스피커에 곧바로 이어지는 이득 노드(모니터 길의 입구, 프로브의 소리 없는 가지). 모니터 길은 이득이 0보다 크다.
    if (this instanceof GainNode && dest instanceof AudioDestinationNode) window.__destGains.push(this);
    // 워크렛(리미터)에 이어지는 이득 노드 = 마스터 입력. 리미터 앞 신호를 재려고 잡아 둔다.
    if (this instanceof GainNode && typeof AudioWorkletNode !== "undefined" && dest instanceof AudioWorkletNode) window.__limiterIn = this;
    return connect.call(this, dest, ...rest);
  };
})();`;

async function openApp(page: Page, options: { layoutNotice?: boolean; query?: string } = {}) {
  await page.addInitScript(PROBES);
  if (!options.layoutNotice) {
    // P2-2: 처음 한 번 뜨는 '화면 배치가 바뀌었습니다' 카드가 다른 측정을 가리지 않도록 본 것으로 해 둔다.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("ad.ui.layoutNoticeSeen", "1");
      } catch {
        /* 저장소를 못 쓰는 환경 */
      }
    });
  }
  await page.goto(`/${withEngine(options.query)}`);
  await page.locator(S.inspector).waitFor();
  await page.waitForTimeout(1200); // 자동 저장 복구가 끝날 때까지
}

async function upload(page: Page, file = WAV) {
  const before = await page.locator(S.clip).count();
  await page.setInputFiles(S.upload, file);
  if (file === NOT_AUDIO) await page.waitForTimeout(800);
  else await expect(page.locator(S.clip)).toHaveCount(before + 1);
}

const starts = (page: Page) => page.evaluate(() => (window as any).__starts as number);

async function setRange(page: Page, selector: string, value: number) {
  await page.locator(selector).first().evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function outputPeak(page: Page, ms = 1000) {
  return page.evaluate(async (duration) => {
    const a = (window as any).__out as AnalyserNode | undefined;
    if (!a) return -1;
    const buf = new Float32Array(a.fftSize);
    let peak = 0;
    for (let t = 0; t < duration; t += 25) {
      a.getFloatTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      await new Promise((r) => setTimeout(r, 25));
    }
    return peak;
  }, ms);
}

const strFromBytes = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

// ───────────────────────── 1순위 ─────────────────────────

test.describe("A2 화면 폭", () => {
  for (const width of [1024, 1280, 1366, 1440, 1536, 1680, 1920]) {
    test(`${width}px에서 오른쪽 패널 전체가 보이고 가로 넘침이 없다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openApp(page);
      const box = await page.locator(S.inspector).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(width);
      await expect(page.locator(S.status)).toBeInViewport();
    });
  }

  test("상단 바 높이: 1280~1599px은 두 줄(≤112px), 1600px 이상은 한 줄(≤72px)", async ({ page }) => {
    for (const [width, max] of [[1280, 112], [1440, 112], [1680, 72], [1920, 72]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await openApp(page);
      const h = (await page.locator(S.transport).boundingBox())!.height;
      expect(h, `${width}px`).toBeLessThanOrEqual(max);
    }
  });
});

test.describe("P2-1 화면 틀", () => {
  test("1280×720에서 트랙 3개가 스크롤 없이 보인다", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openApp(page);
    await page.locator('button[title="트랙 추가"]').click();
    await page.locator('button[title="트랙 추가"]').click();
    const headers = page.locator(S.trackHeader);
    await expect(headers).toHaveCount(3);
    const statusTop = (await page.locator(S.statusbar).boundingBox())!.y;
    const last = (await headers.last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(statusTop);
  });

  test("확대 단추는 어느 폭에서도 한 군데에만 있다", async ({ page }) => {
    for (const width of [1100, 1440, 1680]) {
      await page.setViewportSize({ width, height: 900 });
      await openApp(page);
      await expect(page.locator(S.zoomOut), `${width}px`).toHaveCount(1);
    }
  });

  test("녹음 옵션: 1280~1599px은 펼쳐 보이고, 1279px 이하는 '녹음 설정' 팝오버로 접힌다", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await expect(page.locator(S.countIn)).toBeVisible();
    await expect(page.locator(S.recordOptionsToggle)).toHaveCount(0);
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(page.locator(S.countIn)).toHaveCount(0);
    await page.locator(S.recordOptionsToggle).click();
    await expect(page.locator(S.countIn)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(S.countIn)).toHaveCount(0);
  });

  test("파일 메뉴 하나에 올리기·열기·저장·내보내기·음원 다시 연결이 모여 있고 Esc로 닫힌다", async ({ page }) => {
    await openApp(page);
    const trigger = page.locator(S.fileMenuTrigger);
    await trigger.click();
    const items = page.locator(`${S.fileMenuPanel} [role="menuitem"]`);
    await expect(items).toHaveCount(5); // P4-2에서 "음원 다시 연결"이 맨 아래에 늘었다(저장은 계속 3번째)
    await expect(items).toHaveText([/오디오 업로드/, /프로젝트 불러오기/, /프로젝트 저장/, /믹스 WAV 내보내기/, /음원 다시 연결/]);
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(S.fileMenuPanel)).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("템포 맞춤은 상단 바가 아니라 오른쪽 '클립' 칸에 있고, 처음에는 꺼져 있다", async ({ page }) => {
    await openApp(page);
    await expect(page.locator(S.transport)).not.toContainText("WARP");
    await expect(page.locator(S.transport)).not.toContainText("템포 맞춤");
    await upload(page);
    await page.locator(S.clip).first().click({ position: { x: 60, y: 40 } });
    const toggle = page.locator(`${S.inspector} ${S.warpToggle}`);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  test("오른쪽 패널 접기·펴기는 새로고침해도 기억된다", async ({ page }) => {
    await openApp(page);
    await expect(page.locator(S.inspector)).toBeVisible();
    await page.locator(S.inspectorToggle).click();
    await expect(page.locator(S.inspector)).toBeHidden();
    await page.reload();
    await page.locator(S.statusbar).waitFor();
    await expect(page.locator(S.inspector)).toBeHidden();
    await page.locator(S.inspectorToggle).click();
    await expect(page.locator(S.inspector)).toBeVisible();
  });

  test("칸을 접으면 새로고침해도 접힌 채로 있다", async ({ page }) => {
    await openApp(page);
    const toggle = page.locator('[data-panel="clip"] .panel-section__toggle');
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.reload();
    await expect(page.locator('[data-panel="clip"] .panel-section__toggle')).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("P2-2 안내 통로", () => {
  test("자동 저장 복구 뒤 '복구했습니다' 안내가 다른 안내에 덮이지 않는다", async ({ page }) => {
    await openApp(page);
    await upload(page);
    await page.waitForTimeout(2000); // 자동 저장 지연(1.2초) 이후
    await page.reload();
    await expect(page.locator(S.clip)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator(S.status)).toContainText("자동 저장된 프로젝트와 음원을 복구했습니다");
    await page.waitForTimeout(1500);
    await expect(page.locator(S.status)).toContainText("자동 저장된 프로젝트와 음원을 복구했습니다");
  });

  test("오류 토스트는 10초가 지나도 남아 있고, 닫기 단추로 닫힌다", async ({ page }) => {
    await openApp(page);
    await upload(page, NOT_AUDIO);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("not-audio.txt");
    await page.waitForTimeout(10_500);
    await expect(alert).toBeVisible();
    await alert.getByRole("button", { name: "안내 닫기" }).click();
    await expect(alert).toHaveCount(0);
  });

  test("완료 토스트는 3초쯤 뒤 사라지지만 상태 줄에는 마지막 안내가 남는다", async ({ page }) => {
    await openApp(page);
    await upload(page);
    const toast = page.locator(S.toast).filter({ hasText: "업로드 완료" });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCount(0, { timeout: 6000 });
    await expect(page.locator(S.status)).toContainText("업로드 완료");
  });

  test("같은 오류가 반복되면 토스트를 늘리지 않고 ×2로 센다", async ({ page }) => {
    await openApp(page);
    await upload(page, NOT_AUDIO);
    await upload(page, NOT_AUDIO);
    await expect(page.locator(S.toast)).toHaveCount(1);
    await expect(page.locator(S.toast)).toContainText("×2");
  });

  test("도구를 바꾸는 단축키는 안내 문구를 바꾸지 않는다(툴바가 이미 보여 줌)", async ({ page }) => {
    await openApp(page);
    await upload(page, NOT_AUDIO);
    const before = await page.locator(S.status).innerText();
    for (const key of ["KeyP", "KeyB", "KeyE", "KeyV"]) await page.keyboard.press(key);
    await expect(page.locator(S.status)).toHaveText(before);
  });

  test("되돌릴 작업이 없을 때 Ctrl+Z는 상태 줄에만 알린다(토스트 없음)", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("Control+KeyZ");
    await expect(page.locator(S.status)).toHaveText("실행 취소할 작업이 없습니다.");
    await expect(page.locator(S.toast)).toHaveCount(0);
  });

  test("트랙 삭제는 앱 안의 확인창을 거치고, 취소하면 그대로다", async ({ page }) => {
    const nativeDialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      nativeDialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await openApp(page);
    await page.locator('button[title="트랙 추가"]').click();
    await expect(page.locator(S.trackHeader)).toHaveCount(2);
    const remove = page.locator(S.trackHeader).nth(1).locator('button[title="트랙 삭제"]');

    await remove.click();
    const dialog = page.locator(S.confirmDialog);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("'트랙 2' 트랙과 클립 0개를 삭제할까요?");
    await expect(page.locator(S.confirmCancel)).toBeFocused(); // 되돌리기 어려운 작업은 취소에 초점
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator(S.trackHeader)).toHaveCount(2);

    await remove.click();
    await page.locator(S.confirmOk).click();
    await expect(page.locator(S.trackHeader)).toHaveCount(1);
    await expect(page.locator(S.status)).toContainText("트랙 2 트랙이 삭제되었습니다");
    expect(nativeDialogs).toEqual([]);
  });

  test("확인창이 열려 있는 동안 Delete·Space 단축키는 뒤의 화면에 작용하지 않는다", async ({ page }) => {
    await openApp(page);
    await upload(page); // 올린 클립은 선택된 상태
    await page.locator('button[title="트랙 추가"]').click();
    await page.locator(S.trackHeader).nth(1).locator('button[title="트랙 삭제"]').click();
    await expect(page.locator(S.confirmDialog)).toBeVisible();
    const base = await starts(page);
    await page.keyboard.press("Delete");
    await page.keyboard.press("Space"); // 초점이 '취소'에 있으므로 확인창만 닫힌다
    await expect(page.locator(S.confirmDialog)).toBeHidden();
    await page.waitForTimeout(300);
    expect(await starts(page)).toBe(base); // 재생이 시작되지 않음
    await expect(page.locator(S.clip)).toHaveCount(1); // 클립이 지워지지 않음
    await expect(page.locator(S.trackHeader)).toHaveCount(2); // 취소했으므로 트랙도 그대로
  });

  test("프로젝트 불러오기는 확인창을 거치고, 불러오면 완료 안내가 뜬다", async ({ page }, testInfo) => {
    const nativeDialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      nativeDialogs.push(dialog.message());
      await dialog.dismiss();
    });
    await openApp(page);
    await upload(page);
    await page.locator(S.fileMenuTrigger).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(`${S.fileMenuPanel} [role="menuitem"]`).nth(2).click(),
    ]);
    // 파일 이름에 한글이 섞인 경로는 브라우저가 못 읽는 경우가 있어, 영문 임시 경로에 저장한다.
    const saved = path.join(os.tmpdir(), `ad2-saved-project-${testInfo.workerIndex}-${Date.now()}.adproj`);
    await download.saveAs(saved);
    await expect(page.locator(S.status)).toContainText("프로젝트 파일을 저장했습니다");

    await page.setInputFiles(S.projectInput, saved);
    const dialog = page.locator(S.confirmDialog);
    await expect(dialog).toBeVisible();
    await page.locator(S.confirmCancel).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(S.clip)).toHaveCount(1);

    await page.setInputFiles(S.projectInput, saved);
    await page.locator(S.confirmOk).click();
    await expect(page.locator(S.status)).toContainText("프로젝트와 음원을 불러왔습니다");
    expect(nativeDialogs).toEqual([]);
    fs.rmSync(saved, { force: true });
  });

  test("화면 배치 안내는 처음 한 번 뜨고, '다시 보지 않기'를 누르면 다시 뜨지 않는다", async ({ page }) => {
    await openApp(page, { layoutNotice: true });
    const notice = page.locator(S.layoutNotice);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("화면 배치가 바뀌었습니다");
    await notice.getByRole("button", { name: "닫기" }).click(); // 이번에만 숨김
    await expect(notice).toBeHidden();
    await page.reload();
    await expect(page.locator(S.layoutNotice)).toBeVisible();
    await page.locator(S.layoutNoticeDismiss).click();
    await page.reload();
    await page.locator(S.statusbar).waitFor();
    await expect(page.locator(S.layoutNotice)).toHaveCount(0);
  });
});

test.describe("A3 재생 중 변경", () => {
  test("볼륨 10단계와 트랙 이름 8글자 입력에 소리 소스가 다시 시작되지 않는다", async ({ page }) => {
    await openApp(page);
    await upload(page);
    await page.click(S.play);
    await page.waitForTimeout(500);
    const base = await starts(page);
    for (let i = 0; i < 10; i++) await setRange(page, S.trackVolume, 0.5 + i * 0.03);
    const name = page.locator(S.trackName).first();
    await name.click();
    await name.press("End");
    await name.pressSequentially("abcdefgh", { delay: 20 });
    await page.keyboard.press("Tab");
    await page.waitForTimeout(300);
    expect(await starts(page)).toBe(base);
  });
});

test.describe("A4·A5 자동 저장과 복구", () => {
  test("새로고침 뒤 클립과 소리가 돌아온다", async ({ page }) => {
    await openApp(page);
    await upload(page);
    await page.waitForTimeout(2000); // 자동 저장 지연(1.2초) 이후
    await page.reload();
    await expect(page.locator(S.clip)).toHaveCount(1, { timeout: 5000 });
    const base = await starts(page);
    await page.click(S.play);
    await page.waitForTimeout(500);
    expect(await starts(page)).toBeGreaterThan(base);
  });
});

test.describe("P2-4 자동 저장 서비스", () => {
  /** 템포 칸에 값을 넣어 문서를 바꾼다(저장 대상 변경). */
  async function setTempo(page: Page, value: string) {
    const tempo = page.locator(S.tempo);
    await tempo.click();
    await tempo.press("Control+a");
    await tempo.pressSequentially(value);
    await tempo.press("Enter");
  }

  /** 저장소(IndexedDB)의 현재 모양을 읽는다. */
  async function dumpDb(page: Page) {
    return page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("accompany-designer");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const keys = (store: string) =>
        new Promise<IDBValidKey[]>((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).getAllKeys();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const result = {
        version: db.version,
        stores: [...db.objectStoreNames].sort(),
        projects: await keys("projects"),
        assets: await keys("assets"),
        meta: await keys("meta"),
      };
      db.close();
      return result;
    });
  }

  test("바꾼 뒤 1.2초 안에는 저장하지 않고, 저장되면 '자동 저장됨 시:분'이 보인다", async ({ page }) => {
    await openApp(page);
    await expect(page.locator(S.autosave)).toHaveAttribute("data-state", "idle");
    await setTempo(page, "95");
    await page.waitForTimeout(500);
    await expect(page.locator(S.autosave)).toHaveAttribute("data-state", "idle"); // 아직 1.2초 전
    await expect(page.locator(S.autosave)).toHaveText(/^자동 저장됨 \d{2}:\d{2}$/, { timeout: 3000 });
    await expect(page.locator(S.autosave)).toHaveAttribute("data-state", "saved");
  });

  for (const how of ["pagehide", "visibilitychange"] as const) {
    test(`${how === "pagehide" ? "페이지를 떠날 때" : "탭이 가려질 때"}는 1.2초를 기다리지 않고 바로 저장한다`, async ({ page }) => {
      await openApp(page);
      await setTempo(page, "95");
      await page.evaluate((event) => {
        if (event === "pagehide") window.dispatchEvent(new Event("pagehide"));
        else {
          Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
          document.dispatchEvent(new Event("visibilitychange"));
        }
      }, how);
      // 평소 저장은 1.2초 뒤이므로, 0.8초 안에 저장됐다면 바로 저장한 것이다.
      await expect(page.locator(S.autosave)).toHaveText(/^자동 저장됨 \d{2}:\d{2}$/, { timeout: 800 });
      await page.reload();
      await page.locator(S.statusbar).waitFor();
      await expect(page.locator(S.tempo)).toHaveValue("95");
    });
  }

  test("옛 자동 저장(v1)이 있으면 복구하고 새 구조(v2)로 옮긴 뒤, 새 구조에서 이어서 저장된다", async ({ page }) => {
    // 앱을 열기 전에, 같은 출처의 빈 페이지에서 예전 버전이 만들던 데이터베이스(v1)를 그대로 만들어 둔다.
    await page.goto("/favicon.svg");
    await page.evaluate(async (wavBase64) => {
      const audio = new Blob([Uint8Array.from(atob(wavBase64), (c) => c.charCodeAt(0))], { type: "audio/wav" });
      const project = {
        id: "legacy-project",
        name: "옛 세션",
        bpm: 100,
        sampleRate: 44100,
        tracks: [
          {
            id: "t1",
            name: "트랙 1",
            volume: 0.86,
            pan: 0,
            muted: false,
            solo: false,
            clips: [
              { id: "c1", audioBufferId: "a1", trackId: "t1", name: "옛 음원", startTime: 0, offset: 0, duration: 8, sourceBpm: 100, stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0 },
            ],
          },
        ],
        audioAssets: { a1: { id: "a1", fileName: "옛 음원.wav", duration: 8, sampleRate: 44100, channels: 2, waveformPeaks: [0, 0.5, 1] } },
        timeMarkers: [],
      };
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("accompany-designer", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("projects");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("projects", "readwrite");
          tx.objectStore("projects").put({ format: "accompany-designer-project", version: 1, project, audio: { a1: audio } }, "autosave");
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    }, fs.readFileSync(WAV).toString("base64"));

    await openApp(page);
    await expect(page.locator(S.clip)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator(S.tempo)).toHaveValue("100");
    await expect(page.locator(S.status)).toContainText("자동 저장된 프로젝트와 음원을 복구했습니다");
    await expect(page.locator(S.autosave)).toHaveText(/^자동 저장됨 \d{2}:\d{2}$/); // 복구한 기록의 저장 시각

    const moved = await dumpDb(page);
    expect(moved.version).toBe(2);
    expect(moved.stores).toEqual(["assets", "meta", "peaks", "projects"]);
    expect(moved.projects).toEqual(["legacy-project"]); // 옛 "autosave" 칸은 사라지고 프로젝트 id 칸이 생겼다
    expect(moved.assets).toHaveLength(1);
    expect(moved.meta).toEqual(["lastProjectId"]);

    // 옮긴 뒤에도 같은 방식으로 저장·복구된다.
    await setTempo(page, "88");
    await page.waitForTimeout(2000);
    await page.reload();
    await page.locator(S.statusbar).waitFor();
    await expect(page.locator(S.clip)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator(S.tempo)).toHaveValue("88");
    expect((await dumpDb(page)).assets).toHaveLength(1); // 같은 음원은 다시 쌓이지 않는다
  });

  test("같은 음원을 두 번 올려도 저장소에는 한 번만 담긴다", async ({ page }) => {
    await openApp(page);
    await upload(page);
    await upload(page);
    await expect(page.locator(S.autosave)).toHaveText(/^자동 저장됨 \d{2}:\d{2}$/, { timeout: 4000 });
    await page.waitForTimeout(500);
    const state = await dumpDb(page);
    expect(state.assets).toHaveLength(1);
    expect(state.projects).toHaveLength(1);
  });

  test("녹음 중에는 저장하지 않고 닫으려 하면 경고하며, 녹음이 끝나면 저장되어 새로고침 뒤에도 남는다", async ({ page }) => {
    await openApp(page);
    await page.click('button[title="보컬 녹음"]');
    await page.waitForTimeout(2600); // 저장 지연(1.2초)을 두 번 넘긴다
    await expect(page.locator(S.autosave)).toHaveAttribute("data-state", "idle"); // 녹음 중에는 저장하지 않았다

    const dialog = page.waitForEvent("dialog");
    await page.evaluate(() => setTimeout(() => window.location.reload(), 0));
    const warning = await dialog;
    expect(warning.type()).toBe("beforeunload");
    await warning.dismiss(); // 머무르기

    await page.click(S.stop);
    await expect(page.locator(S.autosave)).toHaveText(/^자동 저장됨 \d{2}:\d{2}$/, { timeout: 5000 });
    await page.reload(); // 저장이 끝났으니 경고 없이 새로고침된다
    await page.locator(S.statusbar).waitFor();
    await expect(page.locator(S.clip)).toHaveCount(1, { timeout: 5000 });
  });

  test("저장이 끝난 뒤에는 닫을 때 경고가 없다", async ({ page }) => {
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.type());
      await dialog.dismiss();
    });
    await openApp(page);
    await setTempo(page, "95");
    await expect(page.locator(S.autosave)).toHaveText(/^자동 저장됨 \d{2}:\d{2}$/, { timeout: 4000 });
    await page.reload();
    await page.locator(S.statusbar).waitFor();
    expect(dialogs).toEqual([]);
  });

  test("저장 공간이 가득 차면 오류 안내와 [프로젝트 파일로 저장] 단추가 뜨고, 공간이 생기면 다시 저장된다", async ({ page }) => {
    // 프로젝트 기록을 쓸 때 브라우저가 '저장 공간 부족'을 돌려주는 상황을 흉내 낸다.
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
        if ((window as any).__quotaFull && this.name === "projects") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        return put.apply(this, args);
      };
    });
    await openApp(page);
    await page.evaluate(() => ((window as any).__quotaFull = true));
    await setTempo(page, "95");

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("브라우저 저장 공간이 부족해 자동 저장하지 못했습니다", { timeout: 4000 });
    await expect(page.locator(S.autosave)).toHaveText("자동 저장 실패");
    await expect(page.locator(S.autosave)).toHaveAttribute("data-state", "failed");

    // 저장 못 한 변경이 남아 있으니 닫을 때 경고한다.
    const dialog = page.waitForEvent("dialog");
    await page.evaluate(() => setTimeout(() => window.location.reload(), 0));
    const warning = await dialog;
    expect(warning.type()).toBe("beforeunload");
    await warning.dismiss();

    // 단추로 프로젝트 파일을 내려받을 수 있다.
    const download = page.waitForEvent("download");
    await alert.getByRole("button", { name: "프로젝트 파일로 저장" }).click();
    const saved = path.join(os.tmpdir(), `ad2-quota-${Date.now()}.adproj`);
    await (await download).saveAs(saved); // 파일 이름은 운영체제 글자 처리에 따라 달라지므로 내용으로 확인한다
    const file = JSON.parse(strFromBytes(unzipSync(new Uint8Array(fs.readFileSync(saved)))["project.json"]));
    expect(file.format).toBe("accompany-designer-project");
    expect(file.schemaVersion).toBe(2);
    expect(file.doc.bpm).toBe(95); // 저장하지 못한 변경도 파일에는 들어 있다
    fs.rmSync(saved, { force: true });

    // 공간이 생기면 다음 변경부터 다시 저장된다.
    await page.evaluate(() => ((window as any).__quotaFull = false));
    await setTempo(page, "96");
    await expect(page.locator(S.autosave)).toHaveText(/^자동 저장됨 \d{2}:\d{2}$/, { timeout: 4000 });
  });

  test("음원을 처음 저장한 뒤에 보존을 요청하고, 저장 공간을 80% 넘게 쓰면 한 번만 경고한다", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as any;
      w.__persist = 0;
      w.__estimate = 0;
      Object.defineProperty(navigator.storage, "persist", { configurable: true, value: async () => (w.__persist += 1, true) });
      Object.defineProperty(navigator.storage, "estimate", { configurable: true, value: async () => (w.__estimate += 1, { usage: 85, quota: 100 }) });
    });
    await openApp(page);
    await setTempo(page, "95"); // 음원이 없는 저장
    await expect(page.locator(S.autosave)).toHaveText(/^자동 저장됨/, { timeout: 4000 });
    await expect(page.locator(S.toast).filter({ hasText: "브라우저 저장 공간을 85% 사용 중입니다" })).toHaveCount(1);
    expect(await page.evaluate(() => (window as any).__persist)).toBe(0);

    await upload(page);
    await page.waitForTimeout(2200);
    expect(await page.evaluate(() => (window as any).__persist)).toBe(1);
    await setTempo(page, "96");
    await page.waitForTimeout(2200);
    expect(await page.evaluate(() => (window as any).__persist)).toBe(1); // 한 번만
    expect(await page.evaluate(() => (window as any).__estimate)).toBe(1); // 경고한 뒤에는 더 묻지 않는다
  });
});

test.describe("P3-0 안전망", () => {
  test("화면 오류가 나면 빈 화면 대신 안내가 보이고, 오류 내용을 복사할 수 있다", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(PROBES);
    await page.goto("/?crash=1");
    const screen = page.locator(S.crashScreen);
    await expect(screen).toBeVisible();
    await expect(screen).toContainText("문제가 생겨 화면을 다시 그려야 합니다. 작업은 자동 저장되어 있습니다.");
    await expect(screen.getByRole("button", { name: "새로고침" })).toBeVisible();
    await expect(page.locator(S.inspector)).toHaveCount(0); // 깨진 화면이 아니라 안내만

    await screen.getByRole("button", { name: "오류 내용 복사" }).click();
    await expect(screen.getByRole("button", { name: "복사했습니다" })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^반주 디자이너 2 오류 내용\n빌드: (local|[0-9a-f]{7})/);
    expect(copied).toContain("일부러 낸 화면 오류(?crash=1)");
    expect(copied).not.toContain("?crash=1\n주소"); // 주소에는 쿼리를 싣지 않는다
  });

  test("[새로고침]은 다시 불러오고, 오류가 없는 주소에서는 앱이 정상으로 뜬다", async ({ page }) => {
    await page.goto("/?crash=1");
    await page.locator(S.crashScreen).waitFor();
    await page.goto("/");
    await expect(page.locator(S.inspector)).toBeVisible();
    await expect(page.locator(S.crashScreen)).toHaveCount(0);
  });

  test("[저장된 작업 없이 시작]은 다음 시작 한 번만 복구를 건너뛰고, 저장된 기록은 그대로 둔다", async ({ page }) => {
    await openApp(page);
    await upload(page);
    await page.waitForTimeout(2000); // 자동 저장 지연(1.2초) 이후
    await page.goto("/?crash=1");
    await page.locator(S.crashScreen).getByRole("button", { name: "저장된 작업 없이 시작" }).click();
    await page.waitForLoadState();
    await page.goto("/"); // 오류가 없는 주소로
    await page.locator(S.inspector).waitFor();
    await page.waitForTimeout(1500);
    await expect(page.locator(S.clip)).toHaveCount(0); // 이번에는 복구하지 않았다
    await page.reload();
    await expect(page.locator(S.clip)).toHaveCount(1, { timeout: 5000 }); // 기록은 남아 있어 다음에는 복구된다
  });

  test("잡히지 않은 오류와 처리되지 않은 약속 거절이 오류 안내로 보이고, 무해한 브라우저 경고는 보이지 않는다", async ({ page }) => {
    await openApp(page);
    await page.evaluate(() =>
      window.dispatchEvent(new ErrorEvent("error", { message: "ResizeObserver loop completed with undelivered notifications." })),
    );
    await page.waitForTimeout(300);
    await expect(page.getByRole("alert")).toHaveCount(0);

    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("boom");
      }, 0);
    });
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("동작 실패: 예상하지 못한 문제가 생겼습니다.");
    await expect(alert.getByTestId("toast-details")).toContainText("boom"); // 원문은 접힌 '자세히 보기'에만

    await page.evaluate(() => {
      void Promise.reject(new Error("rejected"));
    });
    await expect(alert).toContainText("×2");
  });

  test("?probe=1에서 조작 없이 3초 재생하면 스피커 신호에 튐이 0회이고, 주소에 없으면 프로브가 붙지 않는다", async ({ page }) => {
    await openApp(page, { query: "?probe=1" });
    await upload(page);
    await page.waitForFunction(() => typeof (window as any).__probeReset === "function");
    await page.evaluate(() => (window as any).__probeReset());
    await page.click(S.play);
    await page.waitForTimeout(3000);
    const probe = await page.evaluate(() => (window as any).__probe as { jumps: number; gaps: number; peak: number; longestGapMs: number });
    expect(probe.peak).toBeGreaterThan(0.01); // 소리가 실제로 나갔다
    expect(probe.jumps).toBe(0);
    expect(probe.gaps).toBe(0);
  });

  test("프로브는 일부러 만든 클릭과 끊김을 실제로 센다(측정기 자체 점검)", async ({ page }) => {
    await openApp(page, { query: "?probe=1" });
    await upload(page); // 오디오 컨텍스트와 마스터 출력을 만든다
    await page.waitForFunction(() => typeof (window as any).__probeReset === "function" && !!(window as any).__out);
    await page.evaluate(() => (window as any).__probeReset());
    await page.evaluate(async () => {
      const out = (window as any).__out as AnalyserNode;
      const context = out.context as AudioContext;
      // 직류 0.9를 갑자기 켰다가(클릭) 0.2초 뒤 갑자기 끈다(소리가 난 뒤 무음이 이어짐 = 끊김)
      const source = context.createConstantSource();
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.setValueAtTime(0.9, context.currentTime + 0.05);
      gain.gain.setValueAtTime(0, context.currentTime + 0.25);
      source.connect(gain);
      gain.connect(out);
      source.start();
      source.stop(context.currentTime + 0.6);
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    const probe = await page.evaluate(() => (window as any).__probe as { jumps: number; gaps: number; peak: number; longestGapMs: number });
    expect(probe.jumps).toBeGreaterThanOrEqual(2); // 켤 때 1, 끌 때 1
    expect(probe.gaps).toBeGreaterThanOrEqual(1);
    expect(probe.longestGapMs).toBeGreaterThan(3);
    expect(probe.peak).toBeGreaterThan(0.8);
  });

  test("프로브는 주소에 ?probe=1이 있을 때만 붙는다", async ({ page }) => {
    await openApp(page);
    await upload(page);
    await page.click(S.play);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as any).__probe)).toBeUndefined();
  });
});

// ───────────────────────── P3-2 새 재생 엔진 ─────────────────────────
// 새 엔진(v2)이 기본이지만, 3단계 시험은 주소에 engine을 분명히 적어 어느 엔진으로 돌았는지 흔들리지 않게 한다. 같은 시험을 옛 엔진으로 돌려 수치만 비교하려면 E2E_P32_ENGINE=v1(그때는 v2 전용 판정을 건너뛴다).

const P32_ENGINE = process.env.E2E_P32_ENGINE === "v1" ? "v1" : "v2";
const P32_QUERY = `?engine=${P32_ENGINE}&probe=1`;
const onNewEngine = P32_ENGINE === "v2";

type ProbeReport = { jumps: number; gaps: number; peak: number; longestGapMs: number; jumpLog: [number, number, number][] };

/** (진단) 튄 지점 가까이에서 있었던 소리 시작·정지를 모아 한 줄로 */
async function explainJumps(page: Page, probe: ProbeReport) {
  const logs = await page.evaluate(() => ({ starts: (window as any).__startLog as number[][], stops: (window as any).__stopLog as number[][] }));
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return probe.jumpLog.map(([at, prev, value]) => ({
    at: r(at), prev: r(prev), value: r(value),
    starts: logs.starts.filter((row) => Math.abs((row[1] ?? row[0]) - at) < 0.08 || Math.abs(row[0] - at) < 0.08).map((row) => row.map(r)),
    stops: logs.stops.filter((row) => Math.abs((row[1] ?? row[0]) - at) < 0.08 || Math.abs(row[0] - at) < 0.08).map((row) => row.map(r)),
  }));
}
const readProbe = (page: Page) => page.evaluate(() => (window as any).__probe as ProbeReport);

async function resetProbe(page: Page) {
  await page.waitForFunction(() => typeof (window as any).__probeReset === "function" && !!(window as any).__out);
  await page.evaluate(() => (window as any).__probeReset());
}

/** 측정값은 한 줄로 남긴다: 병합 기록의 이전/이후 표에 그대로 옮긴다. */
const measured = (name: string, value: unknown) => console.log(`P3-2 측정 [${P32_ENGINE}] ${name}: ${JSON.stringify(value)}`);

/** 축소 버튼을 n번 눌러 눈금 폭을 정하고 초당 픽셀 수를 돌려준다(한 번에 16px/초씩 줄어든다). */
async function zoomOutBy(page: Page, times: number) {
  for (let i = 0; i < times; i++) await page.click(S.zoomOut);
  return 96 - 16 * times;
}

async function clickRuler(page: Page, seconds: number, pxPerSecond: number) {
  const ruler = (await page.locator(S.ruler).boundingBox())!;
  await page.mouse.click(ruler.x + seconds * pxPerSecond, ruler.y + 5);
}

const timeSeconds = async (page: Page) => {
  const text = (await page.locator(S.timeDisplay).textContent()) ?? "";
  const match = /(\d+):(\d{2})(?:\.(\d+))?/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) + (match[3] ? Number(`0.${match[3]}`) : 0) : Number.NaN;
};

test.describe("P3-2 재생 시계·예약기", () => {
  test("새 엔진이 기본이고, 주소 ?engine=v1이나 저장소 ad.engine=v1일 때만 옛 엔진이며, 주소가 저장소보다 우선한다", async ({ page }) => {
    const engineAt = async (url: string) => {
      await page.goto(url);
      await page.locator(S.inspector).waitFor();
      return page.evaluate(() => document.documentElement.dataset.engine);
    };
    expect(await engineAt("/")).toBe("v2");
    expect(await engineAt("/?engine=v1")).toBe("v1");
    await page.evaluate(() => window.localStorage.setItem("ad.engine", "v1"));
    expect(await engineAt("/")).toBe("v1");
    expect(await engineAt("/?engine=v2")).toBe("v2");
    await page.evaluate(() => window.localStorage.setItem("ad.engine", "아무거나"));
    expect(await engineAt("/")).toBe("v2"); // 알 수 없는 값은 무시하고 기본(v2)
    await page.evaluate(() => window.localStorage.removeItem("ad.engine"));
    expect(await engineAt("/")).toBe("v2");
  });

  test("옛 엔진으로 돌아가는 길(?engine=v1)에서도 올리기·재생·정지가 된다", async ({ page }) => {
    await openApp(page, { query: "?engine=v1" });
    expect(await page.evaluate(() => document.documentElement.dataset.engine)).toBe("v1");
    await upload(page);
    await page.click(S.play);
    await expect.poll(() => timeSeconds(page), { timeout: 5000 }).toBeGreaterThan(0.5);
    await page.click(S.stop);
    await expect.poll(() => timeSeconds(page), { timeout: 2000 }).toBe(0);
  });

  test("재생을 시작하면 앞으로 2초 안에 시작하는 클립의 소리만 만들고, 25ms 틱이 뒤의 클립을 미리 예약한다", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__workers = 0;
      const Native = window.Worker;
      window.Worker = class extends Native {
        constructor(...args: ConstructorParameters<typeof Worker>) {
          super(...args);
          (window as any).__workers++;
        }
      };
    });
    await openApp(page, { query: P32_QUERY });
    expect(await page.evaluate(() => document.documentElement.dataset.engine)).toBe(P32_ENGINE);
    const pxPerSecond = await zoomOutBy(page, 4); // 32px/초: 30초가 한 화면에 들어온다
    // 12초 클립 3개: A는 0~12초, B는 4~16초(A와 겹치므로 새 트랙), C는 14~26초
    for (const seconds of [0, 4, 14]) {
      await clickRuler(page, seconds, pxPerSecond);
      await upload(page, STEADY);
    }
    await clickRuler(page, 0, pxPerSecond);
    const base = await starts(page);
    await page.click(S.play);
    await page.waitForTimeout(500);
    const atStart = (await starts(page)) - base; // 옛 엔진은 3, 새 엔진은 A 하나
    await page.waitForTimeout(2500); // 재생 3초 지점: B(4초 시작)가 창(앞 2초)에 들어와 이미 예약돼 있어야 한다
    const beforeB = (await starts(page)) - base;
    await clickRuler(page, 13, pxPerSecond); // 재생 중 시크: B(진행 중)와 C(14초 시작)가 창에 있다
    await page.waitForTimeout(500);
    const afterSeek = (await starts(page)) - base;
    const workers = await page.evaluate(() => (window as any).__workers as number);
    measured("재생 시작 때 만든 소리 수", { atStart, at3s: beforeB, afterSeekTo13s: afterSeek, workers });
    if (onNewEngine) {
      expect(atStart).toBe(1);
      expect(beforeB).toBe(2);
      expect(afterSeek).toBe(4);
      expect(workers).toBeGreaterThanOrEqual(1); // 예약기 타이머가 실제로 Worker에서 돈다
    } else {
      expect(atStart).toBe(3);
    }
  });

  test("재생 중 클립을 10번 움직여도 스피커 신호에 튐이 0회다", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    await upload(page, STEADY);
    await clickRuler(page, 1, 96); // 재생 위치 1초(클립 안)
    await page.click(S.play);
    await page.waitForTimeout(500);
    await resetProbe(page);
    const startsBefore = await starts(page);

    const box = (await page.locator(S.clip).first().boundingBox())!;
    const x = box.x + Math.min(box.width / 2, 300);
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x + (i % 2 === 1 ? 48 : 0), y); // 0.5초 오른쪽 ↔ 제자리를 번갈아: 재생 위치는 늘 클립 안
      await page.waitForTimeout(100);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);
    const probe = await readProbe(page);
    const replaced = (await starts(page)) - startsBefore;
    measured("클립 10번 이동", { ...probe, 새로_시작한_소리: replaced });
    if (probe.jumps > 0) console.log("P3-2 진단", JSON.stringify(await explainJumps(page, probe)));
    expect(replaced).toBeGreaterThanOrEqual(10); // 정말 클립이 10번 바뀌었다(헛통과 방지)
    expect(probe.peak).toBeGreaterThan(0.2); // 내내 소리가 났다
    if (onNewEngine) expect(probe.jumps).toBe(0);
  });

  test("재생 중 시크를 10번 해도 튐이 0회, 끊김은 한 번에 20ms 이하다", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    await upload(page, STEADY);
    const pxPerSecond = await zoomOutBy(page, 4);
    await page.click(S.play);
    await page.waitForTimeout(500);
    await resetProbe(page);
    const startsBefore = await starts(page);
    for (const seconds of [3, 8, 2, 9, 4, 10, 1.5, 7, 5, 11]) {
      await clickRuler(page, seconds, pxPerSecond);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(400);
    const probe = await readProbe(page);
    const restarted = (await starts(page)) - startsBefore;
    measured("시크 10번", { ...probe, 새로_시작한_소리: restarted });
    if (probe.jumps > 0) console.log("P3-2 진단", JSON.stringify(await explainJumps(page, probe)));
    expect(restarted).toBeGreaterThanOrEqual(10); // 시크마다 새 위치에서 소리가 다시 시작됐다
    expect(probe.peak).toBeGreaterThan(0.2);
    if (onNewEngine) {
      expect(probe.jumps).toBe(0);
      expect(probe.longestGapMs).toBeLessThanOrEqual(20);
    }
  });

  test("재생 → 일시정지 → 이어 재생: 멈춘 동안 위치가 그대로이고, 이어서 가며 튐이 없다", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    await upload(page, STEADY);
    await page.click(S.play);
    await page.waitForTimeout(400);
    await resetProbe(page);
    await page.waitForTimeout(800);
    await page.click(S.play); // 일시정지
    const pausedAt = await timeSeconds(page);
    expect(pausedAt).toBeGreaterThan(0.8);
    await page.waitForTimeout(700);
    expect(await timeSeconds(page)).toBe(pausedAt);
    await page.click(S.play); // 이어 재생
    await page.waitForTimeout(900);
    const resumedAt = await timeSeconds(page);
    expect(resumedAt).toBeGreaterThan(pausedAt + 0.5);
    expect(resumedAt).toBeLessThan(pausedAt + 2);
    const probe = await readProbe(page);
    measured("일시정지·이어 재생", { ...probe, pausedAt, resumedAt });
    if (probe.jumps > 0) console.log("P3-2 진단", JSON.stringify(await explainJumps(page, probe)));
    expect(probe.peak).toBeGreaterThan(0.2);
    if (onNewEngine) expect(probe.jumps).toBe(0);
  });
});

// ───────────────────────── P3-3 트랙 경로와 이펙트 약속 ─────────────────────────

/** 같은 규칙으로 한 줄 측정을 남긴다(병합 기록의 이전/이후 표용). */
const measured33 = (name: string, value: unknown) => console.log(`P3-3 측정 [${P32_ENGINE}] ${name}: ${JSON.stringify(value)}`);

const delayPower = '[aria-label="딜레이 켜기"]';
const reverbPower = '[aria-label="리버브 켜기"]';
const reverbDecay = '[aria-label="잔향 길이"]';

test.describe("P3-3 트랙 경로와 이펙트 약속", () => {
  test("재생 중 딜레이·리버브를 5번씩 켜고 꺼도 소리 소스는 다시 시작하지 않고 튐이 0회다", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    await upload(page, STEADY);
    await page.click(S.play);
    await page.waitForTimeout(600);
    await resetProbe(page);
    const startsBefore = await starts(page);

    for (let i = 0; i < 5; i++) {
      for (const power of [delayPower, reverbPower]) {
        await page.click(power); // 켜기
        await page.waitForTimeout(150);
        await page.click(power); // 끄기
        await page.waitForTimeout(150);
      }
    }
    await page.waitForTimeout(400);
    const probe = await readProbe(page);
    const restarted = (await starts(page)) - startsBefore;
    measured33("딜레이·리버브 5번씩 켜고 끄기", { ...probe, 새로_시작한_소리: restarted });
    if (probe.jumps > 0) console.log("P3-3 진단", JSON.stringify(await explainJumps(page, probe)));
    expect(probe.peak).toBeGreaterThan(0.15); // 내내 소리가 났다(헛통과 방지)
    if (onNewEngine) {
      expect(restarted).toBe(0);
      expect(probe.jumps).toBe(0);
    }
  });

  test("재생 중 이펙트 순서를 10번 바꿔도 소리 소스는 다시 시작하지 않고 튐이 0회다", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    await upload(page, STEADY);
    await page.click(S.play);
    await page.waitForTimeout(600);
    await resetProbe(page);
    const startsBefore = await starts(page);

    const down = page.locator('.effect-slot').first().locator('button[title="아래로 이동"]');
    const up = page.locator('.effect-slot').nth(1).locator('button[title="위로 이동"]');
    for (let i = 0; i < 5; i++) {
      await down.click(); // 1번 슬롯을 아래로
      await page.waitForTimeout(200);
      await up.click(); // 다시 위로
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(300);
    const probe = await readProbe(page);
    const restarted = (await starts(page)) - startsBefore;
    measured33("이펙트 순서 10번 바꾸기", { ...probe, 새로_시작한_소리: restarted });
    if (probe.jumps > 0) console.log("P3-3 진단", JSON.stringify(await explainJumps(page, probe)));
    expect(probe.peak).toBeGreaterThan(0.15);
    if (onNewEngine) {
      expect(restarted).toBe(0);
      expect(probe.jumps).toBe(0);
      // 설계의 "10ms 내렸다 올리기"에 주 스레드 타이머 지연이 더해져 보통 9~20ms, 가끔 30~40ms가 나온다.
      // P3-3 병합 빌드와 P3-4 빌드를 각각 16번 돌려 보니 8.6~39.6ms였고 20ms를 넘긴 횟수도 둘 다 2/16으로 같았다(상한을 20ms로 잡은 것이 너무 빡빡했다).
      // 그래서 상한은 그 지연의 꼬리를 덮는 60ms로 둔다. 소스 재시작 0회·튐 0회 판정은 그대로다.
      expect(probe.longestGapMs).toBeLessThanOrEqual(60);
    }
  });

  test("딜레이를 켜고 재생하며 녹음을 시작해도 출력 최대값이 5% 넘게 바뀌지 않는다(딜레이 소리 유지)", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    await upload(page, STEADY);
    await page.click(S.play);
    await page.waitForTimeout(600);
    const dry = await outputPeak(page, 1000); // 딜레이 끔
    await page.click(delayPower);
    await page.waitForTimeout(800);
    const before = await outputPeak(page, 1000); // 딜레이 켬
    const startsBefore = await starts(page);

    await page.click('button[title="보컬 녹음"]');
    await expect(page.locator(S.record)).toHaveClass(/recording/, { timeout: 8000 });
    await page.waitForTimeout(800);
    const during = await outputPeak(page, 1000);
    const restarted = (await starts(page)) - startsBefore;
    await page.click(S.stop);
    measured33("딜레이+녹음 출력 최대값", { 딜레이_끔: dry, 녹음_전: before, 녹음_중: during, 차이: Math.abs(during - before) / before, 새로_시작한_소리: restarted });

    expect(before).toBeLessThan(dry * 0.9); // 딜레이가 정말 들어가 있다(220Hz에 에코가 겹쳐 작아진다)
    expect(Math.abs(during - before) / before).toBeLessThanOrEqual(0.05);
    if (onNewEngine) expect(restarted).toBe(0);
  });

  test("잔향 길이 노브를 1초 동안 끄는 동안 잔향을 만들지 않고, 놓은 뒤에 한 번 만든다", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__irBuilds = 0;
      const create = BaseAudioContext.prototype.createBuffer;
      BaseAudioContext.prototype.createBuffer = function (channels: number, length: number, sampleRate: number) {
        // 잔향(임펄스 응답)은 스테레오이고 0.2초 이상이다. 다른 곳에서 만드는 짧은 버퍼는 세지 않는다.
        if (channels === 2 && length >= sampleRate * 0.2 - 1) (window as any).__irBuilds++;
        return create.call(this, channels, length, sampleRate);
      };
    });
    await openApp(page, { query: P32_QUERY });
    await upload(page, STEADY);
    await page.click(reverbPower);
    await page.click(S.play);
    await page.waitForTimeout(800);
    const irBuilds = () => page.evaluate(() => (window as any).__irBuilds as number);
    const base = await irBuilds();

    // 노브를 끄는 것처럼 30ms마다 값을 바꾼다(약 1초)
    for (let step = 1; step <= 33; step++) {
      await setRange(page, reverbDecay, Math.round((2.4 + step * 0.1) * 10) / 10);
      await page.waitForTimeout(30);
    }
    const whileDragging = (await irBuilds()) - base;
    await page.waitForTimeout(500); // 놓은 뒤(150ms 조용해지면 한 번 만든다)
    const afterRelease = (await irBuilds()) - base;
    measured33("잔향 길이 노브 1초", { 끄는_동안_만든_수: whileDragging, 놓은_뒤_만든_수: afterRelease });
    if (onNewEngine) {
      expect(whileDragging).toBe(0);
      expect(afterRelease).toBe(1);
    } else {
      expect(afterRelease).toBeGreaterThanOrEqual(1);
    }
  });
});

// ───────────────────────── P3-4 마스터 경로와 리미터 ─────────────────────────

/** 같은 규칙으로 한 줄 측정을 남긴다(병합 기록의 이전/이후 표용). */
const measured34 = (name: string, value: unknown) => console.log(`P3-4 측정 [${P32_ENGINE}] ${name}: ${JSON.stringify(value)}`);

const masterVolume = '[data-testid="master-volume"]';
const masterVolumeValue = '[data-testid="master-volume-value"]';
const limiterValue = '[data-testid="limiter-reduction-value"]';
const monitorVolume = '[data-testid="monitor-volume"]';
const dbOf = (ratio: number) => 20 * Math.log10(ratio);

/** 리미터 앞(마스터 입력)과 뒤(최종 출력)의 최대값을 같은 시간 동안 잰다. 앞쪽은 소리 없는 가지(분석기)를 붙여 읽는다. */
async function limiterPeaks(page: Page, ms = 1000) {
  return page.evaluate(async (duration) => {
    const out = (window as any).__out as AnalyserNode | undefined;
    const input = (window as any).__limiterIn as GainNode | undefined;
    if (!out || !input) return undefined;
    const tap = input.context.createAnalyser();
    tap.fftSize = 2048;
    input.connect(tap);
    const before = new Float32Array(tap.fftSize);
    const after = new Float32Array(out.fftSize);
    let pre = 0;
    let post = 0;
    for (let t = 0; t < duration; t += 25) {
      tap.getFloatTimeDomainData(before);
      out.getFloatTimeDomainData(after);
      for (const v of before) pre = Math.max(pre, Math.abs(v));
      for (const v of after) post = Math.max(post, Math.abs(v));
      await new Promise((r) => setTimeout(r, 25));
    }
    input.disconnect(tap);
    return { pre, post };
  }, ms);
}

/** 모니터 길(메트로놈·입력 모니터가 나가는 길)의 최대값. 클릭이 짧아서 넓은 창(약 0.74초)으로 읽는다. */
async function monitorPeak(page: Page, ms: number) {
  return page.evaluate(async (duration) => {
    const monitor = ((window as any).__destGains as GainNode[] | undefined)?.find((gain) => gain.gain.value > 0);
    if (!monitor) return -1;
    const tap = monitor.context.createAnalyser();
    tap.fftSize = 32768;
    monitor.connect(tap);
    const buffer = new Float32Array(tap.fftSize);
    let peak = 0;
    for (let t = 0; t < duration; t += 50) {
      tap.getFloatTimeDomainData(buffer);
      for (const v of buffer) peak = Math.max(peak, Math.abs(v));
      await new Promise((r) => setTimeout(r, 50));
    }
    monitor.disconnect(tap);
    return peak;
  }, ms);
}

test.describe("P3-4 마스터 경로와 리미터", () => {
  test("클립 1개(0.8)만 재생하면 리미터는 소리를 건드리지 않는다(앞뒤 차이 ±0.5 dB)", async ({ page }) => {
    test.skip(!onNewEngine, "리미터는 새 엔진에만 있다");
    await openApp(page, { query: P32_QUERY });
    await upload(page);
    await clickRuler(page, 4.5, 96);
    await page.click(S.play);
    await page.waitForTimeout(400);
    const peaks = (await limiterPeaks(page))!;
    const shown = await page.locator(limiterValue).textContent();
    measured34("클립 1개 리미터 앞·뒤 최대값", { ...peaks, 차이_dB: dbOf(peaks.post / peaks.pre), 표시: shown });
    expect(peaks.pre).toBeGreaterThan(0.25); // 소리가 났다(헛통과 방지)
    expect(Math.abs(dbOf(peaks.post / peaks.pre))).toBeLessThanOrEqual(0.5);
    await expect(page.locator(limiterValue)).toHaveText("0.0 dB");
  });

  test("겹쳐서 한계를 넘는 소리는 −1 dBFS(0.891) 근처로 눌리고, 눌린 양이 마스터 칸에 보인다", async ({ page }) => {
    test.skip(!onNewEngine, "리미터는 새 엔진에만 있다");
    await openApp(page, { query: P32_QUERY });
    await upload(page);
    await upload(page); // 겹치므로 새 트랙에 들어간다
    await clickRuler(page, 4.5, 96);
    await page.click(S.play);
    await page.waitForTimeout(400);
    const peaks = (await limiterPeaks(page))!;
    await page.waitForTimeout(150);
    const shown = (await page.locator(limiterValue).textContent()) ?? "";
    measured34("겹친 0.8 클립 2개 리미터 앞·뒤 최대값", { ...peaks, 표시: shown });
    expect(peaks.pre).toBeGreaterThan(0.95); // 한계를 넘는 소리가 들어왔고
    expect(peaks.post).toBeLessThanOrEqual(0.9); // 0.891 + 여유
    expect(peaks.post).toBeGreaterThan(0.8); // 필요 이상으로 누르지 않았다
    expect(Number.parseFloat(shown)).toBeLessThan(-0.1); // 마스터 칸에 눌린 양이 보인다
    await page.click(S.stop);
    await expect(page.locator(limiterValue)).toHaveText("0.0 dB"); // 멈추면 0으로 돌아온다
  });

  test("마스터 볼륨을 −6 dB로 내리면 출력이 절반(±0.5 dB)이 되고 Ctrl+Z 한 번으로 돌아온다", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    await upload(page);
    await clickRuler(page, 4.5, 96);
    await expect(page.locator(masterVolume)).toHaveValue("0");
    await expect(page.locator(masterVolumeValue)).toHaveText("0.0 dB");
    await page.click(S.play);
    await page.waitForTimeout(400);
    const full = await outputPeak(page, 600);
    await setRange(page, masterVolume, -6);
    await expect(page.locator(masterVolumeValue)).toHaveText("-6.0 dB");
    await page.waitForTimeout(400); // 부드럽게 바뀌는 시간
    const half = await outputPeak(page, 600);
    await page.locator(masterVolume).evaluate((el) => (el as HTMLElement).blur());
    await page.keyboard.press("Control+z");
    await expect(page.locator(masterVolume)).toHaveValue("0");
    await page.waitForTimeout(400);
    const back = await outputPeak(page, 600);
    measured34("마스터 볼륨 −6 dB", { "0dB": full, "-6dB": half, 되돌린_뒤: back, 비율_dB: dbOf(half / full), 되돌린_차이_dB: dbOf(back / full) });
    expect(full).toBeGreaterThan(0.25);
    expect(Math.abs(dbOf(half / full) - dbOf(0.5))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(dbOf(back / full))).toBeLessThanOrEqual(0.5);
  });

  test("마스터 볼륨 칸: 0으로 되돌리기 단추와 자동 저장 뒤 복구", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    const reset = page.locator(".master-reset");
    await expect(reset).toBeDisabled(); // 이미 0 dB
    await setRange(page, masterVolume, -12);
    await expect(page.locator(masterVolumeValue)).toHaveText("-12.0 dB");
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(page.locator(masterVolume)).toHaveValue("0");
    await setRange(page, masterVolume, -9);
    await expect(page.locator(S.autosave)).toHaveText(/^자동 저장됨 \d{2}:\d{2}$/, { timeout: 4000 });
    await page.reload();
    await page.locator(S.inspector).waitFor();
    await expect(page.locator(masterVolume)).toHaveValue("-9", { timeout: 5000 });
  });

  test("메트로놈은 모니터 길로만 나가 마스터 출력에 섞이지 않고, 모니터 볼륨(기억됨)을 따른다", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    await expect(page.locator(monitorVolume)).toHaveValue("85"); // 기본 0.85
    await page.click('button[title="녹음 메트로놈"]');
    await page.selectOption(S.countIn, "4"); // 1마디(2초)
    await page.click(S.record);
    // 소리 길은 녹음을 누를 때 처음 만들어진다. 모니터 길(이득 > 0)과 마스터 출력 분석기가 생길 때까지 기다린다.
    await page.waitForFunction(() => !!(window as any).__out && !!(window as any).__destGains?.some((gain: GainNode) => gain.gain.value > 0));
    // 마스터 출력은 카운트인부터 끝까지 지켜본다(클릭이 한 번이라도 섞이면 0이 아니다).
    const masterWatch = outputPeak(page, 7800).catch(() => -2);
    // 강박 클릭(0.18)은 녹음이 시작된 뒤 2초마다 나온다. 그때부터 2.6초 창을 두 번 재면 어느 창에든 강박 클릭이 들어와 크기를 견줄 수 있다.
    await expect(page.locator(S.record)).toHaveClass(/recording/, { timeout: 8000 });
    const first = await monitorPeak(page, 2600);
    await setRange(page, monitorVolume, 40);
    await page.waitForTimeout(100); // 모니터 볼륨이 부드럽게 바뀌는 시간(약 50ms)
    const second = await monitorPeak(page, 2600);
    await page.click(S.stop);
    const master = await masterWatch;
    measured34("메트로놈 모니터 길", { 볼륨_85: first, 볼륨_40: second, 비율_dB: dbOf(second / first), 마스터_출력_최대값: master });
    expect(first).toBeGreaterThan(0.05); // 클릭이 모니터 길로 나갔다
    expect(master).toBeLessThan(0.001); // 마스터 출력에는 클릭이 섞이지 않았다
    expect(Math.abs(dbOf(second / first) - dbOf(0.4 / 0.85))).toBeLessThanOrEqual(1.5);
    await page.reload();
    await expect(page.locator(monitorVolume)).toHaveValue("40"); // 이 브라우저에 기억된다
  });
});

// ───────────────────────── P3-5 녹음 흐름 ─────────────────────────

/** 같은 규칙으로 한 줄 측정을 남긴다(병합 기록의 이전/이후 표용). */
const measured35 = (name: string, value: unknown) => console.log(`P3-5 측정 [${P32_ENGINE}] ${name}: ${JSON.stringify(value)}`);

const latencyInput = '[data-testid="latency-offset"]';
const recordingPreview = '[data-testid="recording-preview"]';

/** 녹음기에 보낸 시작 프레임과 ScriptProcessorNode 생성 횟수를 잡아 두는 훅 */
const RECORD_PROBES = `(() => {
  window.__recStarts = [];
  window.__scriptProcessors = 0;
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (message, ...rest) {
    if (message && typeof message === "object" && message.type === "start" && typeof message.startFrame === "number") window.__recStarts.push(message.startFrame);
    return post.call(this, message, ...rest);
  };
  const create = BaseAudioContext.prototype.createScriptProcessor;
  BaseAudioContext.prototype.createScriptProcessor = function (...args) { window.__scriptProcessors++; return create.apply(this, args); };
})();`;

async function setLatency(page: Page, value: number) {
  const input = page.locator(latencyInput);
  await input.click();
  await input.press("Control+a");
  await input.pressSequentially(String(value));
  await input.press("Enter");
}

/** 녹음을 `ms` 동안 하고 멈춘다. 클립이 하나 더 생길 때까지 기다린다. */
async function recordFor(page: Page, ms: number) {
  const before = await page.locator(S.clip).count();
  await page.click(S.record);
  await expect(page.locator(S.record)).toHaveClass(/recording/, { timeout: 8000 });
  await page.waitForTimeout(ms);
  await page.click(S.stop);
  await expect(page.locator(S.clip)).toHaveCount(before + 1, { timeout: 8000 });
}

const clipLefts = (page: Page) =>
  page.locator(S.clip).evaluateAll((els) => els.map((el) => parseFloat((el as HTMLElement).style.left)));

test.describe("P3-5 녹음 흐름", () => {
  test("녹음하는 동안 ScriptProcessorNode를 만들지 않고, 콘솔에 폐기 예정 경고가 한 건도 없다", async ({ page }) => {
    const logs: string[] = [];
    page.on("console", (message) => logs.push(`${message.type()}: ${message.text()}`));
    await page.addInitScript(RECORD_PROBES);
    await openApp(page, { query: P32_QUERY });
    await recordFor(page, 1200);
    const created = await page.evaluate(() => (window as any).__scriptProcessors as number);
    const deprecations = logs.filter((line) => /ScriptProcessor|deprecat/i.test(line));
    measured35("ScriptProcessorNode", { 만든_수: created, 폐기_경고: deprecations.length });
    expect(created).toBe(0);
    expect(deprecations).toEqual([]);
  });

  test("카운트인 4박: 반주가 시작하는 시각과 녹음기가 담기 시작하는 프레임의 차이가 1샘플 이하다", async ({ page }) => {
    await page.addInitScript(RECORD_PROBES);
    await openApp(page, { query: P32_QUERY });
    await upload(page, STEADY); // 트랙 1에 12초 반주
    await page.selectOption(S.countIn, "4"); // 1마디 = 120 bpm에서 2초
    await page.click(S.record);
    await page.waitForFunction(() => (window as any).__recStarts.length >= 1 && (window as any).__startLog.length >= 1, undefined, { timeout: 8000 });
    // 카운트인이 끝나 녹음 단계로 넘어가는 것까지 본다.
    await expect(page.locator(S.record)).toHaveClass(/recording/);
    await page.waitForTimeout(2600);
    const { sampleRate, startFrame, whens } = await page.evaluate(() => {
      const w = window as any;
      return {
        sampleRate: (w.__out as AnalyserNode).context.sampleRate as number,
        startFrame: w.__recStarts[0] as number,
        whens: (w.__startLog as number[][]).map((row) => row[1]),
      };
    });
    await page.click(S.stop);
    // 반주(오디오 버퍼 소리)의 시작 시각 중 녹음 시작과 가장 가까운 것
    const nearest = whens.reduce((best, when) => (Math.abs(when * sampleRate - startFrame) < Math.abs(best * sampleRate - startFrame) ? when : best), whens[0]);
    const errorSamples = Math.abs(nearest * sampleRate - startFrame);
    measured35("카운트인 4박 시작 오차", { 샘플레이트: sampleRate, 녹음_시작_프레임: startFrame, 반주_시작_시각: nearest, 오차_샘플: errorSamples });
    expect(errorSamples).toBeLessThanOrEqual(1);
  });

  test("카운트인 동안에는 재생 위치가 가만히 있고, 끝나면 흐르기 시작한다", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    await upload(page, STEADY);
    await page.selectOption(S.countIn, "2"); // 2박 = 1초
    await page.click(S.record);
    await expect(page.locator(S.record)).toHaveClass(/recording/, { timeout: 8000 });
    expect(await timeSeconds(page)).toBeLessThan(0.05); // 카운트인 중
    await page.waitForTimeout(2200);
    expect(await timeSeconds(page)).toBeGreaterThan(0.5); // 카운트인이 끝나고 흘렀다
    await page.click(S.stop);
    await expect(page.locator(S.clip)).toHaveCount(2, { timeout: 8000 });
  });

  test("카운트인 중에 정지하면 녹음하지 않고 처음으로 돌아가며, 클립도 새 트랙도 남지 않는다", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    await upload(page, STEADY);
    await page.selectOption(S.countIn, "8"); // 2마디 = 4초
    await page.click(S.record);
    await expect(page.locator(S.record)).toHaveClass(/recording/, { timeout: 8000 });
    await page.waitForTimeout(600);
    await page.click(S.stop);
    await expect(page.locator(S.record)).not.toHaveClass(/recording/);
    await page.waitForTimeout(1200);
    await expect(page.locator(S.clip)).toHaveCount(1); // 반주뿐
    await expect(page.locator(S.trackHeader)).toHaveCount(1);
    expect(await timeSeconds(page)).toBeLessThan(0.05);
    await expect(page.locator(recordingPreview)).toHaveCount(0);
  });

  test("녹음하는 동안 클립은 임시 파형뿐이고, 끝나면 클립 1개가 한 번에 생기며 Ctrl+Z 한 번에 사라진다", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    await page.click(S.record);
    await expect(page.locator(S.record)).toHaveClass(/recording/, { timeout: 8000 });
    await expect(page.locator(recordingPreview)).toBeVisible();
    await page.waitForTimeout(1500);
    const narrow = (await page.locator(recordingPreview).boundingBox())!.width;
    await page.waitForTimeout(1000);
    const wide = (await page.locator(recordingPreview).boundingBox())!.width;
    expect(wide - narrow).toBeGreaterThan(60); // 초당 96px로 자란다
    await expect(page.locator(S.clip)).toHaveCount(0); // 문서에는 아직 클립이 없다

    await page.keyboard.press("Control+z"); // 녹음 중에는 막힌다
    await expect(page.locator(S.status)).toContainText("녹음 중에는 실행 취소와 다시 실행을 할 수 없습니다");
    await clickRuler(page, 5, 96); // 위치 이동도 막힌다
    await expect(page.locator(S.status)).toContainText("녹음 중에는 재생 위치를 옮길 수 없습니다");
    await page.waitForTimeout(200);
    await expect(page.locator(S.record)).toHaveClass(/recording/);

    await page.click(S.stop);
    await expect(page.locator(S.clip)).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator(recordingPreview)).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await expect(page.locator(S.clip)).toHaveCount(0); // 음원과 클립이 한 번에 사라진다
    await page.keyboard.press("Control+y");
    await expect(page.locator(S.clip)).toHaveCount(1);
  });

  test("지연 보정 +100 ms는 같은 조건의 녹음 클립을 0.1초 앞으로 당긴다", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    const pxPerSecond = 96;
    await clickRuler(page, 3, pxPerSecond);
    await recordFor(page, 1200); // 보정 0
    await clickRuler(page, 3, pxPerSecond);
    await setLatency(page, 100);
    await recordFor(page, 1200); // 보정 +100 ms
    const [plain, shifted] = await clipLefts(page);
    const shiftMs = ((plain - shifted) / pxPerSecond) * 1000;
    measured35("지연 보정 +100 ms", { 보정_0_왼쪽_px: plain, 보정_100_왼쪽_px: shifted, 앞으로_당겨진_ms: shiftMs });
    expect(Math.abs(shiftMs - 100)).toBeLessThanOrEqual(15);
  });

  test("지연 보정값은 이 브라우저에 기억되고 문서에는 들어가지 않는다", async ({ page }) => {
    await openApp(page);
    await setLatency(page, 35);
    await expect(page.locator(latencyInput)).toHaveValue("35");
    await expect(page.locator(S.autosave)).toHaveAttribute("data-state", "idle"); // 문서가 바뀌지 않았으니 저장할 것도 없다
    await page.reload();
    await page.locator(S.statusbar).waitFor();
    await expect(page.locator(latencyInput)).toHaveValue("35");
    await setLatency(page, 999); // 범위(−200~200) 밖은 잘린다
    await expect(page.locator(latencyInput)).toHaveValue("200");
  });

  test("지연 보정 칸이 있어도 상단 바는 가로로 넘치지 않고, 1100px에서는 설정 팝오버 안에 있다", async ({ page }) => {
    await openApp(page);
    for (const width of [1280, 1440, 1600, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator(latencyInput)).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px 가로 넘침`).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(page.locator(latencyInput)).toHaveCount(0);
    await page.locator(S.recordOptionsToggle).click();
    await expect(page.locator(latencyInput)).toBeVisible();
  });

  test("녹음 중 재생 버튼(스페이스)을 누르면 녹음이 끝나고 저장된다", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    await page.click(S.record);
    await expect(page.locator(S.record)).toHaveClass(/recording/, { timeout: 8000 });
    await page.waitForTimeout(1200);
    await page.click(S.play);
    await expect(page.locator(S.clip)).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator(S.record)).not.toHaveClass(/recording/);
  });
});

// ───────────────────────── P3-6 믹스 내보내기 ─────────────────────────

const LONG = path.join(here, "fixtures", "steady-220hz-180s.wav"); // 3분 내내 같은 크기(0.4)의 220Hz — 긴 곡 내보내기 측정용

/** 같은 규칙으로 한 줄 측정을 남긴다(병합 기록의 이전/이후 표용). */
const measured36 = (name: string, value: unknown) => console.log(`P3-6 측정 [${ENGINE ?? "기본"}] ${name}: ${JSON.stringify(value)}`);

/** 리버브를 켠 트랙의 꼬리: 잔향 2.4초 + 프리딜레이 0.02초 */
const REVERB_TAIL_SECONDS = 2.42;

/** 파일 메뉴 → "믹스 WAV 내보내기" */
async function chooseExport(page: Page) {
  await page.locator(S.fileMenuTrigger).click();
  await page.getByRole("menuitem", { name: /믹스 WAV 내보내기/ }).click();
}

/**
 * 인스펙터의 이펙트 사슬에서 리버브(넷째 칸)를 켠다. 곡 끝 뒤로 잔향 꼬리가 생긴다.
 * 방금 올린 클립의 트랙이 이미 선택되어 있으므로 트랙 머리를 누를 필요가 없다 — 머리 한가운데를 누르면 음소거 단추가 눌린다.
 */
async function turnOnReverb(page: Page) {
  await page.locator(".effect-slot").nth(3).locator(".effect-power").click();
}

/** 파일 이름은 운영체제·브라우저 글자 처리에 따라 달라지므로, 영문 임시 경로에 저장해 내용으로 확인한다. */
async function saveDownload(download: Download, testInfo: TestInfo, label: string) {
  const saved = path.join(os.tmpdir(), `ad2-mix-${testInfo.workerIndex}-${Date.now()}-${label}.wav`);
  await download.saveAs(saved);
  return saved;
}

/** 16·24비트 PCM WAV를 읽어 머리 정보·길이·최고점·구간별 실효값·해시를 돌려준다(머리가 파일과 맞는지도 확인한다). */
function readWav(file: string) {
  const data = fs.readFileSync(file);
  expect(data.toString("ascii", 0, 4)).toBe("RIFF");
  expect(data.toString("ascii", 8, 12)).toBe("WAVE");
  expect(data.toString("ascii", 36, 40)).toBe("data");
  expect(data.readUInt16LE(20)).toBe(1); // 정수 PCM
  const channels = data.readUInt16LE(22);
  const sampleRate = data.readUInt32LE(24);
  const bitDepth = data.readUInt16LE(34);
  const dataBytes = data.readUInt32LE(40);
  expect(data.readUInt32LE(4)).toBe(data.length - 8);
  expect(data.length).toBe(44 + dataBytes);
  const bytesPerSample = bitDepth / 8;
  const frames = dataBytes / (bytesPerSample * channels);
  const sampleAt = (index: number) => {
    const offset = 44 + index * bytesPerSample;
    return bitDepth === 16 ? data.readInt16LE(offset) / 32768 : data.readIntLE(offset, 3) / 8388608;
  };
  let peak = 0;
  for (let index = 0; index < frames * channels; index += 1) peak = Math.max(peak, Math.abs(sampleAt(index)));
  /** 왼쪽 채널의 `from`~`to`초 구간 실효값 */
  const rms = (from: number, to: number) => {
    const first = Math.floor(from * sampleRate);
    const last = Math.min(frames, Math.floor(to * sampleRate));
    let sum = 0;
    for (let frame = first; frame < last; frame += 1) sum += sampleAt(frame * channels) ** 2;
    return Math.sqrt(sum / Math.max(1, last - first));
  };
  return { channels, sampleRate, bitDepth, frames, seconds: frames / sampleRate, bytes: data.length, peak, rms, sha: createHash("sha256").update(data).digest("hex") };
}

const CEILING = 10 ** (-1 / 20); // 마스터 리미터의 천장(−1 dBFS)

test.describe("P3-6 믹스 내보내기", () => {
  test("파일 메뉴의 내보내기는 옵션 대화상자를 열고, 길이·예상 크기·기본 옵션이 보이며 Esc로 닫힌다", async ({ page }) => {
    await openApp(page);
    await upload(page); // 8초 클립
    await chooseExport(page);
    const dialog = page.locator(S.exportDialog);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "믹스 WAV 내보내기" })).toBeVisible();
    await expect(page.locator(S.exportSummary)).toHaveText("길이 0:08 · 예상 크기 1.3 MB");
    await expect(page.locator(`${S.exportSampleRate} input:checked`)).toHaveValue("44100");
    await expect(page.locator(`${S.exportBitDepth} input:checked`)).toHaveValue("16");
    await expect(page.locator(S.exportStart)).toBeFocused();
    // 옵션을 바꾸면 예상 크기가 따라 바뀐다(24비트는 1.5배).
    await page.getByRole("radio", { name: "24비트" }).check();
    await expect(page.locator(S.exportSummary)).toHaveText("길이 0:08 · 예상 크기 2.0 MB");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator(S.clip)).toHaveCount(1);
  });

  test("기본 옵션으로 내보내면 16비트 44.1 kHz 스테레오 WAV가 내려오고, 길이는 클립 끝(±10 ms), 최고점은 −1 dBFS 이하다", async ({ page }, testInfo) => {
    await openApp(page);
    await upload(page); // 앞 4초 작게(0.05), 뒤 4초 크게(0.8)
    await chooseExport(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator(S.exportStart).click()]);
    const saved = await saveDownload(download, testInfo, "default");
    const wav = readWav(saved);
    const quiet = wav.rms(0.5, 3.5);
    const loud = wav.rms(4.5, 7.5);
    measured36("기본 내보내기(8초 클립)", { 길이_초: wav.seconds, 최고점_dBFS: 20 * Math.log10(wav.peak), 앞4초_실효값: quiet, 뒤4초_실효값: loud, 바이트: wav.bytes });
    expect(wav).toMatchObject({ channels: 2, sampleRate: 44100, bitDepth: 16 });
    expect(Math.abs(wav.seconds - 8)).toBeLessThanOrEqual(0.01);
    expect(wav.peak).toBeLessThanOrEqual(CEILING + 1 / 32768);
    expect(loud).toBeGreaterThan(0.1);
    expect(quiet).toBeLessThan(loud * 0.3); // 앞 4초는 작고 뒤 4초는 크다 = 클립이 제자리에 놓였다
    await expect(page.locator(S.exportDialog)).toBeHidden();
    await expect(page.locator(S.status)).toContainText("믹스 WAV 파일을 저장했습니다");
    fs.rmSync(saved, { force: true });
  });

  test("같은 문서를 두 번 내보내면 파일이 바이트까지 같고, 리버브를 켜면 길이는 클립 끝 + 잔향 꼬리(±10 ms)다", async ({ page }, testInfo) => {
    await openApp(page);
    await upload(page);
    await turnOnReverb(page);
    const files: string[] = [];
    for (const label of ["a", "b"]) {
      await chooseExport(page);
      const [download] = await Promise.all([page.waitForEvent("download"), page.locator(S.exportStart).click()]);
      files.push(await saveDownload(download, testInfo, label));
      await expect(page.locator(S.exportDialog)).toBeHidden();
    }
    const [first, second] = [readWav(files[0]), readWav(files[1])];
    measured36("두 번 내보내기(리버브 켬)", { 해시_앞16자: [first.sha.slice(0, 16), second.sha.slice(0, 16)], 길이_초: first.seconds, 꼬리_구간_실효값: first.rms(8.1, 9) });
    expect(second.sha).toBe(first.sha);
    expect(Math.abs(first.seconds - (8 + REVERB_TAIL_SECONDS))).toBeLessThanOrEqual(0.01);
    expect(first.rms(4.5, 7.5)).toBeGreaterThan(0.05); // 리버브를 켜도 소리가 나온다
    expect(first.rms(8.1, 9)).toBeGreaterThan(0.0005); // 클립이 끝난 뒤에도 잔향이 실제로 담겼다
    files.forEach((file) => fs.rmSync(file, { force: true }));
  });

  test("24비트·48 kHz를 고르면 파일 머리가 그대로 나오고, 고른 값은 새로고침 뒤에도 남는다", async ({ page }, testInfo) => {
    await openApp(page);
    await upload(page);
    await chooseExport(page);
    await page.getByRole("radio", { name: "48 kHz" }).check();
    await page.getByRole("radio", { name: "24비트" }).check();
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator(S.exportStart).click()]);
    const saved = await saveDownload(download, testInfo, "24-48");
    const wav = readWav(saved);
    measured36("24비트 48 kHz", { 길이_초: wav.seconds, 바이트: wav.bytes, 최고점_dBFS: 20 * Math.log10(wav.peak) });
    expect(wav).toMatchObject({ channels: 2, sampleRate: 48000, bitDepth: 24 });
    expect(Math.abs(wav.seconds - 8)).toBeLessThanOrEqual(0.01);
    expect(wav.bytes).toBe(44 + wav.frames * 2 * 3);
    expect(wav.peak).toBeLessThanOrEqual(CEILING + 1 / 8388608);
    fs.rmSync(saved, { force: true });

    await page.reload();
    await page.locator(S.inspector).waitFor();
    await page.waitForTimeout(1200);
    await upload(page);
    await chooseExport(page);
    await expect(page.getByRole("radio", { name: "48 kHz" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "24비트" })).toBeChecked();
    await page.keyboard.press("Escape");
  });

  test("3분 곡을 내보내는 동안 진행률이 0에서 100까지 거꾸로 가지 않고, 화면이 200 ms 넘게 멈추지 않으며, 길이는 끝 + 꼬리(±10 ms)다", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      const w = window as any;
      w.__longtasks = [];
      w.__exportProgress = [];
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) w.__longtasks.push(Math.round(entry.duration));
        }).observe({ entryTypes: ["longtask"] });
      } catch {
        /* 긴 작업을 관측하지 못하는 브라우저 */
      }
      // 진행률 막대에 보이는 값을 바뀔 때마다 기록한다.
      window.addEventListener("DOMContentLoaded", () => {
        new MutationObserver(() => {
          const bar = document.querySelector('[data-testid="export-progress"]');
          if (bar) w.__exportProgress.push(Number(bar.getAttribute("aria-valuenow")));
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-valuenow"] });
      });
    });
    await openApp(page);
    await upload(page, LONG); // 180초
    await turnOnReverb(page);
    await page.waitForTimeout(2500); // 올린 직후의 자동 저장·화면 정리가 끝나도록
    await page.evaluate(() => ((window as any).__longtasks.length = 0));
    await chooseExport(page);
    const started = Date.now();
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 150_000 }), page.locator(S.exportStart).click()]);
    const wallMs = Date.now() - started;
    const saved = await saveDownload(download, testInfo, "long");
    await page.waitForTimeout(300); // 긴 작업 관측값이 도착하도록
    const progress: number[] = await page.evaluate(() => (window as any).__exportProgress);
    const longtasks: number[] = await page.evaluate(() => (window as any).__longtasks);
    const wav = readWav(saved);
    const longest = Math.max(0, ...longtasks);
    measured36("3분 곡 내보내기", {
      걸린_ms: wallMs,
      진행률_표본: progress.length,
      진행률_처음: progress[0],
      진행률_끝: progress[progress.length - 1],
      가장_긴_멈춤_ms: longest,
      긴_작업_수: longtasks.length,
      길이_초: wav.seconds,
      최고점_dBFS: 20 * Math.log10(wav.peak),
    });
    expect(progress.length).toBeGreaterThan(20);
    expect(progress[0]).toBeLessThanOrEqual(5);
    expect(progress[progress.length - 1]).toBe(100);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
    expect(longest).toBeLessThan(200);
    expect(wav).toMatchObject({ channels: 2, sampleRate: 44100, bitDepth: 16 });
    expect(Math.abs(wav.seconds - (180 + REVERB_TAIL_SECONDS))).toBeLessThanOrEqual(0.01);
    expect(wav.peak).toBeLessThanOrEqual(CEILING + 1 / 32768);
    expect(wav.rms(60, 120)).toBeGreaterThan(0.05); // 소리가 나온다(무음 파일이 아니다)
    fs.rmSync(saved, { force: true });
  });

  test("재생 출력의 최고점과 내보낸 파일의 최고점이 같다(±0.5 dB) — 재생과 내보내기가 같은 소리 부품을 쓴다", async ({ page }, testInfo) => {
    await openApp(page, { query: P32_QUERY });
    await upload(page); // 앞 4초 작게(0.05), 뒤 4초 크게(0.8)
    await clickRuler(page, 4.5, 96);
    await page.click(S.play);
    await page.waitForTimeout(400);
    const playing = await outputPeak(page, 800);
    await page.click(S.stop);
    await chooseExport(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator(S.exportStart).click()]);
    const saved = await saveDownload(download, testInfo, "same-sound");
    const wav = readWav(saved);
    const diffDb = dbOf(wav.peak / playing);
    measured36("재생 출력 최고점 vs 내보낸 파일 최고점", { 재생: playing, 파일: wav.peak, 차이_dB: diffDb });
    expect(playing).toBeGreaterThan(0.3);
    // 옛 엔진(E2E_P32_ENGINE=v1)의 재생은 새 소리 부품을 쓰지 않아 내보낸 소리와 다르다 — 수치만 남기고 판정은 새 엔진에서만 한다.
    if (onNewEngine) expect(Math.abs(diffDb)).toBeLessThanOrEqual(0.5);
    fs.rmSync(saved, { force: true });
  });

  test("렌더 도중 취소하면 파일이 내려오지 않고, 대화상자가 닫히며 '취소했습니다'가 알려지고, 앱은 그대로 쓸 수 있다", async ({ page }) => {
    test.setTimeout(120_000);
    let downloads = 0;
    page.on("download", () => (downloads += 1));
    await openApp(page);
    await upload(page, LONG);
    await turnOnReverb(page);
    await chooseExport(page);
    await page.locator(S.exportStart).click();
    // 진행률이 처음 오를 때까지 기다렸다가 취소한다.
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="export-progress"]')?.getAttribute("aria-valuenow")) > 0, undefined, { timeout: 30_000 });
    await page.locator(S.exportCancel).click();
    await expect(page.locator(S.exportDialog)).toBeHidden({ timeout: 10_000 });
    await expect(page.locator(S.status)).toContainText("취소했습니다");
    await page.waitForTimeout(3000); // 뒤에서 렌더가 이어져도 파일이 만들어지는 일은 없다
    expect(downloads).toBe(0);
    // 다시 열 수 있다.
    await chooseExport(page);
    await expect(page.locator(S.exportDialog)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(S.exportDialog)).toBeHidden();
    await expect(page.locator(S.clip)).toHaveCount(1);
  });

  test("내보낼 클립이 없으면 대화상자 없이 이유만 알려 준다", async ({ page }) => {
    await openApp(page);
    await chooseExport(page);
    await expect(page.locator(S.toast).filter({ hasText: "내보낼 클립이 없습니다" })).toBeVisible();
    await expect(page.locator(S.exportDialog)).toBeHidden();
  });

  test("대화상자가 열려 있는 동안에는 뒤의 문서를 고치는 단축키(Delete)가 듣지 않는다", async ({ page }) => {
    await openApp(page);
    await upload(page);
    await page.locator(S.clip).first().click({ position: { x: 60, y: 40 } });
    await chooseExport(page);
    await expect(page.locator(S.exportStart)).toBeFocused();
    await page.keyboard.press("Delete");
    await page.keyboard.press("Escape");
    await expect(page.locator(S.exportDialog)).toBeHidden();
    await expect(page.locator(S.clip)).toHaveCount(1); // 지워지지 않았다
    await page.keyboard.press("Delete"); // 대화상자가 닫히면 같은 키가 다시 듣는다(시험 전제 확인)
    await expect(page.locator(S.clip)).toHaveCount(0);
  });

  test("녹음하는 동안에는 내보내기가 열리지 않고 이유가 안내된다", async ({ page }) => {
    await openApp(page, { query: P32_QUERY });
    await upload(page, STEADY);
    await page.click(S.record);
    await expect(page.locator(S.record)).toHaveClass(/recording/, { timeout: 8000 });
    await chooseExport(page);
    await expect(page.locator(S.status)).toContainText("녹음 중에는 믹스를 내보낼 수 없습니다");
    await expect(page.locator(S.exportDialog)).toBeHidden();
    await page.click(S.stop);
    await expect(page.locator(S.clip)).toHaveCount(2, { timeout: 8000 });
  });
});

test.describe("A6·C6 안내 문구", () => {
  test("도구를 바꾼 뒤에도 업로드 실패가 화면에 보인다", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("KeyV");
    await upload(page, NOT_AUDIO);
    await expect(page.locator(S.status)).toContainText("not-audio.txt");
  });

  test("실패 안내에 브라우저 영어 오류 문장이 그대로 나오지 않는다", async ({ page }) => {
    await openApp(page);
    await upload(page, NOT_AUDIO);
    await expect(page.locator(S.status)).not.toContainText(/unable|decode|error/i);
  });
});

test.describe("P2-3 한국어 문구", () => {
  test("업로드 실패는 해결 방법이 담긴 한국어이고, 브라우저 원문은 접힌 '자세히 보기'에만 있다", async ({ page }) => {
    await openApp(page);
    await upload(page, NOT_AUDIO);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("'not-audio.txt'은(는) 오디오로 읽을 수 없습니다");
    await expect(alert).toContainText("mp3·wav·m4a 파일인지 확인해 주세요");
    await expect(page.locator(S.status)).not.toContainText(/unable|decode|error/i);

    const details = alert.locator("details");
    await expect(details).toBeVisible();
    await expect(details).not.toHaveAttribute("open", "");
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
    await expect(details.locator("pre")).toContainText("Unable to decode audio data");
  });

  test("마이크 권한이 거부되면 사이트 설정을 안내하는 한국어 오류가 나온다", async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    });
    await openApp(page);
    await page.click('button[title="보컬 녹음"]');
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("마이크 사용이 허용되지 않았습니다", { timeout: 10_000 });
    await expect(alert).toContainText("사이트 설정");
    await expect(page.locator(S.status)).not.toContainText(/denied|NotAllowed/i);
  });

  test("트랙 머리의 녹음 대기·음소거·솔로 단추가 한국어이고 머리 폭 안에 들어온다", async ({ page }) => {
    await openApp(page);
    const header = page.locator(S.trackHeader).first();
    const frame = (await header.boundingBox())!;
    const labels = ["녹음 대기", "음소거", "솔로"];
    const boxes = [];
    for (const label of labels) {
      const button = header.getByRole("button", { name: new RegExp(`${label}$`) });
      await expect(button).toHaveText(label);
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(frame.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 0.5);
      // 글자가 단추 밖으로 넘치거나 두 줄로 꺾이지 않는다
      expect(await button.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)).toBe(true);
      boxes.push(box);
    }
    // 서로 겹치지 않는다
    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width - 0.5);
    }
  });

  test("인스펙터의 라벨·이름표에 영어 이름이 남아 있지 않다", async ({ page }) => {
    await openApp(page);
    const inspector = page.locator(S.inspector);
    const text = (await inspector.textContent()) ?? "";
    for (const korean of ["트랙 믹스", "저음", "중저음", "중고음", "고음", "프레즌스", "컴프레서", "기준 음량", "압축 비율", "반응 시간", "회복 시간", "이퀄라이저", "딜레이", "리버브"]) {
      expect(text, korean).toContain(korean);
    }
    const english = /track mix|mute|solo|volume|bass|presence|compressor|threshold|ratio|attack|release|bypass|reverb|delay|modulation|equalizer|blend|width|filter/i;
    expect(text).not.toMatch(english);
    const names = await inspector.locator("[aria-label],[title]").evaluateAll((els) =>
      els.flatMap((el) => [el.getAttribute("aria-label"), el.getAttribute("title")].filter(Boolean) as string[]),
    );
    expect(names.filter((name) => english.test(name))).toEqual([]);
  });
});

// ───────────────────────── 2순위 ─────────────────────────

test("B3 템포 칸에 90을 입력하면 90이 된다", async ({ page }) => {
  await openApp(page);
  const tempo = page.locator(S.tempo);
  await tempo.click();
  await tempo.press("Control+a");
  await tempo.pressSequentially("90");
  await tempo.press("Enter");
  await expect(tempo).toHaveValue("90");
});

test.describe("B6·B7 녹음", () => {
  test("정지 버튼이 녹음도 끝내고, 녹음은 비어 있는 트랙에 놓인다", async ({ page }) => {
    await openApp(page);
    await upload(page); // 트랙 1에 반주
    await page.click('button[title="보컬 녹음"]');
    await page.waitForTimeout(1500);
    await page.click(S.stop);
    await page.waitForTimeout(800);
    await expect(page.locator(S.record)).not.toHaveClass(/recording/);
    const tops = await page.locator(S.clip).evaluateAll((els) =>
      els.map((el) => Math.round(parseFloat((el as HTMLElement).style.top))),
    );
    expect(new Set(tops).size).toBe(2); // 반주와 녹음이 서로 다른 트랙
  });
});

test.describe("B12 실행 취소 묶음", () => {
  test("슬라이더 한 번 끌기(30단계)는 Ctrl+Z 한 번으로 되돌아간다", async ({ page }) => {
    await openApp(page);
    const vol = page.locator(S.trackVolume).first();
    const before = await vol.inputValue();
    await vol.dispatchEvent("pointerdown");
    for (let i = 0; i < 30; i++) await setRange(page, S.trackVolume, 0.1 + i * 0.02);
    await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerup")));
    await page.mouse.click(700, 650);
    await page.keyboard.press("Control+z");
    await expect(vol).toHaveValue(before);
  });

  test("키보드 화살표 5번 조정도 Ctrl+Z 한 번으로 되돌아간다", async ({ page }) => {
    test.fail(true, "P5-1에서 해결 예정 (11/13 기준 한 단계씩 되돌아감)");
    await openApp(page);
    const vol = page.locator(S.trackVolume).first();
    const before = await vol.inputValue();
    await vol.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(900); // 묶음 시간(800ms) 경과
    await page.mouse.click(700, 650);
    await page.keyboard.press("Control+z");
    await expect(vol).toHaveValue(before);
  });
});

// ───────────────────────── 3순위 ─────────────────────────

test("C4 곡 끝에서 재생을 누르면 처음부터 재생된다", async ({ page }) => {
  await openApp(page);
  await upload(page); // 8초 클립 → 프로젝트 길이 12초
  for (let i = 0; i < 5; i++) await page.click(S.zoomOut); // 96 → 16px/초
  const ruler = (await page.locator(S.ruler).boundingBox())!;
  await page.mouse.click(ruler.x + 11.7 * 16, ruler.y + 5); // 11.7초로 이동
  await page.click(S.play);
  await page.waitForTimeout(1200); // 끝(12초)에 도달해 멈춤
  const base = await starts(page);
  await page.click(S.play);
  await page.waitForTimeout(400);
  expect(await starts(page)).toBeGreaterThan(base);
  await expect(page.locator(S.timeDisplay)).toHaveText(/^0:00\./);
});

test.describe("C8 출력 한계", () => {
  test("크게(0.8) 겹친 클립 2개도 출력이 0.95를 넘지 않고, 클립 1개보다 작아지지 않는다", async ({ page }) => {
    test.fail(!onNewEngine, "옛 엔진은 그대로다 (11/13 기준 1개 0.66 → 2개 0.56으로 과하게 눌림). 새 엔진은 P3-4에서 해결");
    await openApp(page, { query: P32_QUERY });
    await upload(page);
    const ruler = (await page.locator(S.ruler).boundingBox())!;
    await page.mouse.click(ruler.x + 4.5 * 96, ruler.y + 5);
    await page.click(S.play);
    await page.waitForTimeout(300);
    const single = await outputPeak(page);
    await page.click(S.stop);
    await upload(page); // 겹치므로 새 트랙에 들어간다
    await page.mouse.click(ruler.x + 4.5 * 96, ruler.y + 5);
    await page.click(S.play);
    await page.waitForTimeout(300);
    const double = await outputPeak(page);
    measured34("C8 겹친 0.8 클립 출력 최대값", { 클립_1개: single, 클립_2개: double });
    expect(double).toBeLessThanOrEqual(0.95);
    expect(double).toBeGreaterThanOrEqual(single);
  });
});

test.describe("C10 화면 갱신", () => {
  test("아무것도 안 할 때 화면 갱신 요청이 0회다", async ({ page }) => {
    await openApp(page);
    const a = await page.evaluate(() => (window as any).__raf);
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => (window as any).__raf)).toBe(a);
  });

  test("재생 중 화면 갱신 요청이 초당 70회 이하다(루프 하나)", async ({ page }) => {
    test.fail(true, "P5-3에서 해결 예정 (11/13 기준 초당 약 180회: 루프 3개)");
    await openApp(page);
    await upload(page);
    await page.click(S.play);
    await page.waitForTimeout(300);
    const a = await page.evaluate(() => (window as any).__raf);
    await page.waitForTimeout(1000);
    expect((await page.evaluate(() => (window as any).__raf)) - a).toBeLessThanOrEqual(70);
  });
});

test("P1-1 빌드 표시: 상태 줄 오른쪽에 빌드 번호가 보인다", async ({ page }) => {
  await openApp(page);
  const stamp = page.locator('[data-testid="build-stamp"]');
  await expect(stamp).toBeVisible();
  await expect(stamp).toHaveText(/^빌드 (local|[0-9a-f]{7})$/);
  await expect(stamp).toHaveAttribute("title", /^빌드 시각 \d{4}-\d{2}-\d{2}T/);
  // 배포 확인용: EXPECT_BUILD_COMMIT=$(git rev-parse --short=7 HEAD) 로 빌드했다면 같아야 한다.
  if (process.env.EXPECT_BUILD_COMMIT) await expect(stamp).toHaveText(`빌드 ${process.env.EXPECT_BUILD_COMMIT}`);
});

test("P1-6 사이트 기본 정보: 탭 제목, 파비콘, 공유 이미지", async ({ page, request }) => {
  await openApp(page);
  await expect(page).toHaveTitle("반주 디자이너 2");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "반주 디자이너 2");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#fff4d6");
  for (const url of ["/favicon.svg", "/og.png"]) expect((await request.get(url)).status(), url).toBe(200);
});

test("C2 휠을 굴려도 콘솔 오류가 쌓이지 않는다", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await openApp(page);
  await upload(page);
  await page.mouse.move(700, 500);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

test("C12·D6 노브를 키보드로 3번 올리면 3단계 오르고 초점이 남아 있다", async ({ page }) => {
  test.fail(true, "P5-0에서 해결 예정 (11/13 기준 1번만 오르고 초점이 사라짐)");
  await openApp(page);
  const knob = page.locator(S.eqBassKnob);
  await knob.scrollIntoViewIfNeeded();
  await knob.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowUp");
  await expect(page.locator(S.eqBassKnob)).toHaveAttribute("aria-valuenow", "1.5");
  await expect(page.locator(S.eqBassKnob)).toBeFocused();
});

test.describe("P4-1 문서 형식 v2", () => {
  /** 6월~11월 초의 프로젝트 모양(음원 목록 audioAssets, 마커 timeMarkers, 음원 안에 파형·blobUrl) */
  const legacyProject = (overrides: Record<string, unknown> = {}) => ({
    id: "legacy-file",
    name: "옛 파일",
    bpm: 100,
    sampleRate: 44100,
    tracks: [
      {
        id: "t1", name: "트랙 1", volume: 0.86, pan: 0, muted: false, solo: false,
        clips: [{ id: "c1", audioBufferId: "a1", trackId: "t1", name: "옛 음원", startTime: 0, offset: 0, duration: 8, sourceBpm: 100, stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0 }],
      },
    ],
    audioAssets: { a1: { id: "a1", fileName: "옛 음원.wav", duration: 8, sampleRate: 44100, channels: 2, waveformPeaks: [0, 0.5, 1], blobUrl: "javascript:alert(1)" } },
    timeMarkers: [],
    ...overrides,
  });

  const writeTemp = (testInfo: TestInfo, value: unknown) => {
    const file = path.join(os.tmpdir(), `ad2-p41-${testInfo.workerIndex}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };

  test("11월 형식 파일을 열면 소리와 파형이 돌아오고, 범위를 벗어난 값은 고쳐서 알린다", async ({ page }, testInfo) => {
    await openApp(page);
    const wav = fs.readFileSync(WAV).toString("base64");
    // 템포 999는 허용 범위(20~300)를 벗어난다 → 300으로 고치고 1개로 센다. 파형 점·blobUrl은 읽지 않는다.
    const file = writeTemp(testInfo, {
      format: "accompany-designer-project", version: 1, project: legacyProject({ bpm: 999 }), audio: { a1: `data:audio/wav;base64,${wav}` },
    });
    await page.setInputFiles(S.projectInput, file);
    await page.locator(S.confirmOk).click();

    await expect(page.locator(S.clip)).toHaveCount(1, { timeout: 5000 });
    await expect(page.locator(S.tempo)).toHaveValue("300");
    await expect(page.locator(S.status)).toContainText("값 1개를 허용 범위로 고쳤습니다");

    // 문서에는 파형이 없다. 음원을 풀면서 다시 계산해 그린다.
    const painted = await page.locator(`${S.clip} canvas`).first().evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1;
      return count;
    });
    expect(painted).toBeGreaterThan(200);
    fs.rmSync(file, { force: true });
  });

  test("6월 형식 파일(음원 없음)은 열리고, 음원이 빠졌다고 알린다", async ({ page }, testInfo) => {
    await openApp(page);
    const file = writeTemp(testInfo, legacyProject());
    await page.setInputFiles(S.projectInput, file);
    await page.locator(S.confirmOk).click();
    await expect(page.locator(S.status)).toContainText("음원 1개가 파일에 포함되지 않았습니다");
    await expect(page.locator(S.clip)).toHaveCount(1);
    await expect(page.locator(S.tempo)).toHaveValue("100");
    fs.rmSync(file, { force: true });
  });

  test("프로젝트 파일이 아닌 JSON과 악의적인 값은 열지 않고, 지금 작업은 그대로다", async ({ page }, testInfo) => {
    await openApp(page);
    await upload(page);
    for (const bad of [{ anything: true }, legacyProject({ tracks: [{ id: "__proto__", name: "x", volume: 1, pan: 0, muted: false, solo: false, clips: [] }] })]) {
      const file = writeTemp(testInfo, bad);
      await page.setInputFiles(S.projectInput, file);
      const alert = page.getByRole("alert").filter({ hasText: "프로젝트 불러오기 실패" });
      await expect(alert).toBeVisible();
      await expect(page.locator(S.clip)).toHaveCount(1); // 확인창을 거치기 전에 거부되므로 지금 작업은 그대로
      await expect(page.locator(S.confirmDialog)).toBeHidden();
      fs.rmSync(file, { force: true });
      await alert.getByRole("button", { name: "안내 닫기" }).click();
      await expect(alert).toHaveCount(0);
    }
  });
});

test.describe("P4-2 .adproj 파일과 음원 다시 연결", () => {
  /** 파일 메뉴의 "프로젝트 저장"으로 .adproj를 내려받아 영문 임시 경로에 둔다 */
  async function saveAdproj(page: Page, testInfo: TestInfo, label = "saved") {
    await page.locator(S.fileMenuTrigger).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(`${S.fileMenuPanel} [role="menuitem"]`).nth(2).click(),
    ]);
    // 헤드리스 크롬은 한글이 섞인 내려받기 이름을 그대로 알려 주지 않으므로 이름 대신 내용(zip)을 확인한다.
    const saved = path.join(os.tmpdir(), `ad2-p42-${label}-${testInfo.workerIndex}-${Date.now()}.adproj`);
    await download.saveAs(saved);
    return saved;
  }

  /** 음원 데이터만 뺀 프로젝트 파일. 문서에는 음원 해시가 그대로 남는다(파일이 잘렸거나 음원 폴더를 옮긴 경우). */
  function withoutAudio(adproj: string, testInfo: TestInfo) {
    const entries = unzipSync(new Uint8Array(fs.readFileSync(adproj)));
    const out = path.join(os.tmpdir(), `ad2-p42-noaudio-${testInfo.workerIndex}-${Date.now()}.adproj`);
    fs.writeFileSync(out, zipSync({ "project.json": [entries["project.json"], { level: 0 }] }));
    return out;
  }

  /** 6월 형식(음원 없음) 프로젝트: 음원 이름·길이가 quiet-loud-8s.wav와 같다 */
  function legacyFile(testInfo: TestInfo, asset: { fileName: string; duration: number } = { fileName: "quiet-loud-8s.wav", duration: 8 }) {
    const file = path.join(os.tmpdir(), `ad2-p42-legacy-${testInfo.workerIndex}-${Date.now()}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({
        id: "p42-legacy", name: "옛 파일", bpm: 100, sampleRate: 44100,
        tracks: [{ id: "t1", name: "트랙 1", volume: 0.86, pan: 0, muted: false, solo: false,
          clips: [{ id: "c1", audioBufferId: "a1", trackId: "t1", name: "옛 음원", startTime: 0, offset: 0, duration: 8, sourceBpm: 100, stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0 }] }],
        audioAssets: { a1: { id: "a1", fileName: asset.fileName, duration: asset.duration, sampleRate: 44100, channels: 2 } },
        timeMarkers: [],
      }),
    );
    return file;
  }

  /** 뒤 4초(큰 소리)에서 재생해 마스터 출력의 최고점을 잰다 */
  async function loudPeak(page: Page) {
    await clickRuler(page, 4.5, 96);
    await page.click(S.play);
    await page.waitForTimeout(400);
    const peak = await outputPeak(page, 600);
    await page.click(S.stop);
    return peak;
  }

  test("저장한 프로젝트 파일은 음원을 담은 zip이고, 새 브라우저 프로필에서 열어도 소리가 난다", async ({ page, browser, baseURL }, testInfo) => {
    await openApp(page);
    await upload(page);
    const saved = await saveAdproj(page, testInfo);
    await expect(page.locator(S.status)).toContainText("프로젝트 파일을 저장했습니다");

    const bytes = new Uint8Array(fs.readFileSync(saved));
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
    const entries = unzipSync(bytes);
    const wavBytes = fs.readFileSync(WAV);
    const hash = createHash("sha256").update(wavBytes).digest("hex");
    expect(Object.keys(entries).sort()).toEqual(["project.json", `audio/${hash}.wav`].sort());
    expect(Buffer.from(entries[`audio/${hash}.wav`]).equals(wavBytes)).toBe(true); // 음원 원본 그대로(base64로 부풀리지 않는다)
    expect(bytes.length).toBeLessThan(wavBytes.length + 20_000); // 원본 + project.json 정도
    const doc = JSON.parse(strFromBytes(entries["project.json"])).doc;
    expect(Object.values<any>(doc.assets).map((asset) => asset.hash)).toEqual([hash]);

    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    try {
      const fresh = await context.newPage();
      await openApp(fresh);
      await expect(fresh.locator(S.clip)).toHaveCount(0);
      await fresh.setInputFiles(S.projectInput, saved);
      await fresh.locator(S.confirmOk).click();
      await expect(fresh.locator(S.status)).toContainText("프로젝트와 음원을 불러왔습니다");
      await expect(fresh.locator(S.clip)).toHaveCount(1);
      await expect(fresh.locator(S.relinkDialog)).toBeHidden(); // 음원이 다 들어 있으므로 다시 연결할 것이 없다
      expect(await loudPeak(fresh)).toBeGreaterThan(0.25); // 소리가 난다
    } finally {
      await context.close();
      fs.rmSync(saved, { force: true });
    }
  });

  test("음원이 빠진 파일을 열면 재연결 대화상자가 뜨고, 이름·길이가 같은 파일은 확인한 뒤 연결된다(클립 수는 그대로, 새로고침 뒤에도 유지)", async ({ page }, testInfo) => {
    await openApp(page);
    const file = legacyFile(testInfo);
    await page.setInputFiles(S.projectInput, file);
    await page.locator(S.confirmOk).click();

    await expect(page.locator(S.relinkDialog)).toBeVisible();
    const row = page.locator(S.relinkRow);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("quiet-loud-8s.wav");
    await expect(row).toContainText("길이 0:08");
    await expect(row).toContainText("클립 1개");
    await expect(page.locator(S.clip)).toHaveCount(1);

    // 해시를 모르는 옛 파일이므로 같은 파일이어도 확인을 거친다.
    await page.setInputFiles(S.relinkInput, WAV);
    await expect(row).toHaveAttribute("data-state", "confirm");
    await expect(row).toContainText("이 파일로 연결할까요?");
    await page.locator(S.relinkConfirm).click();
    await expect(row).toHaveAttribute("data-state", "linked");
    await expect(row).toContainText("연결했습니다");
    await page.locator(S.relinkClose).click();
    await expect(page.locator(S.relinkDialog)).toBeHidden();
    await expect(page.locator(S.toast).filter({ hasText: "음원 1개를 모두 다시 연결했습니다" })).toBeVisible();

    await expect(page.locator(S.clip)).toHaveCount(1); // 클립 수는 그대로
    expect(await loudPeak(page)).toBeGreaterThan(0.25); // 소리가 난다

    // 문서는 그대로여도 연결한 음원 데이터는 자동 저장에 들어간다: 새로고침해도 다시 연결할 필요가 없다.
    await page.waitForTimeout(2500);
    await page.reload();
    await page.locator(S.inspector).waitFor();
    await expect(page.locator(S.status)).toContainText("자동 저장된 프로젝트와 음원을 복구했습니다", { timeout: 5000 });
    await expect(page.locator(S.relinkDialog)).toBeHidden();
    fs.rmSync(file, { force: true });
  });

  test("다른 파일을 고르면 연결하지 않고 이유를 보이며, 대화상자는 파일 메뉴에서 다시 열 수 있다", async ({ page }, testInfo) => {
    await openApp(page);
    const file = legacyFile(testInfo);
    await page.setInputFiles(S.projectInput, file);
    await page.locator(S.confirmOk).click();
    const row = page.locator(S.relinkRow);
    await expect(row).toHaveCount(1);

    await page.setInputFiles(S.relinkInput, STEADY); // 이름도 길이(12초)도 다르다
    await expect(row).toHaveAttribute("data-state", "different");
    await expect(row).toContainText("다른 파일로 보입니다(길이 0:08 / 0:12)");
    await expect(page.locator(S.relinkConfirm)).toHaveCount(0);

    await page.locator(S.relinkClose).click();
    await expect(page.locator(S.relinkDialog)).toBeHidden();
    await expect(page.locator(S.toast).filter({ hasText: "다시 연결했습니다" })).toHaveCount(0); // 연결한 것이 없으면 말하지 않는다

    // 닫은 뒤에도 파일 메뉴(맨 아래 항목)에서 다시 연다.
    await page.locator(S.fileMenuTrigger).click();
    await page.locator(`${S.fileMenuPanel} [role="menuitem"]`).last().click();
    await expect(page.locator(S.relinkDialog)).toBeVisible();
    await expect(page.locator(S.relinkRow)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(S.relinkDialog)).toBeHidden();
    fs.rmSync(file, { force: true });
  });

  test("해시를 아는 빠진 음원은 같은 파일을 고르면 확인 없이 연결하고, 다른 이름의 파일도 내용이 같으면 연결한다", async ({ page }, testInfo) => {
    await openApp(page);
    await upload(page);
    const saved = await saveAdproj(page, testInfo);
    const stripped = withoutAudio(saved, testInfo);

    await page.setInputFiles(S.projectInput, stripped);
    await page.locator(S.confirmOk).click();
    await expect(page.locator(S.relinkDialog)).toBeVisible();
    await expect(page.locator(S.status)).toContainText("음원 1개가 파일에 포함되지 않았습니다");
    const row = page.locator(S.relinkRow);
    await expect(row).toHaveCount(1);

    // 이름이 다른 사본: 내용(해시)이 같으므로 확인 없이 연결된다.
    const renamed = path.join(os.tmpdir(), `ad2-p42-copy-${testInfo.workerIndex}-${Date.now()}.wav`);
    fs.copyFileSync(WAV, renamed);
    await page.setInputFiles(S.relinkInput, renamed);
    await expect(row).toHaveAttribute("data-state", "linked");
    await expect(row).toContainText("같은 파일입니다. 연결했습니다.");
    await expect(page.locator(S.relinkConfirm)).toHaveCount(0);
    await page.locator(S.relinkClose).click();
    await expect(page.locator(S.clip)).toHaveCount(1);
    expect(await loudPeak(page)).toBeGreaterThan(0.25);
    for (const f of [saved, stripped, renamed]) fs.rmSync(f, { force: true });
  });

  test("평소에 같은 파일을 다시 올리면 새 클립을 만들지 않고 빠진 음원에 다시 연결하고, 이름만 같은 다른 파일은 새 클립이 된다", async ({ page }, testInfo) => {
    await openApp(page);
    await upload(page);
    const saved = await saveAdproj(page, testInfo);
    const stripped = withoutAudio(saved, testInfo);
    await page.setInputFiles(S.projectInput, stripped);
    await page.locator(S.confirmOk).click();
    await expect(page.locator(S.relinkDialog)).toBeVisible();
    await page.locator(S.relinkClose).click(); // 대화상자를 쓰지 않고 닫는다
    await expect(page.locator(S.clip)).toHaveCount(1);

    await page.setInputFiles(S.upload, WAV); // 같은 파일 → 기존 클립에 다시 연결
    await expect(page.locator(S.toast).filter({ hasText: "기존 클립 1개에 다시 연결했습니다" })).toBeVisible();
    await expect(page.locator(S.clip)).toHaveCount(1); // 새 클립이 생기지 않았다
    await expect(page.locator(S.trackHeader)).toHaveCount(1);
    expect(await loudPeak(page)).toBeGreaterThan(0.25);

    // 이미 연결된 뒤에는 같은 파일도 평소처럼 새 클립이 된다.
    await page.setInputFiles(S.upload, WAV);
    await expect(page.locator(S.clip)).toHaveCount(2);
    for (const f of [saved, stripped]) fs.rmSync(f, { force: true });
  });

  test("11월 형식(JSON) 파일을 열어 다시 저장하면 .adproj가 되고 음원 해시가 채워진다", async ({ page }, testInfo) => {
    await openApp(page);
    const wavBytes = fs.readFileSync(WAV);
    const file = path.join(os.tmpdir(), `ad2-p42-v1-${testInfo.workerIndex}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({
      format: "accompany-designer-project", version: 1,
      project: {
        id: "p42-v1", name: "옛 프로젝트", bpm: 100, sampleRate: 44100,
        tracks: [{ id: "t1", name: "트랙 1", volume: 0.86, pan: 0, muted: false, solo: false,
          clips: [{ id: "c1", audioBufferId: "a1", trackId: "t1", name: "음원", startTime: 0, offset: 0, duration: 8, sourceBpm: 100, stretchMode: "none", gain: 1, fadeIn: 0, fadeOut: 0 }] }],
        audioAssets: { a1: { id: "a1", fileName: "quiet-loud-8s.wav", duration: 8, sampleRate: 44100, channels: 2, mimeType: "audio/wav" } },
        timeMarkers: [],
      },
      audio: { a1: `data:audio/wav;base64,${wavBytes.toString("base64")}` },
    }));
    await page.setInputFiles(S.projectInput, file);
    await page.locator(S.confirmOk).click();
    await expect(page.locator(S.status)).toContainText("프로젝트와 음원을 불러왔습니다");
    await expect(page.locator(S.relinkDialog)).toBeHidden();

    const saved = await saveAdproj(page, testInfo, "from-v1");
    const entries = unzipSync(new Uint8Array(fs.readFileSync(saved)));
    const hash = createHash("sha256").update(wavBytes).digest("hex");
    expect(Object.keys(entries).sort()).toEqual(["project.json", `audio/${hash}.wav`].sort());
    expect(JSON.parse(strFromBytes(entries["project.json"])).doc.assets.a1.hash).toBe(hash);
    for (const f of [file, saved]) fs.rmSync(f, { force: true });
  });
});


test.describe("P4-3 다단계 파형과 확대 범위", () => {
  /** 클립 파형 캔버스마다 그려진 모양: 가장 높은 막대(장치 픽셀), 그려진 칸 수, 중심선을 지나지 않는 막대 수. 왼쪽부터 순서대로. */
  async function waveformStats(page: Page) {
    return page.evaluate(() => {
      const canvases = [...document.querySelectorAll<HTMLCanvasElement>('[data-testid="clip-waveform"]')];
      return canvases
        .map((canvas) => {
          const context = canvas.getContext("2d")!;
          const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
          const middle = height / 2;
          let tallest = 0;
          let drawn = 0;
          let offCenter = 0;
          for (let x = 0; x < width; x++) {
            let top = -1;
            let bottom = -1;
            for (let y = 0; y < height; y++) {
              if (data[(y * width + x) * 4 + 3] > 0) {
                if (top < 0) top = y;
                bottom = y;
              }
            }
            if (top < 0) continue;
            drawn++;
            tallest = Math.max(tallest, bottom - top + 1);
            if (bottom < middle - 1 || top > middle + 1) offCenter++;
          }
          return { left: canvas.getBoundingClientRect().left, tallest, drawn, offCenter };
        })
        .sort((a, b) => a.left - b.left);
    });
  }

  /** 모든 클립의 파형에 높이가 그려질 때까지 기다린다(파형은 Worker가 따로 계산해 나중에 채운다) */
  async function waitForWaveforms(page: Page, count: number, timeout = 20_000) {
    await expect
      .poll(async () => {
        const stats = await waveformStats(page);
        return stats.length === count && stats.every((item) => item.drawn > 0);
      }, { timeout })
      .toBe(true);
  }

  const COUNT_PEAKS_WORKERS = `(() => {
    window.__peaksWorkers = 0;
    window.__peaksWorkerAt = -1;
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("peaks")) {
          window.__peaksWorkers++;
          if (window.__peaksWorkerAt < 0) window.__peaksWorkerAt = performance.now();
        }
      }
    };
  })();`;
  const peaksWorkers = (page: Page) => page.evaluate(() => (window as any).__peaksWorkers as number);

  const LONG_TASKS = `(() => {
    window.__longTasks = [];
    window.__longTaskStarts = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__longTasks.push(Math.round(entry.duration));
          window.__longTaskStarts.push(Math.round(entry.startTime));
        }
      }).observe({ type: "longtask", buffered: true });
    } catch (error) { /* 긴 작업 관찰을 못 하는 환경 */ }
  })();`;

  const scrollInfo = (page: Page) =>
    page.locator(S.timelineScroll).evaluate((el) => ({ left: el.scrollLeft, width: el.scrollWidth, client: el.clientWidth }));

  test("B1 한 곡을 4초에서 자르면 작은 소리 쪽 조각의 파형 높이가 큰 소리 쪽의 1/8 이하다", async ({ page }) => {
    await openApp(page);
    await upload(page); // 앞 4초 0.05, 뒤 4초 0.8
    await waitForWaveforms(page, 1);
    await page.keyboard.press("c"); // 자르기 도구
    const box = (await page.locator(S.clip).boundingBox())!;
    await page.mouse.click(box.x + 4 * 96, box.y + box.height / 2);
    await expect(page.locator(S.clip)).toHaveCount(2);
    await waitForWaveforms(page, 2);
    const [quiet, loud] = await waveformStats(page);
    measuredP43("B1 자른 조각의 가장 높은 막대(장치 픽셀)", { 작은쪽: quiet.tallest, 큰쪽: loud.tallest, 비율: +(quiet.tallest / loud.tallest).toFixed(3) });
    expect(quiet.tallest).toBeLessThanOrEqual(loud.tallest / 8);
    expect(loud.tallest).toBeGreaterThan(30); // 큰 쪽은 칸 높이를 거의 채운다
  });

  test("저장소 캐시: 음원을 올리면 파형이 해시로 저장되고, 새로 열었을 때는 Worker 없이 캐시에서 읽는다", async ({ page }) => {
    await page.addInitScript(COUNT_PEAKS_WORKERS);
    await openApp(page);
    await upload(page);
    await waitForWaveforms(page, 1);
    expect(await peaksWorkers(page)).toBe(1); // 처음에는 Worker가 계산했다
    const hash = createHash("sha256").update(fs.readFileSync(WAV)).digest("hex");
    const storedKeys = () =>
      page.evaluate(
        () =>
          new Promise<string[]>((resolve, reject) => {
            const open = indexedDB.open("accompany-designer");
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const request = open.result.transaction("peaks", "readonly").objectStore("peaks").getAllKeys();
              request.onsuccess = () => { open.result.close(); resolve(request.result.map(String)); };
              request.onerror = () => reject(request.error);
            };
          }),
      );
    await expect.poll(storedKeys, { timeout: 5000 }).toEqual([0, 1, 2, 3].map((level) => `${hash}:${level}`));

    await page.waitForTimeout(2000); // 자동 저장(1.2초 뒤)
    // 한 번 새로고침: 복구한 음원은 오프라인 장치(44.1kHz)로 풀기 때문에 소리 장치와 샘플레이트가 다르면 한 번 다시 계산하고 캐시를 갈아 쓴다.
    await page.reload();
    await expect(page.locator(S.clip)).toHaveCount(1, { timeout: 5000 });
    await waitForWaveforms(page, 1);
    await page.waitForTimeout(500);
    // 두 번째 새로고침부터는 같은 방식으로 풀리므로 계산 없이 캐시에서 읽는다.
    await page.reload();
    await expect(page.locator(S.clip)).toHaveCount(1, { timeout: 5000 });
    await waitForWaveforms(page, 1);
    expect(await peaksWorkers(page), "캐시에서 읽었으므로 파형 Worker를 만들지 않는다").toBe(0);
    expect(await storedKeys()).toHaveLength(4); // 같은 해시는 한 벌만 있다
  });

  test("확대 범위: 위쪽 끝은 1,000px/초, 짧은 곡의 아래쪽 끝은 1px/초(눈금이 솎인다)", async ({ page }) => {
    await openApp(page);
    await upload(page); // 8초 클립 → 프로젝트 12초
    await waitForWaveforms(page, 1);
    const zoomBy = async (clicks: number, direction: -1 | 1) => {
      await page.locator(S.timelineScroll).hover({ position: { x: 300, y: 80 } });
      await page.keyboard.down("Control");
      for (let i = 0; i < clicks; i++) await page.mouse.wheel(0, direction * -100);
      await page.keyboard.up("Control");
      await page.waitForTimeout(150);
    };
    await zoomBy(60, 1); // 96 × 1.14^60 이 1,000을 훌쩍 넘으므로 위쪽 끝에서 멈춘다
    const clipWidth = (await page.locator(S.clip).boundingBox())!.width;
    expect(clipWidth).toBeGreaterThan(8 * 1000 - 2);
    expect(clipWidth).toBeLessThan(8 * 1000 + 2);

    await zoomBy(120, -1);
    const ticks = await page.locator(".ruler-tick").evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).offsetLeft));
    // 1px/초에서 한 박(0.5초)은 0.5px → 16박(8px)마다 눈금 하나. 12초 곡이라 눈금이 몇 개 안 된다.
    expect(ticks[1] - ticks[0]).toBeGreaterThanOrEqual(6);
    expect(ticks[1] - ticks[0]).toBeLessThanOrEqual(16);
    expect(ticks.length).toBeLessThan(200); // 눈금자 폭(1200px 안팎) ÷ 6px. 솎기 전에는 박마다라 2,400개였다.
  });

  test("최대로 확대하면 원본 샘플을 읽어 그린다: 소리가 한쪽에 치우친 칸(중심선을 지나지 않는 막대)이 보인다", async ({ page }) => {
    await openApp(page);
    await upload(page);
    await waitForWaveforms(page, 1);
    for (let i = 0; i < 62; i++) await page.keyboard.press("PageUp"); // 96 → 1,000(한 번에 16)
    await page.locator(S.timelineScroll).evaluate((el) => { el.scrollLeft = 5200; }); // 큰 소리 구간(5.2초~)
    // 스크롤한 뒤 캔버스가 새 자리를 다시 그리기까지 잠깐 걸린다. 그 사이에 읽으면 스크롤하기 전(조용한 처음 구간)의 그림이 잡혀
    // 칸 수는 넘지만 막대가 모두 중심선 위에 있다(CPU가 바쁠 때 가끔). 그래서 '칸이 그려졌다'에서 멈추지 않고, 확인하려는 모양이 나올 때까지 기다린다.
    await expect
      .poll(async () => {
        const [first] = await waveformStats(page);
        return first ? first.drawn > 200 && first.offCenter > 20 && first.tallest >= 20 : false;
      }, { timeout: 5000 })
      .toBe(true);
    const [stats] = await waveformStats(page);
    measuredP43("1,000px/초 파형", { 칸: stats.drawn, 중심선을_지나지_않는_막대: stats.offCenter, 가장_높은_막대: stats.tallest });
    expect(stats.offCenter).toBeGreaterThan(20);
    expect(stats.tallest).toBeGreaterThanOrEqual(20); // 영점을 지나는 칸은 한 칸에 위아래로 크게 벌어진다
  });

  test("전체 보기: 버튼과 Shift+0이 프로젝트 전체를 화면 폭에 맞추고 처음으로 돌아간다", async ({ page }) => {
    await openApp(page);
    await upload(page, STEADY_3MIN);
    await waitForWaveforms(page, 1, 30_000);
    await page.locator(S.timelineScroll).evaluate((el) => { el.scrollLeft = 3000; });
    expect((await scrollInfo(page)).width).toBeGreaterThan((await scrollInfo(page)).client * 5); // 96px/초에서 3분 곡은 화면 몇 개 분량이다
    await page.click(S.zoomFit);
    await page.waitForTimeout(200);
    const fitted = await scrollInfo(page);
    expect(fitted.width).toBeLessThanOrEqual(fitted.client + 1); // 가로로 더 스크롤할 것이 없다
    expect(fitted.left).toBe(0);
    await waitForWaveforms(page, 1);

    for (let i = 0; i < 5; i++) await page.keyboard.press("PageUp");
    expect((await scrollInfo(page)).width).toBeGreaterThan(fitted.client);
    await page.keyboard.press("Shift+Digit0");
    await page.waitForTimeout(200);
    const again = await scrollInfo(page);
    expect(again.width).toBeLessThanOrEqual(again.client + 1);
    expect(again.left).toBe(0);
  });

  test("1시간 음원: 올리면 파형이 보이고, 파형을 계산하는 동안 화면 스레드는 200 ms 넘게 멈추지 않는다", async ({ page }) => {
    test.setTimeout(300_000);
    await page.addInitScript(LONG_TASKS);
    await page.addInitScript(COUNT_PEAKS_WORKERS);
    await openApp(page);
    const startedAt = Date.now();
    await page.setInputFiles(S.upload, HOUR);
    await expect(page.locator(S.clip)).toHaveCount(1, { timeout: 180_000 });
    const decodedAt = Date.now();
    await waitForWaveforms(page, 1, 180_000);
    const drawnAt = Date.now();
    expect(await peaksWorkers(page)).toBe(1);

    await page.click(S.zoomFit);
    await page.waitForTimeout(500);
    const fitted = await scrollInfo(page);
    expect(fitted.width).toBeLessThanOrEqual(fitted.client + 1); // 1시간이 한 화면에 들어온다
    const clipBox = (await page.locator(S.clip).boundingBox())!;
    expect(clipBox.width).toBeGreaterThan(fitted.client * 0.8);

    // 전체 보기에서 앞 30분(0.8)과 뒤 30분(0.2): 음원 전체에서 가장 큰 소리가 칸 높이를 채우므로 뒤쪽 높이는 1/4 안팎이다.
    await waitForWaveforms(page, 1);
    const columns = await page.locator(S.waveform).evaluate((canvas: HTMLCanvasElement) => {
      const { data, width, height } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      const heightAt = (x: number) => {
        let top = -1;
        let bottom = -1;
        for (let y = 0; y < height; y++) if (data[(y * width + x) * 4 + 3] > 0) { if (top < 0) top = y; bottom = y; }
        return top < 0 ? 0 : bottom - top + 1;
      };
      return { width, quarter: heightAt(Math.floor(width * 0.25)), threeQuarters: heightAt(Math.floor(width * 0.7)) };
    });
    expect(columns.quarter).toBeGreaterThan(columns.threeQuarters * 2.5);
    expect(columns.threeQuarters).toBeGreaterThan(3);

    // 긴 작업은 "파형 계산 전"(브라우저가 1시간 음원을 디코딩해 AudioBuffer를 만드는 단계 + 클립 만들기)과 "파형 계산 중"(파형 Worker를 만든 뒤)으로 나눠 센다.
    // 설계서의 수용 기준은 "피크 계산 중" 긴 작업 0건이다. 디코딩은 브라우저 안쪽(635MB 버퍼 만들기)이라 우리 코드로 줄일 수 없어 따로 기록만 한다.
    const { durations, starts, workerAt } = await page.evaluate(() => ({
      durations: (window as any).__longTasks as number[],
      starts: (window as any).__longTaskStarts as number[],
      workerAt: (window as any).__peaksWorkerAt as number,
    }));
    expect(workerAt, "파형 Worker를 만든 시각").toBeGreaterThan(0);
    const before = durations.filter((_, i) => starts[i] < workerAt);
    const during = durations.filter((_, i) => starts[i] >= workerAt);
    measuredP43("1시간 음원", {
      올리기부터_클립까지_초: +((decodedAt - startedAt) / 1000).toFixed(1),
      클립부터_파형까지_초: +((drawnAt - decodedAt) / 1000).toFixed(1),
      긴작업_파형_계산_전_ms: before,
      긴작업_파형_계산_중_ms: during,
    });
    expect(during.filter((ms) => ms >= 200), `파형 계산 중 200 ms 넘게 멈춘 작업: ${during.join(", ")}`).toEqual([]);
  });
});

const STEADY_3MIN = path.join(here, "fixtures", "steady-220hz-180s.wav");
/** 측정값은 한 줄로 남긴다: 병합 기록의 이전/이후 표에 그대로 옮긴다. */
const measuredP43 = (name: string, value: unknown) => console.log(`P4-3 측정 ${name}: ${JSON.stringify(value)}`);

/** P4-4 측정값도 한 줄로 남긴다: 병합 기록의 이전/이후 표에 그대로 옮긴다. */
const measuredP44 = (name: string, value: unknown) => console.log(`P4-4 측정 ${name}: ${JSON.stringify(value)}`);

test.describe("P4-4 템포 맞춤·BPM 감지·숫자 칸", () => {
  const PITCH_NOTICE = "지금은 속도와 음정이 함께 바뀝니다. 음정을 유지하는 방식은 나중에 추가합니다.";

  /** 긴 작업(50 ms 이상)의 길이와 시작 시각을 모은다 */
  const LONG_TASKS = `(() => {
    window.__longTasks = [];
    window.__longTaskStarts = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__longTasks.push(Math.round(entry.duration));
          window.__longTaskStarts.push(Math.round(entry.startTime));
        }
      }).observe({ type: "longtask", buffered: true });
    } catch (error) { /* 긴 작업 관찰을 못 하는 환경 */ }
  })();`;

  /**
   * BPM Worker를 센다. delayMs > 0이면 Worker로 가는 메시지를 처음 보낸 때부터 그만큼 모아 두었다가 순서대로 한꺼번에 보내
   * ("분석 중" 화면과 취소를 안정적으로 볼 수 있게), 그 뒤로는 그대로 보낸다.
   */
  const BPM_WORKER_PROBE = (delayMs: number) => `(() => {
    window.__bpmWorkers = 0;
    window.__bpmTerminated = 0;
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url, options) {
        super(url, options);
        this.__bpm = String(url).includes("bpm");
        this.__held = [];
        this.__released = ${delayMs} <= 0;
        if (this.__bpm) window.__bpmWorkers++;
      }
      postMessage(message, transfer) {
        if (!this.__bpm || this.__released) return super.postMessage(message, transfer);
        this.__held.push([message, transfer]);
        if (this.__held.length === 1) {
          setTimeout(() => {
            this.__released = true;
            for (const [held, heldTransfer] of this.__held) super.postMessage(held, heldTransfer);
            this.__held = [];
          }, ${delayMs});
        }
      }
      terminate() {
        if (this.__bpm) window.__bpmTerminated++;
        super.terminate();
      }
    };
  })();`;
  const bpmWorkers = (page: Page) => page.evaluate(() => ({ created: (window as any).__bpmWorkers as number, terminated: (window as any).__bpmTerminated as number }));

  /** 숫자 칸에 값을 넣고 확정(Enter)한다 */
  async function typeInto(field: Locator, value: string) {
    await field.click();
    await field.press("Control+a");
    await field.pressSequentially(value);
    await field.press("Enter");
  }

  const selectFirstClip = (page: Page) => page.locator(S.clip).first().click({ position: { x: 60, y: 40 } });

  /** 10분 곡을 올리고 그 클립을 고른다 */
  async function uploadClickSong(page: Page) {
    await page.setInputFiles(S.upload, CLICK_10MIN);
    await expect(page.locator(S.clip)).toHaveCount(1, { timeout: 60_000 });
    await selectFirstClip(page);
    await expect(page.locator(S.bpmDetect)).toBeVisible();
  }

  const pitchToast = (page: Page) => page.locator(S.toast).filter({ hasText: PITCH_NOTICE });

  test("B4 이름은 '템포 맞춤(음정도 바뀜)'이고, 처음 켤 때 한 번만 속도와 음정이 함께 바뀐다고 알린다", async ({ page }) => {
    await openApp(page);
    await upload(page);
    await selectFirstClip(page);
    const toggle = page.locator(`${S.inspector} ${S.warpToggle}`);
    await expect(toggle).toContainText("템포 맞춤(음정도 바뀜)");
    await expect(page.locator(S.inspector)).not.toContainText("WARP");
    await expect(pitchToast(page)).toHaveCount(0); // 켜기 전에는 알리지 않는다

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(pitchToast(page)).toHaveCount(1);
    await expect(pitchToast(page)).toHaveClass(/toast--warning/);
    expect(await page.evaluate(() => window.localStorage.getItem("ad.tempoMatchPitchNoticeSeen"))).toBe("1");

    // 껐다 켜도 다시 알리지 않는다(같은 안내가 한 번 더 왔다면 ×2로 횟수가 오른다)
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(pitchToast(page)).toHaveCount(1);
    await expect(pitchToast(page)).not.toContainText("×2");

    // 새로고침해도(이 브라우저에서 이미 본 안내) 처음 켜는 것으로는 다시 알리지 않는다.
    await page.reload();
    await page.locator(S.inspector).waitFor();
    await page.waitForTimeout(1200);
    if ((await page.locator(S.clip).count()) === 0) await upload(page);
    await selectFirstClip(page);
    if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(600);
    await expect(pitchToast(page)).toHaveCount(0);
  });

  test("B4 템포 123·원본 BPM 120이면 배속 1.025×와 +0.43반음이 보이고, 템포를 바꾸면 따라간다", async ({ page }) => {
    await openApp(page);
    await upload(page);
    await selectFirstClip(page);
    const rate = page.locator(`${S.inspector} ${S.warpRate}`);
    const pitch = page.locator(`${S.inspector} ${S.warpPitch}`);
    await typeInto(page.locator(S.tempo), "123");
    await typeInto(page.locator(`${S.inspector} ${S.sourceBpm}`), "120");

    // 꺼져 있으면 속도도 음정도 그대로
    await expect(rate).toHaveText("1.00×");
    await expect(pitch).toHaveText("0반음");

    await page.locator(`${S.inspector} ${S.warpToggle}`).click();
    await expect(rate).toHaveText("1.025×");
    await expect(pitch).toHaveText("+0.43반음");
    measuredP44("B4 템포 123 / 원본 120", { 배속: await rate.innerText(), 음정: await pitch.innerText() });

    await typeInto(page.locator(S.tempo), "108");
    await expect(rate).toHaveText("0.90×");
    await expect(pitch).toHaveText("-1.82반음");

    await page.locator(`${S.inspector} ${S.warpToggle}`).click(); // 끄면 다시 그대로
    await expect(rate).toHaveText("1.00×");
    await expect(pitch).toHaveText("0반음");
  });

  test("B5 10분짜리 곡의 BPM을 감지하는 동안 화면 스레드는 200 ms 넘게 멈추지 않고, 결과는 120 안팎이다", async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(LONG_TASKS);
    await page.addInitScript(BPM_WORKER_PROBE(0));
    await openApp(page);
    await uploadClickSong(page);

    const startedAt = await page.evaluate(() => performance.now());
    const clickedAt = Date.now();
    await page.locator(S.bpmDetect).click();
    await expect(page.locator(S.bpmResult)).toBeVisible({ timeout: 90_000 });
    const tookMs = Date.now() - clickedAt;
    const finishedAt = await page.evaluate(() => performance.now());

    const detected = Number(await page.locator(S.bpmResultText).getAttribute("data-value"));
    expect(Math.abs(detected - 120), `감지값 ${detected}`).toBeLessThanOrEqual(1);
    await expect(page.locator(S.bpmResultText)).toContainText(`추정 BPM ${detected}`);
    expect(await bpmWorkers(page)).toEqual({ created: 1, terminated: 1 }); // 분석은 Worker가 했고, 끝나면 Worker를 끝낸다

    const { durations, starts } = await page.evaluate(() => ({
      durations: (window as any).__longTasks as number[],
      starts: (window as any).__longTaskStarts as number[],
    }));
    const during = durations.filter((_, i) => starts[i] >= startedAt && starts[i] <= finishedAt);
    measuredP44("B5 10분 곡 감지", { 감지값: detected, 걸린_ms: tookMs, 긴작업_감지_중_ms: during });
    expect(during.filter((ms) => ms >= 200), `감지 중 200 ms 넘게 멈춘 작업: ${during.join(", ")}`).toEqual([]);
  });

  test("B5 CPU를 10배 늦춘 느린 기기에서도 감지 중 화면 스레드는 200 ms 넘게 멈추지 않는다(소리를 작은 덩어리로 나눠 보내므로)", async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(LONG_TASKS);
    await openApp(page);
    await uploadClickSong(page);
    await page.waitForTimeout(2500); // 올린 직후의 파형 계산 등이 가라앉은 뒤에 잰다

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 10 });
    const startedAt = await page.evaluate(() => performance.now());
    const clickedAt = Date.now();
    await page.locator(S.bpmDetect).click();
    await expect(page.locator(S.bpmResult)).toBeVisible({ timeout: 120_000 });
    const tookMs = Date.now() - clickedAt;
    const finishedAt = await page.evaluate(() => performance.now());
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

    expect(Math.abs(Number(await page.locator(S.bpmResultText).getAttribute("data-value")) - 120)).toBeLessThanOrEqual(1);
    const { durations, starts } = await page.evaluate(() => ({
      durations: (window as any).__longTasks as number[],
      starts: (window as any).__longTaskStarts as number[],
    }));
    const during = durations.filter((_, i) => starts[i] >= startedAt && starts[i] <= finishedAt);
    measuredP44("B5 10분 곡 감지(CPU 10배 느리게)", { 걸린_ms: tookMs, 긴작업_감지_중_ms: during });
    expect(during.filter((ms) => ms >= 200), `감지 중 200 ms 넘게 멈춘 작업: ${during.join(", ")}`).toEqual([]);
  });

  test("B5 결과의 ×½·×2로 값을 고치고, 클립 원본 BPM·프로젝트 템포에 적용한다", async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page);
    await uploadClickSong(page);
    await page.locator(S.bpmDetect).click();
    await expect(page.locator(S.bpmResult)).toBeVisible({ timeout: 90_000 });

    const text = page.locator(S.bpmResultText);
    const detected = Number(await text.getAttribute("data-value"));
    await expect(text).toContainText("곡에 따라 절반이나 두 배로 감지될 수 있습니다");
    const doubled = Math.round(detected * 2 * 10) / 10;
    await page.locator(S.bpmDouble).click();
    await expect(text).toHaveAttribute("data-value", String(doubled));
    await expect(text).toContainText(`추정 BPM ${doubled}`);
    await expect(page.locator(S.bpmDouble)).toBeDisabled(); // 한 번 더 곱하면 300을 넘는다

    await page.locator(S.bpmHalf).click();
    await expect(text).toHaveAttribute("data-value", String(detected));
    await page.locator(S.bpmHalf).click();
    const halved = Math.round(detected * 0.5 * 10) / 10;
    await expect(text).toHaveAttribute("data-value", String(halved));
    await expect(text).toContainText(`추정 BPM ${halved}`);

    await page.locator(S.bpmApplyClip).click();
    await expect(page.locator(`${S.inspector} ${S.sourceBpm}`)).toHaveValue(String(halved));
    await expect(page.locator(S.status)).toContainText(`클립 원본 BPM을 ${halved}(으)로 설정했습니다.`);
    await page.locator(S.bpmApplyProject).click();
    await expect(page.locator(S.tempo)).toHaveValue(String(halved));
    await expect(page.locator(S.status)).toContainText(`프로젝트 템포를 ${halved}(으)로 설정했습니다.`);
  });

  test("B5 분석하는 동안 진행 표시와 [취소]가 보이고, 취소하면 Worker를 끝내며 결과는 나오지 않는다", async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(BPM_WORKER_PROBE(2500)); // 분석 요청을 2.5초 늦춰 "분석 중"을 안정적으로 본다
    await openApp(page);
    await uploadClickSong(page);

    await page.locator(S.bpmDetect).click();
    const progress = page.locator(S.bpmProgress);
    await expect(progress).toBeVisible();
    await expect(progress).toContainText("BPM 분석 중");
    await expect(progress.locator("progress")).toHaveAttribute("aria-label", "BPM 분석 진행률");
    await expect(page.locator(S.bpmDetect)).toBeDisabled(); // 돌고 있는 동안 또 시작하지 못한다

    await page.locator(S.bpmCancel).click();
    await expect(progress).toHaveCount(0);
    await expect(page.locator(S.bpmStatus)).toHaveText("BPM 분석을 취소했습니다.");
    await expect(page.locator(S.bpmDetect)).toBeEnabled();
    expect((await bpmWorkers(page)).terminated).toBe(1);

    await page.waitForTimeout(3500); // 늦춘 요청이 보내졌어도(Worker는 이미 끝났다) 결과는 나오지 않는다
    await expect(page.locator(S.bpmResult)).toHaveCount(0);

    // 취소한 뒤 다시 감지하면 처음부터 돌아 결과가 나온다
    await page.locator(S.bpmDetect).click();
    await expect(page.locator(S.bpmResult)).toBeVisible({ timeout: 60_000 });
    expect(Math.abs(Number(await page.locator(S.bpmResultText).getAttribute("data-value")) - 120)).toBeLessThanOrEqual(1);
  });

  test("클립 게인과 마스터 볼륨은 숫자 칸으로도 입력하고, 범위를 넘는 값은 끝값으로 맞춘다", async ({ page }) => {
    await openApp(page);
    await upload(page);
    await selectFirstClip(page);

    const gain = page.locator(S.clipGainInput);
    const gainSlider = page.locator(S.clipGain);
    await expect(gain).toHaveValue("1");
    await typeInto(gain, "1.5");
    await expect(gainSlider).toHaveValue("1.5");
    await typeInto(gain, "9");
    await expect(gain).toHaveValue("2");
    await expect(gainSlider).toHaveValue("2");
    await typeInto(gain, "-3");
    await expect(gain).toHaveValue("0");
    await setRange(page, S.clipGain, 0.75); // 슬라이더를 움직이면 숫자 칸이 따라온다
    await expect(gain).toHaveValue("0.75");

    const master = page.locator(S.masterVolumeInput);
    await typeInto(master, "-12");
    await expect(page.locator(S.masterVolumeValue)).toHaveText("-12.0 dB");
    await expect(page.locator(S.masterVolume)).toHaveValue("-12");
    await typeInto(master, "20");
    await expect(page.locator(S.masterVolumeValue)).toHaveText("+6.0 dB");
    await typeInto(master, "-99");
    await expect(page.locator(S.masterVolumeValue)).toHaveText("-60.0 dB");
    await typeInto(master, "0");
    await expect(page.locator(S.masterVolumeValue)).toHaveText("0.0 dB");
  });
});

const measuredP45 = (name: string, value: unknown) => console.log(`P4-5 측정 ${name}: ${JSON.stringify(value)}`);

test.describe("P4-5 클립 배치 규칙", () => {
  /** 숫자 칸에 값을 넣고 확정(Enter)한다 */
  async function typeInto(field: Locator, value: string) {
    await field.click();
    await field.press("Control+a");
    await field.pressSequentially(value);
    await field.press("Enter");
  }

  /** 클립이 놓인 줄(트랙)을 가리키는 세로 위치: 같은 트랙의 클립은 같은 값이다 */
  const rowOf = async (page: Page, index: number) => Math.round((await page.locator(S.clip).nth(index).boundingBox())!.y);

  test("B8 올린 음원은 그 구간이 비어 있으면 선택한 트랙에, 겹치면 새 트랙에 놓인다 — 템포 맞춤으로 짧아진 클립은 줄어든 길이로 판단한다", async ({ page }) => {
    await openApp(page);
    await upload(page); // 8초 클립: 트랙 1의 0~8초
    await expect(page.locator(S.trackHeader)).toHaveCount(1);

    // 프로젝트 템포 240 · 원본 BPM 120 · 템포 맞춤 켜기 → 배속 2: 클립이 타임라인에서 0~4초만 차지한다
    await page.locator(S.clip).first().click({ position: { x: 60, y: 40 } });
    await typeInto(page.locator(S.tempo), "240");
    await typeInto(page.locator(`${S.inspector} ${S.sourceBpm}`), "120");
    await page.locator(`${S.inspector} ${S.warpToggle}`).click();
    await expect(page.locator(`${S.inspector} ${S.warpRate}`)).toHaveText("2.00×");

    // 5초에서 올리면 5~13초: 템포 맞춤 클립(0~4초) 뒤라 비어 있다 → 같은 트랙(원본 길이 8초로 보면 겹친다고 잘못 판단해 새 트랙이 생김)
    await clickRuler(page, 5, 96);
    await upload(page);
    const sameTrack = await page.locator(S.trackHeader).count();
    const rows = [await rowOf(page, 0), await rowOf(page, 1)];
    measuredP45("템포 맞춤 클립(0~4초) 뒤 5초에 올리기", { 트랙_수: sameTrack, 클립_줄: rows });
    await expect(page.locator(S.trackHeader)).toHaveCount(1);
    expect(rows[1]).toBe(rows[0]);

    // 3초에서 올리면 3~11초: 템포 맞춤 클립(0~4초)과 5초 클립 둘 다에 걸친다 → 새 트랙
    await clickRuler(page, 3, 96);
    await upload(page);
    await expect(page.locator(S.trackHeader)).toHaveCount(2);
    const rowsAfter = [await rowOf(page, 0), await rowOf(page, 1), await rowOf(page, 2)];
    expect(rowsAfter[1]).toBe(rowsAfter[0]);
    expect(rowsAfter[2]).not.toBe(rowsAfter[0]);
  });

  test("B8 같은 자리에 두 번째로 올리면 새 트랙에 놓이고, 한 줄에 겹쳐 놓이지 않는다", async ({ page }) => {
    await openApp(page);
    await upload(page);
    await upload(page);
    await expect(page.locator(S.trackHeader)).toHaveCount(2);
    expect(await rowOf(page, 1)).not.toBe(await rowOf(page, 0));
  });

  test("B8 파일 여러 개를 한꺼번에 올리면 한 파일씩 차례로 규칙을 적용해 같은 자리의 파일은 각자 새 트랙에 놓인다", async ({ page }) => {
    await openApp(page);
    await page.setInputFiles(S.upload, [WAV, STEADY, WAV]);
    await expect(page.locator(S.clip)).toHaveCount(3, { timeout: 30_000 });
    await expect(page.locator(S.trackHeader)).toHaveCount(3);
    const rows = [await rowOf(page, 0), await rowOf(page, 1), await rowOf(page, 2)];
    measuredP45("파일 3개 한꺼번에 올리기", { 트랙_수: 3, 클립_줄: rows });
    expect(new Set(rows).size).toBe(3);
  });
});
