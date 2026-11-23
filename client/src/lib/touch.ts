// 触摸屏：手指变成被控端的鼠标事件（网页版在平板、触摸屏上的画面操作）。
//
// 协议里的触摸事件（`InputEvent::Touch`）只发给声明了能接收触摸的被控端，而桌面版的被控端（macOS / Windows / Linux）
// 都不声明（见 airhand_proto::session 的 HostHello.touch）：手指只能翻译成鼠标，和用鼠标操作一样。
//
// 手指的三种操作：
// * 单指点一下：左键在手指的位置按一下。手指会抖，按下之后移动不到 TAP_SLOP 才算点击——直接按下就发的话，
//   想点一下，被控端往往收到的是"按住、挪了一下、松开"（拖动了图标、选中了文字）；
// * 单指按住拖：移动超过 TAP_SLOP 才发左键按下，之后跟着手指走。这样点击和拖动都准；
// * 单指按住不动（LONG_PRESS_MS）：右键（弹出被控端的右键菜单）。按住之后再移动是右键拖动（拖窗口、框选）；
// * 两根手指一起滑：滚动（发滚轮）。两根手指轻点（没滑动）等于右键，比长按顺手。
//
// 触摸时的绝对坐标和鼠标一样按画面算（多屏时落在第几路画面上，见 input.ts 的 locate）。
// 手指没有 hover，所以不涉及相对移动、指针锁定、鼠标模式：触摸一律发绝对坐标。
import type { InputEvent, MouseButton } from "./api";

/** 手指按下之后移动超过这么多 CSS 像素才算拖动（不到就是点击） */
export const TAP_SLOP = 10;
/** 按住这么久不动就是右键 */
export const LONG_PRESS_MS = 450;
/** 两根手指的中心移动超过这么多 CSS 像素才算滚动，不到就当成双指点击（右键） */
export const SCROLL_SLOP = 8;
/** 手指滑动 1 CSS 像素滚动多少（和鼠标滚轮一样按 DOM 像素算，见 input.ts 的 wheel） */
const WHEEL_PER_PX = 1.2;

/** 一根手指 */
export interface TouchPointer {
  pointerId: number;
  clientX: number;
  clientY: number;
}

/** 触摸要用的两个本事（RemoteInput 提供） */
export interface TouchHost {
  /** 客户端坐标 → 画面上的归一化坐标（第几路画面，见 RemoteInput.posAt） */
  posAt(clientX: number, clientY: number): { x: number; y: number; stream?: number };
  /** 发事件（和鼠标一样合并、节流，见 RemoteInput.enqueue） */
  send(events: InputEvent[], urgent: boolean): void;
}

/** 手指（一根或几根）正在做什么 */
type Gesture = "none" | "tap" | "scroll";

export class TouchInput {
  private host: TouchHost;
  /** 现在按着的手指 */
  private points = new Map<number, { x: number; y: number }>();
  private gesture: Gesture = "none";
  /** 单指：起点、移动过没有、长按（右键）发过没有 */
  private tap: { x: number; y: number; dragged: boolean; longFired: boolean } | null = null;
  /** 长按的定时器 */
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** 已经发过左键按下（拖动中），松开时要发左键抬起 */
  private leftDown = false;
  /** 长按之后又移动，发过右键按下（右键拖动） */
  private rightDown = false;
  /** 两根手指的中心、累计移动了多少（判断是滚动还是双指点击） */
  private scroll: { x: number; y: number; moved: number } | null = null;
  /** 还没发出去的滚轮量（不到 1 的攒着，见 input.ts 的 wheel） */
  private wheel = { x: 0, y: 0 };

  constructor(host: TouchHost) {
    this.host = host;
  }

  /** 断开 / 换会话 / 画面不能操作了：按着的都松开，状态清空 */
  reset() {
    this.cancelTimer();
    this.releaseHeld();
    this.points.clear();
    this.tap = null;
    this.scroll = null;
    this.gesture = "none";
    this.wheel = { x: 0, y: 0 };
  }

