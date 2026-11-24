// 触摸屏才用得上的按钮（工具栏里的触摸方式切换、软键盘）什么时候出现。
//
// 不看 `navigator.maxTouchPoints`：桌面端也常常大于 0（带触屏的笔记本、某些 WebView 恒报非零），
// 用鼠标键盘的人就会一直看到碰不上的按钮。真用手指点过才算数：有触控操作时出现，
// 一段时间没有触控操作就收起；再摸一次又出来。换页、重开窗口重新判断。
import { useSyncExternalStore } from "react";

/** 最后一次触控操作的时间戳；还没摸过就当作很久以前（0 是个合法时间戳，不能当哨兵） */
let lastTouchAt = Number.NEGATIVE_INFINITY;
const listeners = new Set<() => void>();

/** 最后一次触控操作之后保持可见的时长：够点工具栏上的按钮，又不至于一直占着画面 */
const HIDE_AFTER_MS = 5000;

function notify(): void {
  for (const listener of listeners) listener();
}

function visible(): boolean {
  return Date.now() - lastTouchAt < HIDE_AFTER_MS;
}

let hideTimer: ReturnType<typeof setTimeout> | undefined;

function mark(): void {
  const wasVisible = visible();
  lastTouchAt = Date.now();
  if (hideTimer !== undefined) clearTimeout(hideTimer);
  // 到点了收起来；期间又摸过就会重排，不会提前收起
  hideTimer = setTimeout(() => {
    hideTimer = undefined;
    notify();
  }, HIDE_AFTER_MS);
  if (!wasVisible) notify();
}

function onPointer(event: PointerEvent): void {
  // 鼠标是 "mouse"，触控笔是 "pen"：后者有 hover、和鼠标一样用，不算触摸屏
  if (event.pointerType === "touch") mark();
}

if (typeof window !== "undefined") {
  // 捕获阶段：按钮自己的处理（阻止冒泡、preventDefault）不影响判断
  window.addEventListener("pointerdown", onPointer, true);
  // 老 WebView 没有 Pointer Events 时兜底
  window.addEventListener("touchstart", mark, true);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** 有触控操作时才有：触摸方式、软键盘这些按钮据此显示 */
export function useTouchable(): boolean {
  return useSyncExternalStore(subscribe, visible, () => false);
}
