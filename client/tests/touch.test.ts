// 触摸屏：手指的手势翻译成被控端的鼠标事件（src/lib/touch.ts）
import assert from "node:assert/strict";
import { test } from "node:test";
import type { InputEvent } from "../src/lib/api.ts";
import { LONG_PRESS_MS, SCROLL_SLOP, TAP_SLOP, TouchInput, resolveTouchStyle, trackpadGain } from "../src/lib/touch.ts";

/** 记下发出去的事件；坐标按一个 1000×1000 的画面算（1 像素 = 0.001），画面贴在网页左上角 */
function fakeHost() {
  const events: InputEvent[] = [];
  let pointer: { x: number; y: number } | null = null;
  const host = {
    posAt: (clientX: number, clientY: number) => ({ x: clientX / 1000, y: clientY / 1000 }),
    send: (evs: InputEvent[]) => { events.push(...evs); },
    rect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    pointer: (pos: { x: number; y: number } | null) => { pointer = pos; },
  };
  return { events, host, pointer: () => pointer, input: new TouchInput(host) };
}

/** 事件的大致样子：m=移动 b=按键 r=松开 d=滚轮 */
const shape = (events: InputEvent[]) =>
  events.map((e) => {
    switch (e.type) {
      case "mouseMove": return `m${e.x.toFixed(3)},${e.y.toFixed(3)}`;
      case "mouseButton": return `${e.button}${e.down ? "+" : "-"}`;
      case "wheel": return `wheel${e.dx},${e.dy}`;
      default: return e.type;
    }
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("点一下：左键在手指的位置按一下", () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 200, clientY: 300 });
  input.up({ pointerId: 1, clientX: 200, clientY: 300 });
  assert.deepEqual(shape(events), ["m0.200,0.300", "left+", "left-"]);
});

test("手指抖了不到 TAP_SLOP：还是点一下，不拖动", () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 200, clientY: 300 });
  input.move({ pointerId: 1, clientX: 200 + TAP_SLOP - 2, clientY: 300 });
  input.up({ pointerId: 1, clientX: 200 + TAP_SLOP - 2, clientY: 300 });
  assert.deepEqual(shape(events), ["m0.208,0.300", "left+", "left-"]);
});

test("按住拖：先按住起点再跟着手指走，松开时抬起", () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 100, clientY: 100 });
  input.move({ pointerId: 1, clientX: 100 + TAP_SLOP + 30, clientY: 100 });
  input.move({ pointerId: 1, clientX: 300, clientY: 200 });
  input.up({ pointerId: 1, clientX: 300, clientY: 200 });
  const s = shape(events);
  // 起点按住 → 移到手指处 → 继续跟 → 松开
  assert.deepEqual(s.slice(0, 3), ["m0.100,0.100", "left+", "m0.140,0.100"]);
  assert.equal(s[s.length - 1], "left-");
  assert.ok(s.includes("m0.300,0.200"));
});

test("按住不动：长按变右键，松开不再补一次左键", async () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 400, clientY: 500 });
  await sleep(LONG_PRESS_MS + 50);
  input.up({ pointerId: 1, clientX: 400, clientY: 500 });
  assert.deepEqual(shape(events), ["m0.400,0.500", "right+", "right-"]);
});

test("长按之后又移动：右键拖动", async () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 400, clientY: 500 });
  await sleep(LONG_PRESS_MS + 50);
  input.move({ pointerId: 1, clientX: 450, clientY: 520 });
  input.up({ pointerId: 1, clientX: 450, clientY: 520 });
  const s = shape(events);
  assert.deepEqual(s.slice(0, 2), ["m0.400,0.500", "right+"]);
  assert.ok(s.includes("m0.450,0.520"));
  assert.equal(s[s.length - 1], "right-");
});

test("两根手指一起滑：滚动（手指向下滑 = 滚轮向上）", () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 500, clientY: 500 });
  input.down({ pointerId: 2, clientX: 600, clientY: 500 });
  input.move({ pointerId: 1, clientX: 500, clientY: 600 });
  input.move({ pointerId: 2, clientX: 600, clientY: 600 });
  input.up({ pointerId: 1, clientX: 500, clientY: 600 });
  input.up({ pointerId: 2, clientX: 600, clientY: 600 });
  const wheels = events.filter((e) => e.type === "wheel") as Extract<InputEvent, { type: "wheel" }>[];
  assert.ok(wheels.length > 0, "没有发出滚轮");
  // 手指向下滑，看到的是上面的内容：dy 为正
  assert.ok(wheels.every((w) => w.dy > 0), JSON.stringify(wheels));
  // 一路滑下来不能顺手点一下
  assert.ok(!shape(events).some((x) => x.startsWith("left") || x.startsWith("right")), shape(events).join(","));
});

