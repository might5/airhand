// 触摸屏：手指变成被控端的鼠标事件（网页版在平板、触摸屏上的画面操作）。
//
// 协议里的触摸事件（`InputEvent::Touch`）只发给声明了能接收触摸的被控端，而桌面版的被控端（macOS / Windows / Linux）
// 都不声明（见 airhand_proto::session 的 HostHello.touch）：手指只能翻译成鼠标，和用鼠标操作一样。
//
// 两种触摸方式（工具栏里随时切换，见 store 的 touchMode）：
//
// ── 触屏（touch）── 手指按哪儿，指针就到哪儿，和直接点屏幕一样
// * 单指点一下：左键在手指的位置按一下。手指会抖，按下之后移动不到 TAP_SLOP 才算点击——直接按下就发的话，
//   想点一下，被控端往往收到的是"按住、挪了一下、松开"（拖动了图标、选中了文字）；
// * 单指按住拖：移动超过 TAP_SLOP 才发左键按下，之后跟着手指走。这样点击和拖动都准；
// * 单指按住不动（LONG_PRESS_MS）：右键（弹出被控端的右键菜单）。按住之后再移动是右键拖动（拖窗口、框选）；
// * 两根手指一起滑：滚动（发滚轮）。两根手指轻点（没滑动）等于右键，比长按顺手。
//
// ── 触摸板（trackpad）── 手指在画面上滑，指针跟着走（和手机端的 TRACKPAD 一样，见 android 的 Gestures.kt）：
// * 手指不用压在指针上：位置是本机自己记的，画面上由 input.ts 画一个本机指针（host.pointer），
//   离开画面边沿不会丢，也不用等被控端把光标画回来（被控端的光标可能被自己的图层挡住、或者被隐藏）；
// * 单指滑：指针按滑动速度加速移动，手指停了指针就停；滑得快要到边上时不会跑出去（clamp 在画面里）；
// * 单指点一下：在指针的位置左键单击；
// * 双击（DOUBLE_TAP_MS 之内、离上次点击不远）之后不松开地滑：左键按住拖动（拖文件、选文字）；
// * 长按不动：在指针的位置右键单击；
// * 两根手指滑：滚动；两根手指轻点：在指针的位置右键。
//
// ── 多指（特斯拉车机支持 10 点）── 两种方式都一样：
// * 两根手指捏合 / 张开：缩放（发 Cmd+= / Cmd+-：浏览器、预览、Figma 都认这一组）；
// * 两根手指甩出去再松开：滚动带一点惯性，滑一段才停（和触控板一样）；
// * 三根手指轻点：中键（关标签页、在新窗口打开链接）；
// * 三根手指左右滑：切桌面（Ctrl+← / →）。
//
// 触摸时的绝对坐标和鼠标一样按画面算（多屏时落在第几路画面上，见 input.ts 的 locate）。
// 手指没有 hover，所以不涉及相对移动、指针锁定、鼠标模式：两种方式都发绝对坐标。
import type { InputEvent, MouseButton } from "./api";

/** 手指按下之后移动超过这么多 CSS 像素才算拖动（不到就是点击） */
export const TAP_SLOP = 10;
/** 按住这么久不动就是右键 */
export const LONG_PRESS_MS = 450;
/** 两根手指的中心移动超过这么多 CSS 像素才算滚动，不到就当成双指点击（右键） */
export const SCROLL_SLOP = 8;
/** 两次点击之间不到这么久、又离得不远，就算双击（触摸板模式下双击之后可以按住拖） */
export const DOUBLE_TAP_MS = 300;
/** 手指滑动 1 CSS 像素滚动多少：一比一跟手（惯性由本机按相位算，见 startMomentum） */
const WHEEL_PER_PX = 1;
/** 松手之后滚动还滑多久（惯性：手指甩出去，画面再滑一段才停） */
export const MOMENTUM_MS = 320;
/** 甩得多快才有惯性（每毫秒多少 CSS 像素）：慢慢松开不该滑 */
const MOMENTUM_MIN = 0.25;
/** 松手之前最后一帧超过这么久（毫秒）：说明手指早就停住了，不该再滑 */
const MOMENTUM_HOLD_MS = 100;
/** 算滑动的速度要看这么长的一段（毫秒）：太短的一瞬不能当速度 */
const MOMENTUM_WINDOW_MS = 40;
/** 惯性每帧衰减多少（16ms 一帧，320ms 之后基本停下） */
const MOMENTUM_DECAY = 0.92;
/** 惯性按帧算：一帧多少毫秒 */
const FRAME_MS = 16;
/** 两指距离变化超过这么多 CSS 像素才算捏合（之前只是两指滑动的抖动） */
export const PINCH_SLOP = 20;
/** 两指距离差这么多倍算一格缩放（1.15 = 张开 15% 按一次 Cmd+=） */
const PINCH_STEP = 1.15;
/** 三根手指一起横移超过这么多 CSS 像素才算滑，不到就是三指轻点 */
export const THREE_SLOP = 50;
/** 手势起点落在画面最外这么多 CSS 像素内：多半是从屏幕边缘切进来的，不认（见 down） */
export const EDGE_PX = 8;

