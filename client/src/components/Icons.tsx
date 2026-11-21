// 内联线性图标（24×24，currentColor），不依赖任何图标库
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: P, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: P) => base(p, <path d="M12 5v14M5 12h14" />);
/** 鼠标（鼠标菜单：自动模式） */
export const IconMouse = (p: P) =>
  base(
    p,
    <>
      <rect x="6" y="3" width="12" height="18" rx="6" />
      <path d="M12 7v4" />
    </>,
  );
/** 指针箭头（鼠标菜单：桌面模式） */
export const IconPointer = (p: P) => base(p, <path d="M6 3.5v15l4.2-4.1 2.9 6.4 2.6-1.2-2.9-6.3h5.7z" />);
/** 手柄（鼠标菜单：游戏模式） */
export const IconGamepad = (p: P) =>
  base(
    p,
    <>
      <path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 5.4l-.9 4.3a2.3 2.3 0 0 1-4 1L14.3 16H9.7L8 17.7a2.3 2.3 0 0 1-4-1l-.9-4.3A4.5 4.5 0 0 1 7.5 7z" />
      <path d="M8 10v3M6.5 11.5h3" />
      <path d="M15.5 10.5h.01M17 12.5h.01" />
    </>,
  );
export const IconGrid = (p: P) =>
  base(
    p,
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>,
  );
export const IconMonitor = (p: P) =>
  base(
    p,
    <>
      <rect x="2.5" y="3.5" width="19" height="13" rx="2.2" />
      <path d="M8 20.5h8M12 16.5v4" />
    </>,
  );
export const IconClose = (p: P) => base(p, <path d="M6 6l12 12M18 6L6 18" />);
/** 放到单独的窗口里（弹出窗口） */
export const IconPopOut = (p: P) =>
  base(p, <path d="M13.5 4.5h6v6M19.5 4.5L11 13M17.5 14v4a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4" />);
/** 放回主窗口 */
export const IconPopIn = (p: P) =>
  base(p, <path d="M19.5 4.5L12 12M12 7v5h5M17.5 14v4a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8A1.5 1.5 0 0 1 6 6.5h4" />);
export const IconSliders = (p: P) =>
  base(
    p,
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>,
  );
export const IconKeyboard = (p: P) =>
  base(
    p,
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.2" />
      <path d="M6.5 9.5h.01M10 9.5h.01M13.5 9.5h.01M17 9.5h.01M6.5 12.5h.01M17 12.5h.01M8 15.5h8M10 12.5h4" />
    </>,
  );
export const IconClipboard = (p: P) =>
  base(
    p,
    <>
      <rect x="5.5" y="4.5" width="13" height="16" rx="2" />
      <path d="M9 4.5V3.8c0-.7.5-1.3 1.2-1.3h3.6c.7 0 1.2.6 1.2 1.3v.7M9 10h6M9 14h4" />
    </>,
  );
export const IconVolume = (p: P) =>
  base(
    p,
    <>
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.3 6.6a7.6 7.6 0 0 1 0 10.8" />
    </>,
  );
export const IconVolumeOff = (p: P) =>
  base(
    p,
    <>
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>,
  );
/** 麦克风（把本机的麦克风发给对方） */
export const IconMic = (p: P) =>
  base(
    p,
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
    </>,
  );
export const IconMicOff = (p: P) =>
  base(
    p,
    <>
      <path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5" />
      <path d="M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.4 12.6c.07-.5.1-1 .1-1.6M12 17.5V21M9 21h6M4 4l16 16" />
    </>,
  );
