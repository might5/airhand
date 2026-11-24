import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

/** 触摸方式、软键盘这些按钮的显隐（lib/touchable.ts）：假的时间和假的 window */
function harness() {
  const source = fs.readFileSync(new URL("../src/lib/touchable.ts", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from "[^"]+";\r?\n/gm, "");
  const js = stripTypeScriptTypes(source).replace(/\bexport\s+/g, "")
    + "\nglobalThis.__useTouchable = useTouchable;";

  const handlers = new Map<string, (event: any) => void>();
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  let now = 0;

  const sandbox: any = {
    window: { addEventListener: (type: string, fn: (event: any) => void) => { handlers.set(type, fn); } },
    setTimeout: (fn: () => void, delay = 0) => {
      const id = nextId++;
      timers.set(id, { at: now + delay, fn });
      return id;
    },
    clearTimeout: (id?: number) => { if (id !== undefined) timers.delete(id); },
    Date: { now: () => now },
    // 只读快照，不订阅：这里的断言都直接问当前值
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => boolean) => getSnapshot(),
  };
  vm.runInNewContext(js, sandbox);

  /** 时间往前走，把到点的定时器依次触发（和真的一样按时间顺序） */
  function advance(ms: number): void {
    const target = now + ms;
    for (;;) {
      let picked: [number, { at: number; fn: () => void }] | null = null;
      for (const entry of timers) {
        if (entry[1].at <= target && (picked === null || entry[1].at < picked[1].at)) picked = [entry[0], entry[1]];
      }
      if (picked === null) break;
      timers.delete(picked[0]);
      now = picked[1].at;
      picked[1].fn();
    }
    now = target;
  }

  return {
    advance,
    visible: () => sandbox.__useTouchable() as boolean,
    pointer: (pointerType: string) => handlers.get("pointerdown")!({ pointerType }),
    touchStart: () => handlers.get("touchstart")!({}),
  };
}

test("没摸过屏幕：触摸方式、软键盘不出现", () => {
  const { visible } = harness();
  assert.equal(visible(), false);
});

test("鼠标和触控笔不算触控操作，按钮不出现", () => {
  const { pointer, visible } = harness();
  pointer("mouse");
  pointer("pen");
  assert.equal(visible(), false);
});

test("手指点过就出现，静默 5 秒后收起", () => {
  const { advance, pointer, visible } = harness();
  pointer("touch");
  assert.equal(visible(), true);
  advance(4999);
  assert.equal(visible(), true);
  advance(2);
  assert.equal(visible(), false);
});

test("正要点按钮时又摸了一下，收起的时间从最后一次算", () => {
  const { advance, pointer, visible } = harness();
  pointer("touch");
  advance(4000);
  pointer("touch");
  advance(4000);
  assert.equal(visible(), true);
  advance(2000);
  assert.equal(visible(), false);
});

test("收起以后再摸一次，按钮重新出现", () => {
  const { advance, pointer, visible } = harness();
  pointer("touch");
  advance(6000);
  assert.equal(visible(), false);
  pointer("touch");
  assert.equal(visible(), true);
});

test("老 WebView 没有 Pointer Events：touchstart 也算触控操作", () => {
  const { touchStart, visible } = harness();
  touchStart();
  assert.equal(visible(), true);
});