  down(p: TouchPointer) {
    this.points.set(p.pointerId, { x: p.clientX, y: p.clientY });
    if (this.points.size === 1) {
      this.gesture = "tap";
      this.tap = { x: p.clientX, y: p.clientY, dragged: false, longFired: false };
      this.cancelTimer();
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.longPress();
      }, LONG_PRESS_MS);
      if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
        // 别让定时器吊着进程（node --test 里会一直不退出）
        (this.timer as unknown as { unref(): void }).unref();
      }
      return;
    }
    // 第二根手指：不点也不拖了，正在按着的键松开，改成滚动
    this.cancelTimer();
    this.releaseHeld();
    this.tap = null;
    if (this.points.size === 2) {
      const c = this.center();
      this.scroll = { x: c.x, y: c.y, moved: 0 };
      this.gesture = "scroll";
    }
  }

  move(p: TouchPointer) {
    const pt = this.points.get(p.pointerId);
    if (!pt) return;
    pt.x = p.clientX;
    pt.y = p.clientY;

    if (this.gesture === "scroll") {
      // 只剩一根手指（另一根先抬起了）：继续按住不算滚动，等它抬起结束手势
      if (!this.scroll || this.points.size < 2) return;
      const c = this.center();
      const dx = c.x - this.scroll.x;
      const dy = c.y - this.scroll.y;
      this.scroll.x = c.x;
      this.scroll.y = c.y;
      this.scroll.moved += Math.hypot(dx, dy);
      if (this.scroll.moved > SCROLL_SLOP) this.scrollBy(dx, dy);
      return;
    }

    const tap = this.tap;
    if (this.gesture !== "tap" || !tap) return;

    // 长按发了右键之后还在动：右键拖动（拖窗口、框选）
    if (tap.longFired) {
      if (!this.rightDown) {
        this.rightDown = true;
        this.send([this.moveTo(p), { type: "mouseButton", button: "right", down: true }], true);
      } else {
        this.send([this.moveTo(p)], false);
      }
      return;
    }

    if (!tap.dragged && Math.hypot(p.clientX - tap.x, p.clientY - tap.y) <= TAP_SLOP) {
      // 手指抖动：先不发，免得点击变成拖动
      return;
    }
    if (!tap.dragged) {
      tap.dragged = true;
      this.cancelTimer();
      if (this.leftDown) return;
      this.leftDown = true;
      // 先按住起点，再拖到手指现在的位置
      this.send(
        [
          { type: "mouseMove", ...this.host.posAt(tap.x, tap.y) },
          { type: "mouseButton", button: "left", down: true },
          this.moveTo(p),
        ],
        true,
      );
      return;
    }
    this.send([this.moveTo(p)], false);
  }

  up(p: TouchPointer) {
    this.points.delete(p.pointerId);

    if (this.gesture === "scroll") {
      // 两根手指都抬起来了才结束：期间滑过就是滚动，没滑过就是双指点击（右键）
      if (this.points.size > 0) return;
      const tapped = this.scroll !== null && this.scroll.moved <= SCROLL_SLOP;
      this.scroll = null;
      this.gesture = "none";
      if (tapped) this.click(p, "right");
      return;
    }

    if (this.gesture !== "tap" || !this.tap) {
      // 三根手指以上之类：松开就完了
      this.gesture = "none";
      return;
    }
    const tap = this.tap;
    this.cancelTimer();
    this.tap = null;
    this.gesture = "none";
    if (this.leftDown) {
      this.leftDown = false;
      this.send([this.moveTo(p), { type: "mouseButton", button: "left", down: false }], true);
    } else if (this.rightDown) {
      this.rightDown = false;
      this.send([this.moveTo(p), { type: "mouseButton", button: "right", down: false }], true);
    } else if (!tap.longFired) {
      // 点一下：先把指针移过去，再按下、抬起（一起发，顺序不变）
      this.click(p, "left");
    }
  }

  /** 浏览器把触摸收走了（滚动页面、切换应用……）：按着的都松开，不然被控端一直按着 */
  cancel() {
    this.cancelTimer();
    this.releaseHeld();
    this.points.clear();
    this.tap = null;
    this.scroll = null;
    this.gesture = "none";
    this.wheel = { x: 0, y: 0 };
  }

  // ───────────────────────── 内部 ─────────────────────────

  /** 长按：右键单击（弹出被控端的右键菜单） */
  private longPress() {
    const tap = this.tap;
    if (!tap || this.gesture !== "tap" || this.points.size !== 1) return;
    tap.longFired = true;
    this.click({ clientX: tap.x, clientY: tap.y }, "right");
  }

  /** 在某个位置点一下（左键或右键：按下、抬起） */
  private click(p: { clientX: number; clientY: number }, button: MouseButton) {
    this.send(
      [
        this.moveTo(p),
        { type: "mouseButton", button, down: true },
        { type: "mouseButton", button, down: false },
      ],
      true,
    );
  }

  /** 手指的位置（绝对坐标） */
  private moveTo(p: { clientX: number; clientY: number }): InputEvent {
    return { type: "mouseMove", ...this.host.posAt(p.clientX, p.clientY) };
  }

  /** 已经发过的"按下"补上"松开"（换手势、被浏览器打断时） */
  private releaseHeld() {
    const events: InputEvent[] = [];
    if (this.leftDown) events.push({ type: "mouseButton", button: "left", down: false });
    if (this.rightDown) events.push({ type: "mouseButton", button: "right", down: false });
    this.leftDown = false;
    this.rightDown = false;
    if (events.length) this.send(events, true);
  }

  /** 两根手指的中心 */
  private center() {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const p of this.points.values()) {
      x += p.x;
      y += p.y;
      n++;
    }
    return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
  }

  /** 手指滑了多少就滚多少（和鼠标滚轮一样按 DOM 像素算，见 input.ts 的 wheel） */
  private scrollBy(dx: number, dy: number) {
    // 触摸是"抓着画面拖"：手指向右滑，看到的是左边的内容，等于滚轮向左（dx 为负）；
    // 手指向下滑，看到的是上面的内容，等于滚轮向上（dy 为正，见 proto 的 Wheel）
    this.wheel.x -= dx * WHEEL_PER_PX;
    this.wheel.y += dy * WHEEL_PER_PX;
    const ix = Math.trunc(this.wheel.x);
    const iy = Math.trunc(this.wheel.y);
    if (!ix && !iy) return;
    this.wheel.x -= ix;
    this.wheel.y -= iy;
    const clamp = (n: number) => Math.max(-32000, Math.min(32000, n));
    this.send([{ type: "wheel", dx: clamp(ix), dy: clamp(iy) }], true);
  }

  private cancelTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private send(events: InputEvent[], urgent: boolean) {
    this.host.send(events, urgent);
  }
}
