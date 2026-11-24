/**
 * P5-5 기본 편집 기능의 순수 계산: 재생선에서 자르기·여러 클립 옮기기·복제·붙여넣기 자리 계산·끌어다 놓기 자리·앱 안 클립보드.
 * 화면도 문서도 없이 값만 넣고 값만 확인한다. 문서·이력·안내와 이어지는 흐름은 clip-editing-flow.test.mjs.
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { makeClip } from "./helpers/docs.mjs";

const {
  SLICE_EDGE_MARGIN,
  canSliceAt,
  clipsToCutAt,
  movingItems,
  pasteBaseRow,
  planDuplicate,
  planMultiMove,
  planPaste,
  regroupCopies,
  splitClip,
  withGroupMembers,
} = await import("../src/domain/timeline/clipMath.ts");
const { dropPlacementAt, dropRowAt, isNewTrackDrop } = await import("../src/domain/timeline/drop.ts");
const { clearClipboard, copyClips, readClipboard } = await import("../src/services/clipboard.ts");

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ${actual} ≈ ${expected}`);
const clip = (id, startTime, overrides = {}) => makeClip("T", id, startTime, overrides);
const trackOf = (...clips) => ({ clips });

afterEach(() => clearClipboard());

// ───── 자르기 ─────

test("splitClip: 왼쪽은 원래 클립(길이만 줄어듦), 오른쪽은 새 id·'조각' 이름·재생선 자리에서 이어지는 구간이고 그룹에서 빠진다", () => {
  const original = clip("x", 2, { duration: 4, offset: 1, groupId: "g", name: "소리", gain: 0.5, muted: true });
  const parts = splitClip(original, 120, 3.5, "R");
  assert.ok(parts);
  assert.deepEqual(
    { id: parts.left.id, start: parts.left.startTime, offset: parts.left.offset, duration: parts.left.duration, group: parts.left.groupId },
    { id: "x", start: 2, offset: 1, duration: 1.5, group: "g" },
  );
  assert.deepEqual(
    { id: parts.right.id, name: parts.right.name, start: parts.right.startTime, offset: parts.right.offset, duration: parts.right.duration, group: parts.right.groupId },
    { id: "R", name: "소리 조각", start: 3.5, offset: 2.5, duration: 2.5, group: undefined },
  );
  assert.equal(parts.right.gain, 0.5, "나머지 속성은 그대로 물려받는다");
  assert.equal(parts.right.muted, true);
  assert.equal(original.duration, 4, "원본 객체는 건드리지 않는다");
});

test("splitClip: 템포 맞춤(WARP) 클립은 타임라인 시간을 음원 시간으로 바꿔 자른다", () => {
  // 템포 120, 원본 BPM 60 → 배속 2: 음원 4초가 타임라인 0~2초에 놓인다.
  const fast = clip("w", 0, { duration: 4, sourceBpm: 60, stretchMode: "resample" });
  const parts = splitClip(fast, 120, 1, "R");
  assert.ok(parts);
  near(parts.left.duration, 2, "왼쪽은 음원 2초");
  near(parts.right.startTime, 1, "오른쪽은 타임라인 1초에서 시작");
  near(parts.right.offset, 2, "음원 2초 지점부터");
  near(parts.right.duration, 2);
});

test("canSliceAt·splitClip: 양끝에서 0.03초 안쪽이어야 자를 수 있다(밖이거나 가장자리면 undefined)", () => {
  const c = clip("a", 5, { duration: 1 });
  assert.equal(SLICE_EDGE_MARGIN, 0.03);
  for (const time of [4, 5, 5.02, 5.99, 6, 7]) {
    assert.equal(canSliceAt(c, 120, time), false, `${time}초는 자를 수 없다`);
    assert.equal(splitClip(c, 120, time, "R"), undefined);
  }
  for (const time of [5.04, 5.5, 5.96]) {
    assert.equal(canSliceAt(c, 120, time), true, `${time}초는 자를 수 있다`);
    const parts = splitClip(c, 120, time, "R");
    assert.ok(parts.left.duration >= SLICE_EDGE_MARGIN && parts.right.duration >= SLICE_EDGE_MARGIN, "어느 조각도 너무 짧지 않다");
    near(parts.left.duration + parts.right.duration, 1, "두 조각을 합치면 원래 길이");
  }
});

test("clipsToCutAt: 고른 클립이 없으면 재생선이 지나는 모든 클립, 있으면 그중 재생선이 안쪽인 것만(트랙·클립 순서)", () => {
  const tracks = [
    trackOf(clip("A", 0, { duration: 2 }), clip("B", 3, { duration: 2 })),
    trackOf(clip("C", 0.5, { duration: 2 }), clip("D", 4, { duration: 1 })),
    trackOf(),
  ];
  assert.deepEqual(clipsToCutAt(tracks, 120, [], 1), ["A", "C"], "고른 것이 없으면 재생선이 지나는 전부");
  assert.deepEqual(clipsToCutAt(tracks, 120, ["A"], 1), ["A"]);
  assert.deepEqual(clipsToCutAt(tracks, 120, ["C", "A", "D"], 1), ["A", "C"], "순서는 고른 순서가 아니라 문서 순서");
  assert.deepEqual(clipsToCutAt(tracks, 120, ["B"], 1), [], "고른 클립을 재생선이 지나지 않으면 아무것도 자르지 않는다");
  assert.deepEqual(clipsToCutAt(tracks, 120, [], 2.75), [], "아무 클립도 지나지 않는 자리");
  assert.deepEqual(clipsToCutAt(tracks, 120, [], 0.01), [], "클립 가장자리");
  assert.deepEqual(clipsToCutAt([], 120, [], 1), []);
});

// ───── 그룹·여러 클립 옮기기 ─────

const groupedTracks = () => [
  trackOf(clip("a", 0, { groupId: "g1" }), clip("b", 2), clip("c", 4, { groupId: "g1" })),
  trackOf(clip("d", 1, { groupId: "g2" }), clip("e", 3, { groupId: "g1" })),
];

test("withGroupMembers: 같은 그룹의 클립이 모두 따라오고, 그룹이 없는 클립은 그대로이며, 결과는 문서 순서다", () => {
  const tracks = groupedTracks();
  assert.deepEqual(withGroupMembers(tracks, ["c"]), ["a", "c", "e"]);
  assert.deepEqual(withGroupMembers(tracks, ["b"]), ["b"]);
  assert.deepEqual(withGroupMembers(tracks, ["d"]), ["d"]);
  assert.deepEqual(withGroupMembers(tracks, ["e", "d"]), ["a", "c", "d", "e"]);
  assert.deepEqual(withGroupMembers(tracks, []), []);
  assert.deepEqual(withGroupMembers(tracks, ["없는 클립"]), []);
});

test("movingItems: 선택 전체 + 같은 그룹이 함께 움직이고, 누른 클립이 맨 뒤에 온다", () => {
  const tracks = groupedTracks();
  const ids = (items) => items.map((item) => item.id);

  // 누른 클립이 선택에 있으면 선택 전체
  assert.deepEqual(ids(movingItems(tracks, ["b", "d"], "b")), ["d", "b"]);
  // 누른 클립이 선택 밖이면 그 클립만(선택은 무시)
  assert.deepEqual(ids(movingItems(tracks, ["b", "d"], "e")), ["a", "c", "e"], "선택은 무시하고 e와 e의 그룹(g1)만, e가 맨 뒤");
  assert.deepEqual(ids(movingItems(tracks, ["a", "b"], "d")), ["d"], "선택에 없는 클립을 누르면 그 클립 하나(그룹 없음)");
  // 선택이 비어 있어도 누른 클립은 움직인다
  assert.deepEqual(ids(movingItems(tracks, [], "b")), ["b"]);
  // 선택 안의 한 클립이 그룹이면 그 그룹 전체가 더해진다
  assert.deepEqual(ids(movingItems(tracks, ["a"], "a")), ["c", "e", "a"]);

  const items = movingItems(tracks, ["b", "d"], "b");
  assert.deepEqual(items, [
    { id: "d", trackIndex: 1, startTime: 1 },
    { id: "b", trackIndex: 0, startTime: 2 },
  ]);
});

test("planMultiMove: 모두 같은 시간·같은 칸 수만큼 움직이고 서로의 간격을 지킨다", () => {
  const items = [
    { id: "a", trackIndex: 1, startTime: 2 },
    { id: "b", trackIndex: 2, startTime: 4 },
  ];
  assert.deepEqual(planMultiMove(items, 1.5, 1, 4), [
    { id: "a", trackIndex: 2, startTime: 3.5 },
    { id: "b", trackIndex: 3, startTime: 5.5 },
  ]);
  assert.deepEqual(planMultiMove(items, 0, 0, 4), items.map((item) => ({ ...item })), "움직이지 않으면 그대로");
});

test("planMultiMove: 하나라도 곡 시작·맨 위·맨 아래를 넘으면 전체가 그 자리에서 함께 멈춘다", () => {
  const items = [
    { id: "a", trackIndex: 1, startTime: 2 },
    { id: "b", trackIndex: 2, startTime: 4 },
  ];
  assert.deepEqual(planMultiMove(items, -10, 0, 4).map((item) => item.startTime), [0, 2], "가장 앞 클립이 0초에서 멈추고 간격은 그대로");
  assert.deepEqual(planMultiMove(items, 0, -9, 4).map((item) => item.trackIndex), [0, 1], "가장 위 클립이 첫 트랙에서 멈춘다");
  assert.deepEqual(planMultiMove(items, 0, 9, 4).map((item) => item.trackIndex), [2, 3], "가장 아래 클립이 마지막 트랙에서 멈춘다");
  assert.deepEqual(planMultiMove(items, 0, 1, 3).map((item) => item.trackIndex), [1, 2], "이미 맨 아래면 더 내려가지 않는다");
});

test("planMultiMove: 칸 수는 반올림하고, 숫자가 아닌 값은 0으로 본다. 빈 목록은 빈 결과", () => {
  const items = [{ id: "a", trackIndex: 1, startTime: 2 }];
  assert.equal(planMultiMove(items, 0, 0.4, 5)[0].trackIndex, 1);
  assert.equal(planMultiMove(items, 0, 0.6, 5)[0].trackIndex, 2);
  assert.deepEqual(planMultiMove(items, Number.NaN, Number.NaN, 5), [{ id: "a", trackIndex: 1, startTime: 2 }]);
  assert.deepEqual(planMultiMove([], 3, 3, 5), []);
});

// ───── 복제 ─────

test("planDuplicate: 클립 하나는 그 클립이 끝난 자리에, 같은 트랙에 놓는다", () => {
  const plans = planDuplicate([{ clip: clip("a", 2, { duration: 1.5 }), trackIndex: 3 }], 120);
  assert.equal(plans.length, 1);
  assert.deepEqual({ at: plans[0].startTime, row: plans[0].trackIndex, source: plans[0].source.id }, { at: 3.5, row: 3, source: "a" });
});

test("planDuplicate: 고른 클립 전체를 한 덩어리로 보고 덩어리가 끝난 자리부터 같은 간격으로 놓는다", () => {
  const plans = planDuplicate(
    [
      { clip: clip("a", 0, { duration: 1 }), trackIndex: 0 },
      { clip: clip("b", 0.5, { duration: 2 }), trackIndex: 1 },
    ],
    120,
  );
  // 덩어리는 0 ~ 2.5초: 사본은 2.5초만큼 뒤에 같은 간격(0.5초 차이)으로
  assert.deepEqual(plans.map((plan) => [plan.source.id, plan.trackIndex, plan.startTime]), [["a", 0, 2.5], ["b", 1, 3]]);
});

test("planDuplicate: 템포 맞춤 클립은 타임라인에서 차지하는 길이로 끝을 잡는다. 빈 목록은 빈 계획", () => {
  // 원본 BPM 60 → 템포 120에서 배속 2: 음원 4초는 타임라인 2초
  const plans = planDuplicate([{ clip: clip("w", 1, { duration: 4, sourceBpm: 60, stretchMode: "resample" }), trackIndex: 0 }], 120);
  near(plans[0].startTime, 3);
  assert.deepEqual(planDuplicate([], 120), []);
});

// ───── 붙여넣기 ─────

test("planPaste: 복사한 것 중 가장 앞 클립이 재생 위치에 오고, 시간 간격·트랙 칸 간격을 지킨다", () => {
  const items = [
    { clip: clip("a", 2), row: 0 },
    { clip: clip("b", 3.5), row: 1 },
    { clip: clip("c", 5), row: 0 },
  ];
  const plan = planPaste(items, 10, 2);
  assert.deepEqual(plan.placements.map((placement) => [placement.source.id, placement.trackIndex, placement.startTime]), [["a", 2, 10], ["b", 3, 11.5], ["c", 2, 13]]);
  assert.equal(plan.trackCount, 4, "가장 아래 클립이 4번째 칸이라 트랙이 4개는 있어야 한다");
});

test("planPaste: 음수 위치·음수 칸은 0으로 모으고, 빈 복사는 빈 계획", () => {
  const plan = planPaste([{ clip: clip("a", 4), row: 0 }], -3, -2);
  assert.deepEqual(plan.placements.map((placement) => [placement.trackIndex, placement.startTime]), [[0, 0]]);
  assert.equal(plan.trackCount, 1);
  assert.deepEqual(planPaste([], 5, 0), { placements: [], trackCount: 0 });
});

test("pasteBaseRow: 클립 없이 트랙만 골랐으면 그 트랙, 아니면 복사한 클립이 있던 트랙, 둘 다 없으면 첫 트랙", () => {
  const ids = ["t0", "t1", "t2"];
  assert.equal(pasteBaseRow(ids, { selectedTrackId: "t1", clipsSelected: false, originTrackId: "t2" }), 1, "트랙만 고름");
  assert.equal(pasteBaseRow(ids, { selectedTrackId: "t1", clipsSelected: true, originTrackId: "t2" }), 2, "클립을 고른 채 남은 트랙 선택은 따르지 않는다");
  assert.equal(pasteBaseRow(ids, { clipsSelected: false, originTrackId: "t2" }), 2, "고른 트랙이 없으면 복사한 곳");
  assert.equal(pasteBaseRow(ids, { selectedTrackId: "없는 트랙", clipsSelected: false, originTrackId: "t1" }), 1, "고른 트랙이 사라졌으면 복사한 곳");
  assert.equal(pasteBaseRow(ids, { selectedTrackId: "t1", clipsSelected: false, originTrackId: "지워진 트랙" }), 1, "고른 트랙이 우선");
  assert.equal(pasteBaseRow(ids, { clipsSelected: false, originTrackId: "지워진 트랙" }), 0, "복사한 곳도 없으면 첫 트랙");
  assert.equal(pasteBaseRow([], { clipsSelected: false }), 0);
});

test("regroupCopies: 같은 그룹이던 사본이 둘 이상이면 새 그룹으로 묶고, 하나뿐이면 묶지 않는다", () => {
  let made = 0;
  const newId = () => `new${++made}`;
  const sources = [clip("a", 0, { groupId: "g1" }), clip("b", 1, { groupId: "g1" }), clip("c", 2, { groupId: "g2" }), clip("d", 3)];
  const mapping = regroupCopies(sources, newId);
  assert.deepEqual([...mapping], [["g1", "new1"]], "g2는 사본이 하나뿐이라 대응표에 없다");
  assert.equal(made, 1, "새 그룹 id는 필요한 만큼만 만든다");
  assert.equal(regroupCopies([], newId).size, 0);
  assert.equal(regroupCopies([clip("x", 0)], newId).size, 0);
});

// ───── 끌어다 놓기 자리 ─────

const view = { zoomPxPerSecond: 100, trackHeight: 116, trackCount: 3, bpm: 120, snap: false, gridDivision: 2 };

test("dropPlacementAt: 세로는 트랙 칸, 가로는 초(스냅을 끄면 그대로)", () => {
  assert.deepEqual(dropPlacementAt(250, 130, view), { row: 1, time: 2.5 });
  assert.deepEqual(dropPlacementAt(0, 0, view), { row: 0, time: 0 });
  assert.equal(dropPlacementAt(0, 115.9, view).row, 0);
  assert.equal(dropPlacementAt(0, 116, view).row, 1, "칸 경계는 아래 칸");
  assert.equal(dropPlacementAt(0, 347.9, view).row, 2);
});

test("dropPlacementAt: 눈금자 위(음수)는 첫 칸, 트랙 아래 빈 곳은 트랙 수(새 트랙)에서 멈춘다", () => {
  assert.equal(dropPlacementAt(0, -40, view).row, 0);
  assert.equal(dropPlacementAt(0, 348, view).row, 3, "트랙 3개 아래 첫 자리 = 새 트랙");
  assert.equal(dropPlacementAt(0, 116 * 40, view).row, 3, "멀리 놓아도 트랙은 하나만 늘어난다");
  assert.equal(dropPlacementAt(0, 50, { ...view, trackCount: 0 }).row, 0, "트랙이 없으면 첫 자리가 곧 새 트랙");
});

test("dropPlacementAt: 시간이 음수이거나 숫자가 아니면 0, 높이가 숫자가 아니면 첫 칸", () => {
  assert.equal(dropPlacementAt(-300, 10, view).time, 0);
  assert.deepEqual(dropPlacementAt(Number.NaN, Number.NaN, view), { row: 0, time: 0 });
  assert.equal(dropPlacementAt(100, 10, { ...view, trackHeight: 0 }).row, 0);
});

test("dropPlacementAt: 스냅이 켜져 있으면 박·마디에 붙는다(120 BPM)", () => {
  const snapped = { ...view, snap: true };
  near(dropPlacementAt(130, 10, { ...snapped, gridDivision: 2 }).time, 1.25, "8분음표 간격 0.25초");
  near(dropPlacementAt(130, 10, { ...snapped, gridDivision: 1 }).time, 1.5, "4분음표 간격 0.5초");
  near(dropPlacementAt(130, 10, { ...snapped, gridDivision: 1 / 4 }).time, 2, "4/4 한 마디 2초");
  near(dropPlacementAt(130, 10, { ...snapped, gridDivision: 1 / 3 }).time, 1.5, "3/4 한 마디 1.5초");
  near(dropPlacementAt(70, 10, { ...snapped, gridDivision: 1 / 3 }).time, 0, "가까운 마디 시작");
  assert.equal(dropPlacementAt(130, 10, view).time, 1.3, "스냅을 끄면 놓은 자리 그대로");
});

test("isNewTrackDrop·dropRowAt: 칸 번호가 트랙 수 이상이면 새 트랙, 파일이 여럿이면 놓은 칸부터 한 칸씩 내려간다", () => {
  assert.equal(isNewTrackDrop({ row: 2, time: 0 }, 3), false);
  assert.equal(isNewTrackDrop({ row: 3, time: 0 }, 3), true);
  assert.equal(isNewTrackDrop({ row: 0, time: 0 }, 0), true);
  const placement = { row: 1, time: 4 };
  assert.deepEqual([0, 1, 2].map((placed) => dropRowAt(placement, placed)), [1, 2, 3]);
  assert.equal(dropRowAt(placement, -5), 1, "음수는 0개로 본다");
  assert.equal(dropRowAt(placement, 1.9), 2, "소수는 내림");
});

// ───── 앱 안 클립보드 ─────

test("copyClips: 가장 위 트랙을 0으로 센 칸과 함께 기억하고, 복사한 개수를 돌려준다", () => {
  const tracks = [
    { id: "T0", clips: [clip("a", 0), clip("b", 2)] },
    { id: "T1", clips: [clip("c", 1)] },
    { id: "T2", clips: [clip("d", 5)] },
  ];
  assert.equal(copyClips(tracks, ["d", "c"]), 2);
  const content = readClipboard();
  assert.equal(content.originTrackId, "T1", "복사한 것 중 가장 위 트랙");
  assert.deepEqual(content.items.map((item) => [item.clip.id, item.row]), [["c", 0], ["d", 1]], "문서 순서, 칸은 가장 위 복사본 기준");

  assert.equal(copyClips(tracks, ["b"]), 1);
  assert.deepEqual(readClipboard().items.map((item) => [item.clip.id, item.row]), [["b", 0]]);
  assert.equal(readClipboard().originTrackId, "T0");
});

test("copyClips: 복사한 것이 없으면 0을 돌려주고 먼저 복사해 둔 것은 그대로 둔다", () => {
  const tracks = [{ id: "T0", clips: [clip("a", 0)] }];
  assert.equal(copyClips(tracks, ["없는 클립"]), 0);
  assert.equal(readClipboard(), undefined);
  copyClips(tracks, ["a"]);
  assert.equal(copyClips(tracks, []), 0);
  assert.equal(copyClips(tracks, ["없는 클립"]), 0);
  assert.deepEqual(readClipboard().items.map((item) => item.clip.id), ["a"], "빈 복사가 앞의 복사를 지우지 않는다");
});

test("copyClips: 복사 뒤에 원본을 고쳐도 복사해 둔 클립은 변하지 않는다. clearClipboard로 비운다", () => {
  const original = clip("a", 0, { name: "처음" });
  copyClips([{ id: "T0", clips: [original] }], ["a"]);
  original.name = "바뀜";
  original.startTime = 9;
  assert.equal(readClipboard().items[0].clip.name, "처음");
  assert.equal(readClipboard().items[0].clip.startTime, 0);
  clearClipboard();
  assert.equal(readClipboard(), undefined);
});