test("两根手指向右滑：滚轮向左（dx 为负）", () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 500, clientY: 500 });
  input.down({ pointerId: 2, clientX: 500, clientY: 600 });
  input.move({ pointerId: 1, clientX: 600, clientY: 500 });
  input.move({ pointerId: 2, clientX: 600, clientY: 600 });
  const wheels = events.filter((e) => e.type === "wheel") as Extract<InputEvent, { type: "wheel" }>[];
  assert.ok(wheels.length > 0, "没有发出滚轮");
  assert.ok(wheels.every((w) => w.dx < 0 && w.dy === 0), JSON.stringify(wheels));
});

test("两根手指轻点：右键", () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 500, clientY: 500 });
  input.down({ pointerId: 2, clientX: 500 + SCROLL_SLOP / 2, clientY: 500 });
  input.up({ pointerId: 1, clientX: 500, clientY: 500 });
  input.up({ pointerId: 2, clientX: 500 + SCROLL_SLOP / 2, clientY: 500 });
  assert.deepEqual(shape(events).slice(-2), ["right+", "right-"]);
});

test("第二根手指落下时，已经按住的左键要松开", () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 100, clientY: 100 });
  input.move({ pointerId: 1, clientX: 200, clientY: 100 });
  input.down({ pointerId: 2, clientX: 300, clientY: 100 });
  const s = shape(events);
  assert.ok(s.includes("left+"));
  // 按下 → 松开之后才开始滚动
  assert.ok(s.indexOf("left-") < s.length, s.join(","));
  assert.equal(s[s.length - 1], "left-");
});

test("浏览器收走了触摸：按着的松开，不留按下的键", () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 100, clientY: 100 });
  input.move({ pointerId: 1, clientX: 250, clientY: 100 });
  input.cancel();
  assert.equal(shape(events).at(-1), "left-");
  // 之后抬手指也不会再补一次点击
  const before = events.length;
  input.up({ pointerId: 1, clientX: 250, clientY: 100 });
  assert.equal(events.length, before);
});

test("reset：状态清空，长按的定时器不会在之后补一个右键", async () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 100, clientY: 100 });
  input.reset();
  await sleep(LONG_PRESS_MS + 50);
  assert.deepEqual(shape(events), []);
});

// ───────────────────────── 触摸板 ─────────────────────────

/** 触摸板模式：手指在画面上滑，指针跟着走（和手机端的 TRACKPAD 一样） */
function trackpadHost() {
  const h = fakeHost();
  h.input.setStyle("trackpad");
  return h;
}

test("自动：电脑用触摸板，手机平板用触屏", () => {
  assert.equal(resolveTouchStyle("auto", "mac"), "trackpad");
  assert.equal(resolveTouchStyle("auto", "windows"), "trackpad");
  assert.equal(resolveTouchStyle("auto", "linux"), "trackpad");
  assert.equal(resolveTouchStyle("auto", "android"), "touch");
  assert.equal(resolveTouchStyle("auto", "ios"), "touch");
  // 手动选的说了算
  assert.equal(resolveTouchStyle("touch", "mac"), "touch");
  assert.equal(resolveTouchStyle("trackpad", "android"), "trackpad");
});

test("触摸板：只有第一下有点慢，滑得快指针走得远", () => {
  assert.ok(trackpadGain(0) < 1);
  assert.ok(trackpadGain(0.1) < 1);
  assert.ok(trackpadGain(1) > 1);
  assert.equal(trackpadGain(100), 2.4);
});

test("触摸板：手指滑，指针跟着走（不再按手指的位置跳）", () => {
  const { events, input, pointer } = trackpadHost();
  input.down({ pointerId: 1, clientX: 500, clientY: 500 });
  // 第一次摸：指针出现在画面中间
  assert.deepEqual(pointer(), { x: 500, y: 500 });
  input.move({ pointerId: 1, clientX: 600, clientY: 500 });
  const moves = events.filter((e) => e.type === "mouseMove");
  assert.equal(moves.length, 1);
  assert.ok(pointer()!.x > 500, JSON.stringify(pointer()));
  // 手指才滑了 100，指针走得比 100 远（加速），但不会跑到画面上看不见的地方
  assert.equal(pointer()!.y, 500);
  input.up({ pointerId: 1, clientX: 600, clientY: 500 });
  // 滑过就不算点一下
  assert.ok(!shape(events).some((x) => x.startsWith("left")), shape(events).join(","));
});