export const IconExpand = (p: P) => base(p, <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
export const IconShrink = (p: P) => base(p, <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />);
export const IconPower = (p: P) => base(p, <path d="M12 3v8M6.4 6.6a8 8 0 1 0 11.2 0" />);
export const IconRefresh = (p: P) =>
  base(p, <path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4" />);
export const IconChevron = (p: P) => base(p, <path d="M6 9l6 6 6-6" />);
/** 悬浮球里的四个点 */
export const IconOrb = (p: P) =>
  base(
    p,
    <>
      <circle cx="9.2" cy="9.2" r="1.85" />
      <circle cx="14.8" cy="9.2" r="1.85" />
      <circle cx="9.2" cy="14.8" r="1.85" />
      <circle cx="14.8" cy="14.8" r="1.85" />
    </>,
  );
/** 收起顶栏，只看画面（专注模式） */
export const IconCompact = (p: P) =>
  base(
    p,
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.4" />
      <path d="M3 9.5h18" opacity="0.4" />
      <path d="M9.2 14.4l2.8 2.6 2.8-2.6" />
    </>,
  );
/** 重新显示顶栏（退出专注模式） */
export const IconRestoreBar = (p: P) =>
  base(
    p,
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.4" />
      <path d="M3 9.5h18" />
      <path d="M9.2 16.4l2.8-2.6 2.8 2.6" />
    </>,
  );
export const IconSwap = (p: P) => base(p, <path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />);
export const IconFit = (p: P) =>
  base(
    p,
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 12h8M8 12l2-2M8 12l2 2M16 12l-2-2M16 12l-2 2" />
    </>,
  );
export const IconBolt = (p: P) => base(p, <path d="M13 2.5L4.5 13.5H12l-1 8 8.5-11H12l1-8z" />);
export const IconCpu = (p: P) =>
  base(
    p,
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2.5v3M15 2.5v3M9 18.5v3M15 18.5v3M2.5 9h3M2.5 15h3M18.5 9h3M18.5 15h3" />
    </>,
  );
/** 说明（ⓘ）：鼠标停在上面看详细说明 */
export const IconInfo = (p: P) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5h.01" />
    </>,
  );
export const IconWarn = (p: P) =>
  base(p, <path d="M12 3.5l9.5 16.5h-19L12 3.5zM12 10v4.5M12 17.5h.01" />);
export const IconHistory = (p: P) =>
  base(p, <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4h4M12 7.5V12l3 2" />);
export const IconArrowRight = (p: P) => base(p, <path d="M5 12h14M13 6l6 6-6 6" />);
export const IconPencil = (p: P) => base(p, <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />);
/** 设置（标签栏右侧的主菜单） */
export const IconSettings = (p: P) =>
  base(
    p,
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>,
  );
/** 中转服务器 */
export const IconServer = (p: P) =>
  base(
    p,
    <>
      <rect x="3.5" y="4" width="17" height="6.5" rx="2" />
      <rect x="3.5" y="13.5" width="17" height="6.5" rx="2" />
      <path d="M7.5 7.25h.01M7.5 16.75h.01M11 7.25h5.5M11 16.75h5.5" />
    </>,
  );
export const IconCopy = (p: P) =>
  base(
    p,
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.2" />
      <path d="M15.5 8.5V5.7c0-1.2-1-2.2-2.2-2.2H5.7c-1.2 0-2.2 1-2.2 2.2v7.6c0 1.2 1 2.2 2.2 2.2h2.8" />
    </>,
  );
export const IconCheck = (p: P) => base(p, <path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconSearch = (p: P) =>
  base(
    p,
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>,
  );

// ───────── 平台图标（设备列表用） ─────────
// 这些是品牌标识，用实心剪影比描边更容易一眼认出；颜色跟着 currentColor。
function solid(size: number, children: React.ReactNode) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
      {children}
    </svg>
  );
}
export const IconApple = ({ size = 18 }: { size?: number }) =>
  solid(
    size,
    <>
      <path d="M16.9 12.6c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-1.9-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.2 1-4.1 2.5-1.7 3-.4 7.5 1.3 9.9.8 1.2 1.8 2.5 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.8 1.3-2.8-.1 0-2.6-1-2.6-4z" />
      <path d="M14.3 5.3c.7-.8 1.1-2 1-3.2-1 0-2.2.7-2.9 1.5-.6.8-1.2 2-1 3.1 1.1.1 2.2-.6 2.9-1.4z" />
    </>,
  );
export const IconWindows = ({ size = 18 }: { size?: number }) =>
  solid(
    size,
    <path d="M3 4.9l8.3-1.2v8.1H3zm9.4-.2L21 3.2v8.6h-8.6zM3 13.1h8.3v8.1L3 20zM12.4 13.1H21v8.6l-8.6-1.5z" />,
  );
export const IconAndroid = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M5.4 16.8v-4.6a6.6 6.6 0 0 1 13.2 0v4.6z" />
    <path d="M7.6 6.9L5.7 4.4M16.4 6.9l1.9-2.5" />
    <circle cx="9.1" cy="12.6" r=".95" fill="currentColor" stroke="none" />
    <circle cx="14.9" cy="12.6" r=".95" fill="currentColor" stroke="none" />
    <path d="M10.6 18.6v1.7M13.4 18.6v1.7" strokeWidth={1.5} />
  </svg>
);
/** Linux：企鹅剪影（眼睛、肚子挖空），比画个终端好认 */
export const IconLinux = ({ size = 18 }: { size?: number }) =>
  solid(
    size,
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 2.9c-2.4 0-3.7 2-3.7 4.4 0 1 .2 1.9.5 2.6-1.4 2-2.7 4.6-2.7 6.7 0 2.3 2.6 3.8 5.9 3.8s5.9-1.5 5.9-3.8c0-2.1-1.3-4.7-2.7-6.7.3-.7.5-1.6.5-2.6 0-2.4-1.3-4.4-3.7-4.4zM10.3 6.1a.95.95 0 1 1 1.9 0 .95.95 0 0 1-1.9 0zm3.4 0a.95.95 0 1 1 1.9 0 .95.95 0 0 1-1.9 0zM12 13.2c1.6 0 2.9 1.1 2.9 2.6s-1.3 2.6-2.9 2.6-2.9-1.1-2.9-2.6 1.3-2.6 2.9-2.6z"
    />,
  );

/** 按对端报上来的系统名挑图标；认不出来就退回显示器 */
export function OsIcon({ os, size = 18 }: { os: string; size?: number }) {
  const s = (os || "").toLowerCase();
  if (/mac|darwin|os ?x|apple|ios|ipad/.test(s)) return <IconApple size={size} />;
  if (/win/.test(s)) return <IconWindows size={size} />;
  if (/android/.test(s)) return <IconAndroid size={size} />;
  if (/linux|ubuntu|debian|fedora|centos|arch|unix|bsd|chrome ?os/.test(s)) return <IconLinux size={size} />;
  return <IconMonitor size={size} />;
}

// 窗口按钮：细线图标（10×10），与 Windows 11 的标题栏按钮一致
function win(children: React.ReactNode) {
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1} aria-hidden>
      {children}
    </svg>
  );
}
export const IconWinMinimize = () => win(<path d="M0 5h10" />);
export const IconWinMaximize = () => win(<rect x="0.5" y="0.5" width="9" height="9" rx="1.2" />);
export const IconWinRestore = () =>
  win(
    <>
      <rect x="0.5" y="2.5" width="7" height="7" rx="1.2" />
      <path d="M2.5 2.5v-.8c0-.66.54-1.2 1.2-1.2h4.6c.66 0 1.2.54 1.2 1.2v4.6c0 .66-.54 1.2-1.2 1.2h-.8" />
    </>,
  );
export const IconWinClose = () => win(<path d="M.5.5l9 9M9.5.5l-9 9" />);
