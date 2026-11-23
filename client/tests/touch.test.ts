// 触摸屏：手指的手势翻译成被控端的鼠标事件（src/lib/touch.ts）
import assert from "node:assert/strict";
import { test } from "node:test";
import type { InputEvent } from "../src/lib/api.ts";
import { LONG_PRESS_MS, SCROLL_SLOP, TAP_SLOP, TouchInput } from "../src/lib/touch.ts";

/** 记下发出去的事件；坐标按一个 1000×1000 的画面算（1 像素 = 0.001） */
function fakeHost() {
  const events: InputEvent[] = [];
  const host = {
    posAt: (clientX: number, clientY: number) => ({ x: clientX / 1000, y: clientY / 1000 }),
    send: (evs: InputEvent[]) => { events.push(...evs); },
  };
  return { events, host, input: new TouchInput(host) };
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