test("触摸板：手指抖动时指针不动，点一下落在指针上", () => {
  const { events, input } = trackpadHost();
  input.down({ pointerId: 1, clientX: 100, clientY: 900 });
  input.move({ pointerId: 1, clientX: 100 + TAP_SLOP - 2, clientY: 900 });
  input.up({ pointerId: 1, clientX: 100 + TAP_SLOP - 2, clientY: 900 });
  // 指针在画面中间，不在手指按的地方
  assert.deepEqual(shape(events), ["m0.500,0.500", "left+", "left-"]);
});

test("触摸板：长按是在指针处右键", async () => {
  const { events, input } = trackpadHost();
  input.down({ pointerId: 1, clientX: 100, clientY: 100 });
  await sleep(LONG_PRESS_MS + 50);
  input.up({ pointerId: 1, clientX: 100, clientY: 100 });
  assert.deepEqual(shape(events), ["m0.500,0.500", "right+", "right-"]);
});

test("触摸板：双击之后按住滑 = 左键拖动（拖文件、选文字）", () => {
  const { events, input } = trackpadHost();
  // 第一下：点一下
  input.down({ pointerId: 1, clientX: 500, clientY: 500 });
  input.up({ pointerId: 1, clientX: 500, clientY: 500 });
  assert.deepEqual(shape(events), ["m0.500,0.500", "left+", "left-"]);
  events.length = 0;
  // 第二下按住不放，再滑：按住左键拖
  input.down({ pointerId: 1, clientX: 505, clientY: 505 });
  input.move({ pointerId: 1, clientX: 605, clientY: 505 });
  const s = shape(events);
  assert.equal(s[0], "m0.500,0.500");
  assert.equal(s[1], "left+");
  input.up({ pointerId: 1, clientX: 605, clientY: 505 });
  assert.equal(shape(events).at(-1), "left-");
  // 双击的第二下不再单独点一次
  assert.equal(shape(events).filter((x) => x === "left+").length, 1);
});

test("触摸板：快点两下 = 被控端收到双击（第二下没滑开就是又点了一下）", () => {
  const { events, input } = trackpadHost();
  input.down({ pointerId: 1, clientX: 500, clientY: 500 });
  input.up({ pointerId: 1, clientX: 500, clientY: 500 });
  input.down({ pointerId: 1, clientX: 502, clientY: 501 });
  input.up({ pointerId: 1, clientX: 502, clientY: 501 });
  const s = shape(events);
  assert.equal(s.filter((x) => x === "left+").length, 2, s.join(","));
  assert.equal(s.filter((x) => x === "left-").length, 2, s.join(","));
});

test("触摸板：双击之后按住不动，还是右键", async () => {
  const { events, input } = trackpadHost();
  input.down({ pointerId: 1, clientX: 500, clientY: 500 });
  input.up({ pointerId: 1, clientX: 500, clientY: 500 });
  events.length = 0;
  input.down({ pointerId: 1, clientX: 501, clientY: 500 });
  await sleep(LONG_PRESS_MS + 50);
  input.up({ pointerId: 1, clientX: 501, clientY: 500 });
  assert.deepEqual(shape(events), ["m0.500,0.500", "right+", "right-"]);
});

test("触摸板：指针跑不出画面", () => {
  const { input, pointer } = trackpadHost();
  input.down({ pointerId: 1, clientX: 500, clientY: 500 });
  for (let i = 1; i <= 40; i++) input.move({ pointerId: 1, clientX: 500, clientY: 500 + i * 150 });
  const p = pointer()!;
  assert.ok(p.y <= 999 && p.y >= 1, JSON.stringify(p));
  assert.ok(p.x >= 1 && p.x <= 999, JSON.stringify(p));
});

test("换触摸方式：按着的手势作废，本机画的指针收起来", () => {
  const { events, input, pointer } = trackpadHost();
  input.down({ pointerId: 1, clientX: 300, clientY: 300 });
  assert.ok(pointer());
  input.setStyle("touch");
  assert.equal(pointer(), null);
  const before = events.length;
  input.up({ pointerId: 1, clientX: 300, clientY: 300 });
  assert.equal(events.length, before, "作废的手势不该再补点击");
});

