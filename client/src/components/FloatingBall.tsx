// 悬浮球：专注模式下界面上唯一常驻的东西。点一下叫出工具栏，再点一下收起。
//
// 位置可以拖，拖过就记在本机（localStorage），下次打开还在那儿；窗口变小了会被拉回可视区。
// 拖动和点击靠位移区分：按下后移动超过 DRAG 才算拖，否则松手就是点击。
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { IconClose, IconOrb } from "./Icons";

const POS_KEY = "airhand.orb";
/** 球的直径、离窗口边缘至少留多少（和 styles.css 的 .orb 一致） */
const SIZE = 40;
const EDGE = 10;
/** 移动超过这么多像素才算拖动 */
const DRAG = 3;

type Pos = { x: number; y: number };

function load(): Pos | null {
  try {
    const raw = globalThis.localStorage?.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Pos>;
    return typeof p?.x === "number" && typeof p?.y === "number" ? { x: p.x, y: p.y } : null;
  } catch {
    return null;
  }
}

function save(p: Pos) {
  try {
    globalThis.localStorage?.setItem(POS_KEY, JSON.stringify(p));
  } catch {
    // 存不了就只在这次有效
  }
}

/** 别让它跑到窗口外面去（也不压住边缘） */
const within = (v: number, max: number) => Math.max(EDGE, Math.min(v, max - SIZE - EDGE));

export function FloatingBall({
  open,
  onToggle,
  title,
}: {
  /** 工具栏正开着 */
  open: boolean;
  onToggle: () => void;
  title: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<Pos | null>(load);
  const at = useRef<Pos | null>(pos);

  const move = (p: Pos) => {
    at.current = p;
    setPos(p);
  };

  // 窗口大小变了：位置还在记录里，但要保证看得见
  useEffect(() => {
    const fit = () => {
      const p = at.current;
      if (!p) return;
      const next = { x: within(p.x, window.innerWidth), y: within(p.y, window.innerHeight) };
      if (next.x !== p.x || next.y !== p.y) move(next);
    };
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const press = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    let dragged = false;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!dragged && Math.abs(dx) < DRAG && Math.abs(dy) < DRAG) return;
      dragged = true;
      move({ x: within(start.left + dx, window.innerWidth), y: within(start.top + dy, window.innerHeight) });
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      if (dragged) {
        if (at.current) save(at.current);
      } else {
        onToggle();
      }
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };

  return (
    <button
      ref={ref}
      className={`orb ${open ? "open" : ""} ${pos ? "placed" : ""}`}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      title={title}
      aria-label={title}
      aria-expanded={open}
      onPointerDown={press}
      // 按下时不抢走远程画面的键盘焦点
      onMouseDown={(e) => e.preventDefault()}
    >
      {open ? <IconClose size={17} /> : <IconOrb size={18} />}
    </button>
  );
}
