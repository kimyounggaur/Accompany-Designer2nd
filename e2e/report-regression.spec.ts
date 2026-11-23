/**
 * 점검 보고서(2026-11-12) 회귀 측정 스위트.
 * - 보고서가 '실측'한 항목을 같은 방법으로 다시 잰다.
 * - 아직 해결 전인 항목은 test.fail(…)로 표시한다. 고쳐지면 이 테스트가 '예상 밖 통과'로
 *   실패하므로, 그때 test.fail 줄을 지우면 된다(=해결 확인).
 * - 선택자는 S 한 곳에만 둔다. 화면 부품에는 data-testid를 붙여 두었으므로 CSS 이름이 바뀌어도(6단계) 깨지지 않는다.
 */
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const WAV = path.join(here, "fixtures", "quiet-loud-8s.wav"); // 앞 4초 작게(0.05), 뒤 4초 크게(0.8)
const NOT_AUDIO = path.join(here, "fixtures", "not-audio.txt");

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
  eqBassKnob: '[role=slider][aria-label="BASS 이퀄라이저"]',
};

/** 소리 소스 시작 횟수, rAF 호출 수, 최종 출력 분석기를 잡아 두는 측정 훅 */
const PROBES = `(() => {
  window.__starts = 0;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { window.__starts++; return start.apply(this, a); };
  window.__raf = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { window.__raf++; return raf(cb); };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (this instanceof AnalyserNode && dest instanceof AudioDestinationNode) window.__out = this;
    return connect.call(this, dest, ...rest);
  };
})();`;

async function openApp(page: Page, options: { layoutNotice?: boolean } = {}) {
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
  await page.goto("/");
  await page.locator(S.inspector).waitFor();
  await page.waitForTimeout(1200); // 자동 저장 복구가 끝날 때까지
}

async function upload(page: Page, file = WAV) {
  const before = await page.locator(S.clip).count();
  await page.setInputFiles(S.upload, file);
  if (file === WAV) await expect(page.locator(S.clip)).toHaveCount(before + 1);
  else await page.waitForTimeout(800);
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

  test("파일 메뉴 하나에 올리기·열기·저장·내보내기가 모여 있고 Esc로 닫힌다", async ({ page }) => {
    await openApp(page);
    const trigger = page.locator(S.fileMenuTrigger);
    await trigger.click();
    const items = page.locator(`${S.fileMenuPanel} [role="menuitem"]`);
    await expect(items).toHaveCount(4);
    await expect(items).toHaveText([/오디오 업로드/, /프로젝트 불러오기/, /프로젝트 저장/, /믹스 WAV 내보내기/]);
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(S.fileMenuPanel)).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("WARP는 상단 바가 아니라 오른쪽 '클립' 칸에 있고, 처음에는 꺼져 있다", async ({ page }) => {
    await openApp(page);
    await expect(page.locator(S.transport)).not.toContainText("WARP");
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
    const saved = path.join(os.tmpdir(), `ad2-saved-project-${testInfo.workerIndex}-${Date.now()}.json`);
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

test.describe("A6·C6 안내 문구", () => {
  test("도구를 바꾼 뒤에도 업로드 실패가 화면에 보인다", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("KeyV");
    await upload(page, NOT_AUDIO);
    await expect(page.locator(S.status)).toContainText("not-audio.txt");
  });

  test("실패 안내에 브라우저 영어 오류 문장이 그대로 나오지 않는다", async ({ page }) => {
    test.fail(true, 'P2-3에서 해결 예정 (11/13 기준 "Unable to decode audio data" 노출)');
    await openApp(page);
    await upload(page, NOT_AUDIO);
    await expect(page.locator(S.status)).not.toContainText(/unable|decode|error/i);
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
    test.fail(true, "P3-4에서 해결 예정 (11/13 기준 1개 0.66 → 2개 0.56으로 과하게 눌림)");
    await openApp(page);
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