/** 触摸方式：触屏（手指按哪儿指针到哪儿）还是触摸板（手指滑，指针跟着走） */
export type TouchStyle = "touch" | "trackpad";

/**
 * 实际用哪种方式：选的就是它；选"自动"时按被控端的系统来——电脑（macOS / Windows / Linux）用触摸板，
 * 手机、平板用触屏（它们本来就没有指针，iOS 被控端还只让看）。
 */
export function resolveTouchStyle(mode: "auto" | "trackpad" | "touch", platform: string | null): TouchStyle {
  if (mode === "touch" || mode === "trackpad") return mode;
  return platform === "android" || platform === "ios" ? "touch" : "trackpad";
}

/**
 * 触摸板模式下滑得越快指针走得越远（像素 / 毫秒 → 倍数）。
 * 和手机端一样（见 android 的 Gestures.kt 的 accel）：慢慢滑好对准，快快甩一下能跨过整个画面。
 */
export function trackpadGain(pxPerMs: number): number {
  return Math.min(2.4, Math.max(0.7, 0.7 + (pxPerMs - 0.2) * 0.9));
}

/** 一根手指 */
export interface TouchPointer {
  pointerId: number;
  clientX: number;
  clientY: number;
}

/** 触摸要用的本事（RemoteInput 提供） */
export interface TouchHost {
  /** 客户端坐标 → 画面上的归一化坐标（第几路画面，见 RemoteInput.posAt） */
  posAt(clientX: number, clientY: number): { x: number; y: number; stream?: number };
  /** 发事件（和鼠标一样合并、节流，见 RemoteInput.enqueue） */
  send(events: InputEvent[], urgent: boolean): void;
  /** 画面在网页里的位置和大小：触摸板模式的指针只在画面里走 */
  rect(): { left: number; top: number; width: number; height: number };
  /** 触摸板模式下本机画的指针挪到客户端的哪里（null = 不画） */
  pointer(pos: { x: number; y: number } | null): void;
}

/** 手指（一根或几根）正在做什么 */
type Gesture = "none" | "tap" | "scroll" | "three";