test("三指轻点：中键", () => {
  const { events, input } = fakeHost();
  const fingers = [
    { pointerId: 1, clientX: 500, clientY: 500 },
    { pointerId: 2, clientX: 560, clientY: 500 },
    { pointerId: 3, clientX: 530, clientY: 540 },
  ];
  for (const f of fingers) input.down(f);
  for (const f of fingers) input.up(f);
  assert.deepEqual(shape(events).slice(-2), ["middle+", "middle-"]);
});

test("三指右滑：切到右边的桌面（Ctrl+→），一次手势只发一次", () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 400, clientY: 500 });
  input.down({ pointerId: 2, clientX: 460, clientY: 500 });
  input.down({ pointerId: 3, clientX: 430, clientY: 540 });
  input.move({ pointerId: 1, clientX: 520, clientY: 500 });
  input.move({ pointerId: 2, clientX: 580, clientY: 500 });
  input.move({ pointerId: 3, clientX: 550, clientY: 540 });
  input.move({ pointerId: 1, clientX: 620, clientY: 500 });
  for (const id of [1, 2, 3]) input.up({ pointerId: id, clientX: 620, clientY: 500 });
  const keys = events.filter((e) => e.type === "key") as Extract<InputEvent, { type: "key" }>[];
  assert.deepEqual(
    keys.map((k) => `${k.code}${k.down ? "+" : "-"}`),
    ["ControlLeft+", "ArrowRight+", "ArrowRight-", "ControlLeft-"],
  );
  // 切桌面的时候不能顺手点一下 / 滚一下
  assert.ok(!shape(events).some((x) => x.startsWith("left") || x.startsWith("right") || x.startsWith("middle") || x.startsWith("wheel")));
});

test("三指左滑：切到左边的桌面（Ctrl+←）", () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 500, clientY: 500 });
  input.down({ pointerId: 2, clientX: 560, clientY: 500 });
  input.down({ pointerId: 3, clientX: 530, clientY: 540 });
  input.move({ pointerId: 1, clientX: 380, clientY: 500 });
  input.move({ pointerId: 2, clientX: 440, clientY: 500 });
  input.move({ pointerId: 3, clientX: 410, clientY: 540 });
  for (const id of [1, 2, 3]) input.up({ pointerId: id, clientX: 380, clientY: 500 });
  const keys = events.filter((e) => e.type === "key") as Extract<InputEvent, { type: "key" }>[];
  assert.deepEqual(
    keys.map((k) => `${k.code}${k.down ? "+" : "-"}`),
    ["ControlLeft+", "ArrowLeft+", "ArrowLeft-", "ControlLeft-"],
  );
});

test("两指张开：放大（Cmd+=）", () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 400, clientY: 500 });
  input.down({ pointerId: 2, clientX: 600, clientY: 500 });
  input.move({ pointerId: 1, clientX: 340, clientY: 500 });
  input.move({ pointerId: 2, clientX: 660, clientY: 500 });
  input.up({ pointerId: 1, clientX: 340, clientY: 500 });
  input.up({ pointerId: 2, clientX: 660, clientY: 500 });
  const keys = events.filter((e) => e.type === "key") as Extract<InputEvent, { type: "key" }>[];
  assert.ok(keys.length >= 4, "没有发出缩放");
  // Cmd 按着、松开，中间全是 Equal（张得越大按的次数越多，次数不固定）
  assert.equal(`${keys[0].code}${keys[0].down ? "+" : "-"}`, "MetaLeft+");
  assert.equal(`${keys[keys.length - 1].code}${keys[keys.length - 1].down ? "+" : "-"}`, "MetaLeft-");
  const steps = keys.filter((k) => k.code !== "MetaLeft");
  assert.ok(steps.length >= 2 && steps.length % 2 === 0, keys.map((x) => x.code).join(","));
  for (const k of steps) assert.equal(k.code, "Equal", keys.map((x) => x.code).join(","));
  // 缩放不是滚动，也不是点击
  assert.ok(!shape(events).some((x) => x.startsWith("wheel") || x.startsWith("left") || x.startsWith("right")));
});