/** 一根手指按下去之后的状态 */
interface Tap {
  /** 按下的位置（判断抖动、双击） */
  x: number;
  y: number;
  /** 移动超过 TAP_SLOP 了（这次是拖动，不是点击） */
  dragged: boolean;
  /** 长按的右键已经发出去了 */
  longFired: boolean;
  /** 双击之后按下的：开始滑动时按住左键拖 */
  doubleDrag: boolean;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class TouchInput {
  private host: TouchHost;
  /** 触屏还是触摸板 */
  private style: TouchStyle = "touch";
  /** 现在按着的手指 */
  private points = new Map<number, { x: number; y: number }>();
  private gesture: Gesture = "none";
  /** 单指：起点、移动过没有、长按（右键）发过没有 */
  private tap: Tap | null = null;
  /** 长按的定时器 */
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** 已经发过左键按下（拖动中），松开时要发左键抬起 */
  private leftDown = false;
  /** 长按之后又移动，发过右键按下（右键拖动） */
  private rightDown = false;
  /** 两根手指的中心、累计移动了多少（判断是滚动还是双指点击） */
  private scroll: { x: number; y: number; moved: number } | null = null;
  /** 两指捏合：上一帧的两指距离、确定缩放之后的基准距离、这次手势是不是已经进入缩放 */
  private pinch: { base: number; ref: number; scaled: boolean } | null = null;
  /** 三根手指：起点、当前中心、横滑发过没有 */
  private three: { startX: number; startY: number; x: number; y: number; fired: boolean } | null = null;
  /** 滚动的速度（CSS 像素 / 毫秒）和这一档速度的时刻：松手之后的惯性用它 */
  private velocity = { x: 0, y: 0, t: 0 };
  /** 算速度用的窗口：从什么时候、攒了多少位移（一帧的抖动不能当速度） */
  private scrollWindow = { t: 0, dx: 0, dy: 0 };
  /** 惯性的定时器 */
  private momentum: ReturnType<typeof setInterval> | undefined;
  /** 还没发出去的滚轮量（不到 1 的攒着，见 input.ts 的 wheel） */
  private wheel = { x: 0, y: 0 };

  // ── 触摸板 ──
  /** 本机记着的指针（客户端坐标）：手指松开也留着，下次接着这里走；null = 还没出现过 */
  private pointer: { clientX: number; clientY: number } | null = null;
  /** 上一个 move 的位置和时刻（算滑动速度，见 trackpadGain） */
  private last = { x: 0, y: 0, t: 0 };
  /** 上一次点击（判断双击） */
  private lastTap: { t: number; x: number; y: number } | null = null;

  constructor(host: TouchHost) {
    this.host = host;
  }

  /** 换触摸方式：正在按着的手势作废，本机画的指针先收起来（触屏用不着） */
  setStyle(style: TouchStyle) {
    if (style === this.style) return;
    this.reset();
    this.style = style;
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
    this.lastTap = null;
    if (this.pointer) this.setPointer(null);
  }

  down(p: TouchPointer) {
    this.points.set(p.pointerId, { x: p.clientX, y: p.clientY });
    if (this.points.size === 1) {
      const tap: Tap = { x: p.clientX, y: p.clientY, dragged: false, longFired: false, doubleDrag: false };
      this.tap = tap;
      this.gesture = "tap";
      this.cancelTimer();
      if (this.style === "trackpad") {
        this.last = { x: p.clientX, y: p.clientY, t: now() };
        // 第一次摸：指针从画面中间开始（手指在哪儿和指针在哪儿无关）
        if (!this.pointer) {
          const r = this.host.rect();
          this.setPointer({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
        }
        const last = this.lastTap;
        if (last && now() - last.t < DOUBLE_TAP_MS && Math.hypot(p.clientX - last.x, p.clientY - last.y) < TAP_SLOP * 4) {
          // 双击之后不松开：接着滑就是按住拖（见 move）
          tap.doubleDrag = true;
          this.lastTap = null;
        }
      }
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
    this.lastTap = null;
    // 从屏幕边缘切进来的多指滑动基本是系统的手势区在抢，不当成我们的手势
    if (this.nearEdge()) {
      this.scroll = null;
      this.pinch = null;
      this.three = null;
      this.gesture = "none";
      return;
    }
    if (this.points.size === 2) {
      const c = this.center();
      const [a, b] = [...this.points.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.scroll = { x: c.x, y: c.y, moved: 0 };
      this.pinch = { base: d, ref: d, scaled: false };
      // 速度从这里开始攒（松手之后的惯性用它）
      this.velocity = { x: 0, y: 0, t: 0 };
      this.scrollWindow = { t: 0, dx: 0, dy: 0 };
      this.three = null;
      this.gesture = "scroll";
      return;
    }
    // 第三根手指：三指手势（轻点是中键，左右滑是切桌面），不滚也不点
    const c = this.center();
    this.scroll = null;
    this.pinch = null;
    this.three = { startX: c.x, startY: c.y, x: c.x, y: c.y, fired: false };
    this.gesture = "three";
  }

  move(p: TouchPointer) {
    const pt = this.points.get(p.pointerId);
    if (!pt) return;
    pt.x = p.clientX;
    pt.y = p.clientY;

    if (this.gesture === "three") {
      // 三根手指：左右滑一下切桌面（Ctrl+← / →），一次手势只发一次
      const t = this.three;
      if (!t || this.points.size < 3) return;
      const c = this.center();
      t.x = c.x;
      t.y = c.y;
      const dx = t.x - t.startX;
      const dy = t.y - t.startY;
      if (!t.fired && Math.abs(dx) > THREE_SLOP && Math.abs(dx) > Math.abs(dy)) {
        t.fired = true;
        this.combo(["ControlLeft", dx > 0 ? "ArrowRight" : "ArrowLeft"]);
      }
      return;
    }

    if (this.gesture === "scroll") {
      // 只剩一根手指（另一根先抬起了）：继续按住不算滚动，等它抬起结束手势
      if (!this.scroll || this.points.size < 2) return;
      const c = this.center();
      const dx = c.x - this.scroll.x;
      const dy = c.y - this.scroll.y;
      this.scroll.x = c.x;
      this.scroll.y = c.y;
      this.scroll.moved += Math.hypot(dx, dy);
      // 两指捏合 / 张开：两指的距离在变，而两指的中心几乎没动（中心动得更多就是滚动），
      // 发 Cmd+= / Cmd+-，这期间不滚
      const pinch = this.pinch;
      if (pinch) {
        const [a, b] = [...this.points.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const dd = Math.abs(d - pinch.base);
        const dc = Math.hypot(dx, dy);
        pinch.base = d;
        if (pinch.scaled || (dd > PINCH_SLOP && dd > dc * 1.2)) {
          pinch.scaled = true;
          const ratio = d / Math.max(1, pinch.ref);
          if (ratio >= PINCH_STEP || ratio <= 1 / PINCH_STEP) {
            // 每差一格按一次（张开 = 放大）
            pinch.ref = d;
            this.combo(["MetaLeft", ratio >= PINCH_STEP ? "Equal" : "Minus"]);
          }
          return;
        }
      }
      if (this.scroll.moved > SCROLL_SLOP) this.scrollBy(dx, dy);
      return;
    }

    const tap = this.tap;
    if (this.gesture !== "tap" || !tap) return;
    if (this.style === "trackpad") {
      this.moveTrackpad(p, tap);
      return;
    }

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

    if (this.gesture === "three") {
      // 三根手指都抬起来了：没横滑出去就是轻点（中键）
      if (this.points.size > 0) return;
      const t = this.three;
      this.three = null;
      this.gesture = "none";
      if (t && !t.fired && Math.hypot(t.x - t.startX, t.y - t.startY) <= THREE_SLOP) {
        this.click(this.clickPos({ clientX: t.startX, clientY: t.startY }), "middle");
      }
      return;
    }

    if (this.gesture === "scroll") {
      // 两根手指都抬起来了才结束：期间滑过就是滚动，没滑过就是双指点击（右键）
      if (this.points.size > 0) return;
      const tapped = this.scroll !== null && this.scroll.moved <= SCROLL_SLOP;
      const scaled = this.pinch?.scaled === true;
      this.scroll = null;
      this.pinch = null;
      this.gesture = "none";
      if (scaled) {
        // 缩放完松手：不补点击，也不带惯性
        this.velocity = { x: 0, y: 0, t: 0 };
        this.scrollWindow = { t: 0, dx: 0, dy: 0 };
      } else if (tapped) {
        this.click(this.clickPos(p), "right");
      } else {
        // 甩出去的：松手之后接着滑一段（见 startMomentum）
        this.startMomentum();
      }
      return;
    }

    const tap = this.tap;
    if (this.gesture !== "tap" || !tap) {
      // 三根手指以上之类：松开就完了
      this.gesture = "none";
      return;
    }
    this.cancelTimer();
    this.tap = null;
    this.gesture = "none";
    const at = this.clickPos(p);
    if (this.leftDown) {
      this.leftDown = false;
      this.send([this.moveTo(at), { type: "mouseButton", button: "left", down: false }], true);
    } else if (this.rightDown) {
      this.rightDown = false;
      this.send([this.moveTo(at), { type: "mouseButton", button: "right", down: false }], true);
    } else if (!tap.longFired && !tap.dragged) {
      // 点一下：先把指针移过去，再按下、抬起（一起发，顺序不变）
      this.click(at, "left");
      // 触摸板：记下来；第二次按下够快就是双击（双击之后滑 = 按住拖）
      if (this.style === "trackpad") this.lastTap = { t: now(), x: tap.x, y: tap.y };
    }
  }

  /** 浏览器把触摸收走了（滚动页面、切换应用……）：按着的都松开，不然被控端一直按着 */
  cancel() {
    this.cancelTimer();
    this.stopMomentum();
    this.releaseHeld();
    this.points.clear();
    this.tap = null;
    this.scroll = null;
    this.pinch = null;
    this.three = null;
    this.gesture = "none";
    this.wheel = { x: 0, y: 0 };
  }

  // ───────────────────────── 触摸板 ─────────────────────────

  /** 触摸板：手指滑了多远，指针就走多远（按速度加速） */
  private moveTrackpad(p: TouchPointer, tap: Tap) {
    const dx = p.clientX - this.last.x;
    const dy = p.clientY - this.last.y;
    const t = now();
    const dt = Math.max(1, t - this.last.t);
    this.last = { x: p.clientX, y: p.clientY, t };

    if (!tap.dragged && Math.hypot(p.clientX - tap.x, p.clientY - tap.y) > TAP_SLOP) {
      tap.dragged = true;
      this.cancelTimer();
      if (tap.doubleDrag && !this.leftDown) {
        // 双击之后开始滑：在指针的位置按住左键拖（拖文件、选文字）
        this.leftDown = true;
        this.send([this.moveTo(this.pointerAt()), { type: "mouseButton", button: "left", down: true }], true);
      }
    }
    if (!tap.dragged) {
      // 手指抖：指针先不动，免得点一下的时候光标滑出去
      return;
    }
    const gain = trackpadGain(Math.hypot(dx, dy) / dt);
    const at = this.pointerAt();
    const r = this.host.rect();
    this.setPointer({
      clientX: clamp(at.clientX + dx * gain, r.left + 1, r.left + Math.max(1, r.width) - 1),
      clientY: clamp(at.clientY + dy * gain, r.top + 1, r.top + Math.max(1, r.height) - 1),
    });
    this.send([this.moveTo(this.pointerAt())], false);
  }

  /** 指针现在在客户端的哪儿（还没有就是画面中间） */
  private pointerAt(): { clientX: number; clientY: number } {
    const r = this.host.rect();
    const lo = { x: r.left + 1, y: r.top + 1 };
    const hi = { x: r.left + Math.max(1, r.width) - 1, y: r.top + Math.max(1, r.height) - 1 };
    if (this.pointer) {
      // 画面缩放、窗口挪动之后，记着的位置可能已经在画面外：拉回来
      const c = {
        clientX: clamp(this.pointer.clientX, lo.x, hi.x),
        clientY: clamp(this.pointer.clientY, lo.y, hi.y),
      };
      if (c.clientX !== this.pointer.clientX || c.clientY !== this.pointer.clientY) this.setPointer(c);
      return c;
    }
    const c = { clientX: (lo.x + hi.x) / 2, clientY: (lo.y + hi.y) / 2 };
    this.setPointer(c);
    return c;
  }

  /** 记下指针的位置，并让 input.ts 把它画出来（null = 收起来） */
  private setPointer(pos: { clientX: number; clientY: number } | null) {
    this.pointer = pos;
    this.host.pointer(pos ? { x: pos.clientX, y: pos.clientY } : null);
  }

  // ───────────────────────── 内部 ─────────────────────────

  /** 长按：右键单击（弹出被控端的右键菜单） */
  private longPress() {
    const tap = this.tap;
    if (!tap || this.gesture !== "tap" || this.points.size !== 1 || tap.dragged) return;
    tap.longFired = true;
    this.click(this.clickPos({ clientX: tap.x, clientY: tap.y }), "right");
  }

  /** 点击落在哪儿：触屏是手指的位置，触摸板是画面上那个指针的位置 */
  private clickPos(finger: { clientX: number; clientY: number }): { clientX: number; clientY: number } {
    return this.style === "trackpad" ? this.pointerAt() : finger;
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

  /** 发一组组合键：修饰键先按下，主键抬起之后再松开（和 session.ts 的 sendCombo 一样） */
  private combo(codes: string[]) {
    const events: InputEvent[] = [];
    for (const code of codes) events.push({ type: "key", code, down: true });
    for (const code of [...codes].reverse()) events.push({ type: "key", code, down: false });
    this.send(events, true);
  }

  /** 松手之后的惯性：按最后一帧的速度接着滚，越滚越慢（MOMENTUM_MS 之后停下） */
  private startMomentum() {
    let vx = this.velocity.x;
    let vy = this.velocity.y;
    // 松手之前手指就已经停住了：不该再滑
    if (now() - this.velocity.t > MOMENTUM_HOLD_MS) return;
    // 慢慢松开的不该再滑：只有甩出去的才有惯性
    if (Math.hypot(vx, vy) < MOMENTUM_MIN) return;
    this.stopMomentum();
    const t0 = now();
    this.momentum = setInterval(() => {
      if (now() - t0 > MOMENTUM_MS) {
        this.stopMomentum();
        return;
      }
      vx *= MOMENTUM_DECAY;
      vy *= MOMENTUM_DECAY;
      if (Math.hypot(vx, vy) < MOMENTUM_MIN * 0.4) {
        this.stopMomentum();
        return;
      }
      this.wheelBy(vx * FRAME_MS, vy * FRAME_MS);
    }, FRAME_MS);
    if (typeof this.momentum === "object" && this.momentum && "unref" in this.momentum) {
      // 别让定时器吊着进程（node --test 里会一直不退出）
      (this.momentum as unknown as { unref(): void }).unref();
    }
  }

  private stopMomentum() {
    if (this.momentum === undefined) return;
    clearInterval(this.momentum);
    this.momentum = undefined;
  }

  /** 按着的手指有落在画面最外一圈的（见 EDGE_PX） */
  private nearEdge() {
    const r = this.host.rect();
    for (const p of this.points.values()) {
      if (
        p.x <= r.left + EDGE_PX ||
        p.x >= r.left + r.width - EDGE_PX ||
        p.y <= r.top + EDGE_PX ||
        p.y >= r.top + r.height - EDGE_PX
      ) {
        return true;
      }
    }
    return false;
  }

  /** 手指滑了多少就滚多少（和鼠标滚轮一样按 DOM 像素算，见 input.ts 的 wheel） */
  private scrollBy(dx: number, dy: number) {
    // 顺手记下滑动的速度：松手之后靠它算惯性（见 startMomentum）。
    // 一帧的位移不能当速度（同一时刻两根手指各报一次，除以 1 毫秒会算出"飞快"），
    // 攒够一个窗口再看这段时间里滑了多远。
    const t = now();
    if (!this.scrollWindow.t) this.scrollWindow = { t, dx: 0, dy: 0 };
    this.scrollWindow.dx += dx;
    this.scrollWindow.dy += dy;
    const win = t - this.scrollWindow.t;
    if (win >= MOMENTUM_WINDOW_MS) {
      this.velocity = { x: this.scrollWindow.dx / win, y: this.scrollWindow.dy / win, t };
      this.scrollWindow = { t, dx: 0, dy: 0 };
    }
    this.wheelBy(dx, dy);
  }

  /** 真的把滚轮发出去（不到 1 像素的攒着，下次一起发） */
  private wheelBy(dx: number, dy: number) {
    // 触摸是"抓着画面拖"：手指向右滑，看到的是左边的内容，等于滚轮向左（dx 为负）；
    // 手指向下滑，看到的是上面的内容，等于滚轮向上（dy 为正，见 proto 的 Wheel）
    this.wheel.x -= dx * WHEEL_PER_PX;
    this.wheel.y += dy * WHEEL_PER_PX;
    const ix = Math.trunc(this.wheel.x);
    const iy = Math.trunc(this.wheel.y);
    if (!ix && !iy) return;
    this.wheel.x -= ix;
    this.wheel.y -= iy;
    const clampWheel = (n: number) => Math.max(-32000, Math.min(32000, n));
    this.send([{ type: "wheel", dx: clampWheel(ix), dy: clampWheel(iy) }], true);
  }

  private cancelTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private send(events: InputEvent[], urgent: boolean) {
    this.host.send(events, urgent);
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