test("两指收拢：缩小（Cmd+-）", () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 300, clientY: 500 });
  input.down({ pointerId: 2, clientX: 700, clientY: 500 });
  input.move({ pointerId: 1, clientX: 450, clientY: 500 });
  input.move({ pointerId: 2, clientX: 550, clientY: 500 });
  const keys = events.filter((e) => e.type === "key") as Extract<InputEvent, { type: "key" }>[];
  assert.ok(keys.length >= 4, "没有发出缩放");
  assert.equal(`${keys[0].code}${keys[0].down ? "+" : "-"}`, "MetaLeft+");
  assert.equal(`${keys[keys.length - 1].code}${keys[keys.length - 1].down ? "+" : "-"}`, "MetaLeft-");
  const steps = keys.filter((k) => k.code !== "MetaLeft");
  assert.ok(steps.length >= 2 && steps.length % 2 === 0, keys.map((x) => x.code).join(","));
  for (const k of steps) assert.equal(k.code, "Minus", keys.map((x) => x.code).join(","));
  assert.ok(!shape(events).some((x) => x.startsWith("wheel")));
});

test("两根手指滑多远就滚多远：一比一跟手", () => {
  const { events, input } = fakeHost();
  const scrolled = () =>
    (events.filter((e) => e.type === "wheel") as Extract<InputEvent, { type: "wheel" }>[])
      .reduce((n, w) => n + w.dy, 0);
  input.down({ pointerId: 1, clientX: 500, clientY: 500 });
  input.down({ pointerId: 2, clientX: 600, clientY: 500 });
  // 第一下先过滚动的门槛（见 SCROLL_SLOP），门槛里吃掉的那点位移不算
  input.move({ pointerId: 1, clientX: 500, clientY: 490 });
  input.move({ pointerId: 2, clientX: 600, clientY: 490 });
  const before = scrolled();
  // 再滑 90：滚轮正好跟着 90（手指向上 = 画面往下翻，dy 为负）
  input.move({ pointerId: 1, clientX: 500, clientY: 400 });
  input.move({ pointerId: 2, clientX: 600, clientY: 400 });
  assert.equal(scrolled() - before, -90, "手指滑 90，滚轮也该是 90");
});

test("两根手指从画面边缘滑进来：不算手势（防误触）", () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 500, clientY: 4 });
  input.down({ pointerId: 2, clientX: 600, clientY: 4 });
  input.move({ pointerId: 1, clientX: 500, clientY: 300 });
  input.move({ pointerId: 2, clientX: 600, clientY: 300 });
  input.up({ pointerId: 1, clientX: 500, clientY: 300 });
  input.up({ pointerId: 2, clientX: 600, clientY: 300 });
  assert.deepEqual(shape(events), []);
});

test("两根手指甩一下：松手之后还接着滚一段（惯性）", async () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 500, clientY: 500 });
  input.down({ pointerId: 2, clientX: 600, clientY: 500 });
  // 连着几帧都在滑：有速度才有惯性
  for (let i = 1; i <= 5; i++) {
    input.move({ pointerId: 1, clientX: 500, clientY: 500 + i * 20 });
    input.move({ pointerId: 2, clientX: 600, clientY: 500 + i * 20 });
    await sleep(16);
  }
  input.up({ pointerId: 1, clientX: 500, clientY: 600 });
  input.up({ pointerId: 2, clientX: 600, clientY: 600 });
  const wheels = () => events.filter((e) => e.type === "wheel").length;
  const afterUp = wheels();
  await sleep(120);
  assert.ok(wheels() > afterUp, "松手之后应当还在滚");
  input.reset();
});

test("慢慢滑到停：松手之后不再滑（没速度就没有惯性）", async () => {
  const { events, input } = fakeHost();
  input.down({ pointerId: 1, clientX: 500, clientY: 500 });
  input.down({ pointerId: 2, clientX: 600, clientY: 500 });
  // 每帧只滑 2 像素，间隔一小会儿：速度很慢
  for (let i = 1; i <= 6; i++) {
    input.move({ pointerId: 1, clientX: 500, clientY: 500 + i * 2 });
    input.move({ pointerId: 2, clientX: 600, clientY: 500 + i * 2 });
    await sleep(16);
  }
  input.up({ pointerId: 1, clientX: 500, clientY: 512 });
  input.up({ pointerId: 2, clientX: 600, clientY: 512 });
  const wheels = () => events.filter((e) => e.type === "wheel").length;
  const afterUp = wheels();
  await sleep(120);
  assert.equal(wheels(), afterUp, "慢速滑动松手之后不该再滚");
});
