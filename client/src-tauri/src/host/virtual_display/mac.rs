//! 补屏（macOS）：有会话时，合上笔记本的盖子、没接显示器也有显示器可看——一块虚拟显示器（CoreGraphics 没有公开的
//! `CGVirtualDisplay`，见 `mac.m`）。
//!
//! 合上盖子（没接外接显示器）时系统关掉内建的显示器，ScreenCaptureKit 没有东西可以采集，声音采集也没有显示器可挂；
//! 叫醒它也只是在盖子后面亮 10 秒又关掉（见 `power::wake_display`），画面每 10 秒断一次。
//!
//! **要在合上盖子之前就建好**：合上的那一刻 WindowServer 收到 `clamshell state:2`，这时还有别的显示器，就是系统
//! 自己的合盖模式——内建的显示器下去，那块显示器当主显示器，屏幕不睡；一块也没有，屏幕马上睡（`Did Sleep`），
//! 之后再建的虚拟显示器即使叫醒了屏幕（`DesktopMode grace`、`Did Wake`）也不往上画东西，控制端一直黑屏
//! （实测：合盖之后建的，叫醒以后一帧都采不到；合盖之前建好的，合上之后马上换到它上面，画面照常）。所以：
//!
//! * **预备**：开着盖子的笔记本，接着电源（用电池时合上盖子照样睡眠，备着也没用），没接别的显示器（接着的话合上
//!   盖子就是系统本来的合盖模式）时，有会话就建好虚拟显示器；开着“不自动睡眠”（被控端在运行，见 [`super::set_ready`]，
//!   接着电源时合上盖子也不睡）时没有会话也建好，合上盖子之后连上来才有画面。**镜像**内建的显示器：本机看不出来（只在开始时闪一下），
//!   显示器列表里也没有它（镜像的显示器不算，见 `macos::displays`），控制端照样只看到一个显示器。合上盖子时系统
//!   自己把它拿出镜像、当主显示器，窗口都在它上面；打开盖子又自己放回镜像。没放回去的（例如是合着盖子时才建的）
//!   这里放回去；
//! * **补屏**：一个能用的显示器都没有（没接显示器的 Mac mini；没来得及预备就合上了盖子）时也建一块，独立的。
//!   合盖之后才建的照上面说的采集不到画面，至少声音采集有显示器可挂；
//! * 能用的显示器：接着的（[`macos::online_display_ids`]，睡着的也算：叫醒就行），合着盖子时内建的不算；
//! * 虚拟显示器和最近看到的本机主显示器一样大、一样的缩放（HiDPI）和物理尺寸：镜像时内建的显示器分辨率不变，
//!   合上盖子之后控制端看到的画面大小、窗口和文字的大小也不变。一直是同一个身份（厂商、型号、序列号），
//!   macOS 记得窗口放在它上面的位置。样子直接读显示器的显示模式（[`shape_of`]：熄着屏的也读得到，`macos::displays`
//!   只列亮着的），记在进程里（[`SEEN`]，管理线程退出了也记着）；什么都没见过（合着盖子时才启动）就读合着的
//!   内建显示器的，还读不到才用 1080p。预备的读不到内建显示器的样子（没见过，兜底）也照样这么建：有画面（大小
//!   不对）总比合上盖子之后黑屏强；
//! * 建好之后不再改它：本机改了分辨率，它还是原来的大小（合上盖子之后控制端看到的也是），下次建的时候才照着新的。
//!   不撤掉重建：实测撤掉的那一刻系统把内建的显示器换回"只有它自己"时记着的分辨率（macOS 按接着哪些显示器分别记
//!   分辨率，镜像着它时本机改的只记在那一套里），本机刚改的分辨率就被改回去，开着"不自动睡眠"时等于改不了。也不
//!   原地换模式（`applySettings`）：在镜像里换过，内建的显示器会一直撕裂（实测）。同样的原因，撤掉它的时候
//!   （会话结束、用着电池、退出）镜像着它时本机改的分辨率会被系统换回去，和以前一样；
//! * 合上、打开盖子，主显示器换了：马上告诉会话，重新列出显示器；
//! * 有虚拟显示器的时候要着 `PreventSystemSleep`（[`power::keep_running`]）：接着外接电源时合着盖子也不睡眠
//!   （有会话期间本来就要着，见 `power`；这个管最后一个会话结束后等重连的那一会儿）；
//! * 最后一个会话结束后再留一会儿（等断线重连，见 `super::SESSION_LINGER`），之后撤掉（开着“不自动睡眠”时
//!   接着预备），没事可做时线程退出。进程退出时系统自己撤掉它，不用恢复什么。
//!
//! 本进程建的虚拟显示器在本进程里读不到显示模式（`CGDisplayCopyDisplayMode` 返回空，别的进程读得到），
//! 显示器列表里的像素大小用 [`pixels`]。
//!
//! 防窥模式（[`super::curtain`]）也由这里的管理线程打开、关掉：它不用虚拟显示器，但状态、什么时候开着
//! 和 Windows 一样由 `super` 管。

use std::ffi::{CStr, c_char, c_int, c_void};
use std::ptr::NonNull;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::{Result, bail};
use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayBounds, CGDisplayCopyDisplayMode, CGDisplayIsBuiltin,
    CGDisplayIsMain, CGDisplayMirrorsDisplay, CGDisplayMode, CGDisplayScreenSize, CGMainDisplayID,
};
use tracing::{info, warn};

use super::HUB;
use super::curtain::{self, Curtain};
use crate::host::{macos, power};

/// 有会话的时候多久看一次盖子、显示器、电源
const WATCH: Duration = Duration::from_millis(500);
/// 没有会话、只是预备着（开着"不自动睡眠"）时多久看一次：合盖时系统自己换到虚拟显示器上，不用赶
const WATCH_READY: Duration = Duration::from_secs(2);
/// 本机的显示器回来了这么久才撤掉虚拟显示器、打开盖子之后这么久还没回到镜像才自己放回去（开盖、合盖的过程中
/// 显示器会来回变）
const SETTLE: Duration = Duration::from_secs(2);
/// 多久看一次用的是不是外接电源
const AC_CHECK: Duration = Duration::from_secs(5);
/// 建不出来的话过这么久再试
const RETRY: Duration = Duration::from_secs(10);
/// 打开防窥之后、盖上黑窗口之前多久看一次（盖上了才算开着）
const STARTING: Duration = Duration::from_millis(100);
/// 打开防窥之后这么久黑窗口还没盖上（主线程没处理），就算没能打开
const COVER_WAIT: Duration = Duration::from_secs(5);
/// 虚拟显示器的刷新率档位：私有接口实测建得出来、也切得动（控制端的手动档就落在这几档里，见 [`wanted_hz`]）。
/// 屏上只注册当前这一档：合成节拍跟的是 `modes` 的第一个元素而不是当前选中的模式，一次注册多档时（不管切到
/// 哪一档）节拍都按最低那档走——实测注册 [30,60,90,120] 时 60/90/120 都只有 30 帧。换档走
/// [`VirtualDisplay::sync_refresh_rate`]，只替换模式、不重建屏
const HZ_RATES: [f64; 5] = [50.0, 60.0, 75.0, 90.0, 120.0];
/// 还没有控制端的设置在用时建屏用的刷新率（[`HzWant::default`] 的自动档算出来也是它）
const HZ: f64 = 60.0;
/// 自动档的刷新率不低于它：屏太慢，控制端操作起来一卡一卡的
const HZ_MIN: f64 = HZ_RATES[0];
/// 虚拟显示器的身份（"AH"、"vd"）：一直一样，macOS 按它记住排列和窗口的位置
const VENDOR: u32 = 0x4148;
const PRODUCT: u32 = 0x7664;
/// 测试建的用另一个序列号：同一个身份只能有一块（本机的 Airhand 正预备着时会被拒绝），也不动
/// macOS 给真的那块记着的排列
const SERIAL: u32 = if cfg!(test) { 0x7e57 } else { 1 };

unsafe extern "C" {
    fn ah_vd_supported() -> c_int;
    #[allow(clippy::too_many_arguments)]
    fn ah_vd_create(
        width: u32,
        height: u32,
        hidpi: c_int,
        hz: f64,
        mm_w: f64,
        mm_h: f64,
        vendor: u32,
        product: u32,
        serial: u32,
        name: *const c_char,
        display: *mut u32,
        error: *mut c_char,
        len: usize,
    ) -> *mut c_void;
    fn ah_vd_destroy(display: *mut c_void);
    fn ah_vd_set_refresh_rate(
        display: *mut c_void,
        width: u32,
        height: u32,
        hidpi: c_int,
        hz: f64,
        error: *mut c_char,
        len: usize,
    ) -> f64;
    fn ah_vd_mirror(display: u32, of: u32) -> i32;
}

/// 让 `id` 镜像 `of`（`of` 为 0：拿出镜像）。注意：tracing 的宏里 `display` 是它自己的函数名，参数不叫这个
fn mirror(id: CGDirectDisplayID, of: CGDirectDisplayID) {
    let r = unsafe { ah_vd_mirror(id, of) };
    if r == 0 {
        info!(id, of, "virtual display mirroring");
    } else {
        warn!(id, of, "can't mirror the virtual display: CGError {r}");
    }
}

/// 控制端要的虚拟显示器刷新率：手动档（1..=120）就用它，0（默认）是自动、跟着帧率走（不低于 [`HZ_MIN`]）。
/// 档位落在 [`HZ_RATES`] 里最近的一档上：屏上只有注册过的模式能换
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct HzWant {
    /// 控制端要的最大帧率（自动档跟着它）
    fps: u8,
    /// 控制端选的刷新率，0 是自动
    display_hz: u8,
}

impl Default for HzWant {
    fn default() -> Self {
        Self {
            fps: 60,
            display_hz: 0,
        }
    }
}

static HZ_WANT: Mutex<HzWant> = Mutex::new(HzWant {
    fps: 60,
    display_hz: 0,
});

/// 现在该用的刷新率
fn wanted_hz() -> f64 {
    let want = *HZ_WANT.lock().unwrap();
    let hz = if want.display_hz == 0 {
        f64::from(want.fps).clamp(HZ_MIN, *HZ_RATES.last().unwrap())
    } else {
        f64::from(want.display_hz).clamp(HZ_MIN, *HZ_RATES.last().unwrap())
    };
    nearest_hz(hz)
}

/// 注册过的档位里离 `hz` 最近的一档：只有注册过的模式能换，离得远也比没得换好
fn nearest_hz(hz: f64) -> f64 {
    HZ_RATES
        .iter()
        .copied()
        .min_by(|a, b| (a - hz).abs().total_cmp(&(b - hz).abs()))
        .unwrap_or(HZ)
}

/// 控制端的画质设置（见 `airhand_proto::session::QualitySettings`）：虚拟显示器的刷新率跟着它走，
/// 已经在补屏的那块下一轮就换（见 [`VirtualDisplay::sync_refresh_rate`]）
pub(super) fn set_quality(fps: u8, display_hz: u8) {
    let mut want = HZ_WANT.lock().unwrap();
    if *want != (HzWant { fps, display_hz }) {
        *want = HzWant { fps, display_hz };
        drop(want);
        // 叫醒管理线程：不用等下一次 WATCH
        HUB.wants.lock().unwrap().poke();
    }
}

/// 这个 macOS 上能建虚拟显示器
pub(super) fn usable() -> bool {
    unsafe { ah_vd_supported() != 0 }
}

/// 现在的虚拟显示器：编号、像素大小
static CURRENT: Mutex<Option<(CGDirectDisplayID, u32, u32)>> = Mutex::new(None);

/// 最近看到的本机主显示器的样子（见模块说明）：管理线程退出了也记着，合着盖子时再启动也照着它建
static SEEN: Mutex<Option<Shape>> = Mutex::new(None);

/// 本进程现在的虚拟显示器（防窥时不调黑、不盖它，见 [`super::curtain`]）
pub(super) fn current() -> Option<CGDirectDisplayID> {
    CURRENT.lock().unwrap().map(|c| c.0)
}

/// 本进程建的虚拟显示器的像素大小（见模块说明）；不是它时为 `None`
pub fn pixels(id: CGDirectDisplayID) -> Option<(u32, u32)> {
    CURRENT
        .lock()
        .unwrap()
        .filter(|c| c.0 == id)
        .map(|c| (c.1, c.2))
}

/// 虚拟显示器的样子
#[derive(Debug, Clone, Copy, PartialEq)]
struct Shape {
    /// HiDPI 时是点（帧缓冲是它的两倍），否则是像素
    width: u32,
    height: u32,
    hidpi: bool,
    /// 物理尺寸（毫米）：决定东西显示得多大
    mm: (f64, f64),
}

impl Default for Shape {
    /// 没见过本机的显示器（例如合着盖子启动、没接显示器的 Mac mini）：24 英寸的 1080p
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            hidpi: false,
            mm: (527.0, 296.0),
        }
    }
}

impl Shape {
    /// 和一块显示器一样：`points` 是它的大小（点），`pixels` 是像素，`mm` 是物理尺寸
    fn of(points: (f64, f64), pixels: (u32, u32), mm: (f64, f64)) -> Self {
        let even = |v: f64| ((v.round() as u32) & !1).max(2);
        let hidpi = points.0 > 0.0 && pixels.0 as f64 / points.0 >= 1.5;
        let (width, height) = if hidpi {
            (even(points.0), even(points.1))
        } else {
            (pixels.0 & !1, pixels.1 & !1)
        };
        // 读不出物理尺寸时按每英寸 110 像素（点）估
        let mm = if mm.0 > 10.0 && mm.1 > 10.0 {
            mm
        } else {
            let per_mm = 110.0 / 25.4;
            (width as f64 / per_mm, height as f64 / per_mm)
        };
        Self {
            width,
            height,
            hidpi,
            mm,
        }
    }

    /// 帧缓冲的像素大小
    fn pixels(&self) -> (u32, u32) {
        let k = if self.hidpi { 2 } else { 1 };
        (self.width * k, self.height * k)
    }
}

/// 本机的显示器 `id` 现在的样子。直接读它的显示模式：熄着屏（睡着）的也读得到，[`macos::displays`] 只列亮着的。
/// 本进程的虚拟显示器读不到（见模块说明）
fn shape_of(id: CGDirectDisplayID) -> Option<Shape> {
    let mode = CGDisplayCopyDisplayMode(id)?;
    let points = (
        CGDisplayMode::width(Some(&mode)) as f64,
        CGDisplayMode::height(Some(&mode)) as f64,
    );
    let pixels = (
        CGDisplayMode::pixel_width(Some(&mode)) as u32,
        CGDisplayMode::pixel_height(Some(&mode)) as u32,
    );
    if points.0 < 1.0 || points.1 < 1.0 || pixels.0 < 2 || pixels.1 < 2 {
        return None;
    }
    // 显示模式是没转过的：竖着放的显示器照它在桌面上的样子转过来
    let b = CGDisplayBounds(id).size;
    let portrait = if b.width > 0.0 && b.height > 0.0 {
        b.height > b.width
    } else {
        points.1 > points.0
    };
    let mm = CGDisplayScreenSize(id);
    Some(Shape::of(
        orient(points, portrait),
        orient(pixels, portrait),
        orient((mm.width, mm.height), portrait),
    ))
}

/// 横着、竖着和 `portrait` 一致
fn orient<T: PartialOrd>((w, h): (T, T), portrait: bool) -> (T, T) {
    if (h > w) != portrait { (h, w) } else { (w, h) }
}

/// 一块虚拟显示器，丢掉时系统撤掉它
struct VirtualDisplay {
    handle: NonNull<c_void>,
    id: CGDirectDisplayID,
    /// 点大小（换刷新率时按它找模式）
    size: (u32, u32),
    /// 是 hiDPI（帧缓冲是点大小的两倍）：换刷新率要按原样重建模式
    hidpi: bool,
    /// 现在的刷新率（Hz）
    hz: f64,
}

// 只是一个 Objective-C 对象的引用，在哪个线程上释放都行
unsafe impl Send for VirtualDisplay {}

impl VirtualDisplay {
    fn create(shape: Shape) -> Result<Self> {
        let mut id = 0;
        let mut error = [0 as c_char; 256];
        let hz = wanted_hz();
        let handle = unsafe {
            ah_vd_create(
                shape.width,
                shape.height,
                shape.hidpi as c_int,
                hz,
                shape.mm.0,
                shape.mm.1,
                VENDOR,
                PRODUCT,
                SERIAL,
                c"Airhand".as_ptr(),
                &mut id,
                error.as_mut_ptr(),
                error.len(),
            )
        };
        let Some(handle) = NonNull::new(handle) else {
            let msg = unsafe { CStr::from_ptr(error.as_ptr()) }.to_string_lossy();
            bail!("can't create the virtual display: {msg}");
        };
        let (pw, ph) = shape.pixels();
        *CURRENT.lock().unwrap() = Some((id, pw, ph));
        Ok(Self {
            handle,
            id,
            size: (shape.width, shape.height),
            hidpi: shape.hidpi,
            hz,
        })
    }

    /// 控制端改了刷新率（或者改了帧率，自动档跟着变）：换到该用的那一档，不用重建这块屏——把这档排到
    /// 注册模式的首位再 `applySettings`，其余档补回去（见 `mac.m` 的 `apply_modes`），displayID 不变。
    /// 系统设置 → 显示器 里能挑刷新率，靠的就是建屏时把 [`HZ_RATES`] 全注册上。
    ///
    /// 镜像着内建的显示器时不换：实测在镜像里换模式（`applySettings`）内建的显示器会一直撕裂，换模式
    /// （`CGConfigureDisplayWithDisplayMode`）走的是同一条显示器配置，冒不起这个险——开着盖子照着本机屏幕用的
    /// 时候就还按建屏时的那一档，合上盖子（不镜像了）之后自动跟上。
    fn sync_refresh_rate(&mut self) {
        let hz = wanted_hz();
        if (self.hz - hz).abs() < 0.5 {
            return;
        }
        if CGDisplayMirrorsDisplay(self.id) != 0 {
            info!(hz, "virtual display: leaving the refresh rate alone while it is mirrored");
            return;
        }
        let mut error = [0 as c_char; 128];
        let got = unsafe {
            ah_vd_set_refresh_rate(
                self.handle.as_ptr(),
                self.size.0,
                self.size.1,
                self.hidpi as c_int,
                hz,
                error.as_mut_ptr(),
                error.len(),
            )
        };
        if got < 0.0 {
            let msg = unsafe { CStr::from_ptr(error.as_ptr()) }.to_string_lossy();
            warn!(hz, "can't change the virtual display's refresh rate: {msg}");
            // 记下来不重试：省得每一轮都试一遍、刷屏
            self.hz = hz;
            return;
        }
        info!(hz = got, "virtual display refresh rate");
        self.hz = got;
    }
}

impl Drop for VirtualDisplay {
    fn drop(&mut self) {
        // 先不认它了，显示器列表里它的大小就照系统说的（它马上就没了）
        {
            let mut c = CURRENT.lock().unwrap();
            if c.is_some_and(|c| c.0 == self.id) {
                *c = None;
            }
        }
        unsafe { ah_vd_destroy(self.handle.as_ptr()) };
    }
}

/// 虚拟显示器（预备着，或者补着屏）
struct Filling {
    display: VirtualDisplay,
    _running: power::Running,
}

pub(super) fn spawn() {
    if let Err(e) = std::thread::Builder::new()
        .name("airhand-virtual-display".into())
        .spawn(run)
    {
        warn!("can't start the virtual display manager: {e}");
        HUB.wants.lock().unwrap().running = false;
    }
}

fn bump() {
    HUB.displays.send_modify(|g| *g = g.wrapping_add(1));
}

/// 接着的显示器里能用的（不算虚拟显示器 `ours`；合着盖子时不算内建的）
fn usable_displays(
    online: &[CGDirectDisplayID],
    ours: Option<CGDirectDisplayID>,
    lid: bool,
) -> Vec<CGDirectDisplayID> {
    online
        .iter()
        .copied()
        .filter(|&id| Some(id) != ours && !(lid && CGDisplayIsBuiltin(id)))
        .collect()
}

/// 防窥（见 [`super::curtain`]）：要开着就打开，不要了就关掉（恢复原样）；黑窗口盖上了才算开着
fn follow_privacy(curtain: &mut Option<(Curtain, Instant)>, wanted: bool, now: Instant) {
    if !wanted {
        *curtain = None;
    } else if curtain.is_none() {
        match Curtain::start() {
            Ok(c) => *curtain = Some((c, now)),
            Err(e) => super::fail(crate::host::capture::wire_detail(&e)),
        }
    }
    if let Some((c, since)) = curtain
        && !c.ready()
        && now.duration_since(*since) > COVER_WAIT
    {
        *curtain = None;
        super::fail("the black windows over the local displays didn't show up".into());
    }
    let on = curtain.as_ref().is_some_and(|(c, _)| c.ready());
    let mut w = HUB.wants.lock().unwrap();
    if w.on != on {
        w.on = on;
        if on {
            info!("privacy mode is on");
        }
    }
    super::publish(&w);
}

fn run() {
    info!("virtual display manager started");
    // 这个 macOS 上建不建得了虚拟显示器（建不了的话这个线程只管防窥）
    let can_create = usable();
    let mut curtain: Option<(Curtain, Instant)> = None;
    let mut filling: Option<Filling> = None;
    // 本机能用的显示器从什么时候起一直在
    let mut usable_since: Option<Instant> = None;
    let mut retry_at: Option<Instant> = None;
    // 上一轮的盖子、主显示器：变了就告诉会话
    let mut last_layout: Option<(bool, CGDirectDisplayID)> = None;
    let mut ac = (true, None::<Instant>);
    // 预备着的虚拟显示器从什么时候起没在镜像（开着盖子时）
    let mut unmirrored_since: Option<Instant> = None;
    loop {
        let now = Instant::now();
        let (sessions, ready, stopping, privacy) = {
            let mut w = HUB.wants.lock().unwrap();
            // "辅助功能"权限可能在会话中途给了、收回了
            let can = curtain::usable();
            if w.curtain != can {
                w.curtain = can;
                super::publish(&w);
            }
            let privacy = w.privacy(now) && !w.stopping;
            (w.sessions(now), w.ready, w.stopping, privacy)
        };
        follow_privacy(&mut curtain, privacy, now);
        // 控制端改了刷新率、改了帧率：已经在补屏的那块跟着换（不重建，见 VirtualDisplay::sync_refresh_rate）
        if let Some(f) = &mut filling {
            f.display.sync_refresh_rate();
        }
        let ours = filling.as_ref().map(|f| f.display.id);
        let lid_state = macos::lid_state();
        let lid = lid_state == Some(true);
        // 合上、打开盖子：系统把主显示器换成了虚拟显示器、又换回来了，会话马上重新列出显示器
        let layout = (lid, CGMainDisplayID());
        if last_layout.is_some_and(|l| l != layout) {
            bump();
        }
        last_layout = Some(layout);
        if ac.1.is_none_or(|t| now.duration_since(t) >= AC_CHECK) {
            ac = (power::on_ac(), Some(now));
        }
        let online = macos::online_display_ids();
        // 系统把它撤掉了（例如 WindowServer 重启）：重新建
        if let Some(id) = ours
            && !online.contains(&id)
        {
            warn!(id, "the virtual display went away");
            filling = None;
            bump();
        }
        let ours = filling.as_ref().map(|f| f.display.id);
        let usable = usable_displays(&online, ours, lid);
        let builtin = online
            .iter()
            .copied()
            .find(|&id| Some(id) != ours && CGDisplayIsBuiltin(id));
        let external = online
            .iter()
            .any(|&id| Some(id) != ours && !CGDisplayIsBuiltin(id));
        // 预备（见模块说明）：开着盖子的笔记本、接着电源、没接别的显示器
        let standby = match builtin {
            Some(b) if lid_state == Some(false) && ac.0 && !external => Some(b),
            _ => None,
        };
        let fill = usable.is_empty();
        // 本机的主显示器（不是主显示器的话随便一块能用的）的样子：虚拟显示器照着它建。都读不到（合着盖子）时照着
        // 最近看到的；什么都没见过的话读合着的内建显示器的，还读不到才是 1080p（见模块说明）
        let main = usable.iter().copied().find(|&id| CGDisplayIsMain(id));
        let seen = main
            .into_iter()
            .chain(usable.iter().copied())
            .find_map(shape_of);
        let shape = {
            let mut last = SEEN.lock().unwrap();
            if seen.is_some() {
                *last = seen;
            }
            last.or_else(|| builtin.and_then(shape_of))
                .unwrap_or_default()
        };
        if fill {
            usable_since = None;
        } else {
            usable_since.get_or_insert(now);
        }
        if standby.is_none() {
            unmirrored_since = None;
        }
        // 有会话：预备、补屏；只是开着"不自动睡眠"：预备，合上盖子之后留着系统换上去的那块（合盖之后再建的没有画面，
        // 不建）
        // 合上盖子时 lid 直接参与判断：此时系统会自己换上一块没内容的占位屏（unkn/virt/serial=0）算进 usable 让
        // fill=false，两条件都不成立就会把自建屏撤掉，Clamshell Sleep 随即生效、只剩那块占位屏可采，画面全黑。
        // 所以合盖时无论如何都留着自建屏（万一把它撤了，宁可先不建新的也不撤旧的）
        let wanted = can_create
            && !stopping
            && ((sessions && (fill || standby.is_some() || lid))
                || (ready && (standby.is_some() || lid || (fill && filling.is_some()))));
        match (&filling, wanted) {
            // 照着现在看到的本机显示器建；读不到的话（没见过这样的，兜底）照着最近看到的，什么都没见过才是 1080p：
            // 有画面总比合上盖子之后黑屏强（见模块说明）
            (None, true) if retry_at.is_none_or(|t| now >= t) => {
                match VirtualDisplay::create(shape) {
                    // 注意：tracing 的宏里 `display` 是它自己的函数名，变量换个名字
                    Ok(vd) => {
                        let (w, h) = shape.pixels();
                        info!(
                            id = vd.id,
                            w,
                            h,
                            hidpi = shape.hidpi,
                            // 照着现在看到的本机显示器（不是的话是最近看到的、1080p）
                            seen = seen.is_some(),
                            lid_closed = lid,
                            standby = standby.is_some(),
                            "virtual display created"
                        );
                        // 预备着：镜像内建的显示器，本机、控制端都看不出来（见模块说明）
                        if let Some(b) = standby {
                            mirror(vd.id, b);
                        }
                        filling = Some(Filling {
                            display: vd,
                            _running: power::keep_running(),
                        });
                        retry_at = None;
                        bump();
                    }
                    Err(e) => {
                        warn!("{e:#}");
                        retry_at = Some(now + RETRY);
                    }
                }
            }
            (Some(_), false) => {
                // 本机的显示器回来了（又不用预备，例如用着电池、接上了显示器）：等它稳定了再撤；
                // 会话都结束了（也等过了重连）、要退出了：马上撤
                let settled = usable_since.is_some_and(|t| now.duration_since(t) >= SETTLE);
                if stopping || !(sessions || ready) || settled {
                    info!("removing the virtual display");
                    filling = None;
                    bump();
                }
            }
            // 开着盖子预备着，它却没在镜像（打开盖子时系统一般自己放回去；合着盖子时才建的就没有）：过一会儿放回去
            (Some(f), true) => match standby {
                Some(b) if CGDisplayMirrorsDisplay(f.display.id) == 0 => {
                    let since = *unmirrored_since.get_or_insert(now);
                    if now.duration_since(since) >= SETTLE {
                        mirror(f.display.id, b);
                        unmirrored_since = None;
                        bump();
                    }
                }
                _ => unmirrored_since = None,
            },
            _ => {}
        }
        if filling.is_none() && curtain.is_none() {
            // 没事可做了：退出（下一个会话加入、打开"不自动睡眠"时再启动）。台式机上预备不用管。
            // 在锁里看，免得和 join、set_ready、打开防窥错过
            let mut w = HUB.wants.lock().unwrap();
            let laptop = lid_state.is_some() && can_create;
            let now = Instant::now();
            if w.stopping || (!w.sessions(now) && !w.privacy(now) && !(w.ready && laptop)) {
                w.running = false;
                w.on = false;
                super::publish(&w);
                HUB.wake.notify_all();
                break;
            }
        }
        let starting = curtain.as_ref().is_some_and(|(c, _)| !c.ready());
        wait(if starting {
            STARTING
        } else if sessions || curtain.is_some() {
            WATCH
        } else {
            WATCH_READY
        });
    }
    info!("virtual display manager stopped");
}

/// 等 `period`，有人叫醒（会话加入、离开，要退出了）就提前回来
fn wait(period: Duration) {
    let mut w = HUB.wants.lock().unwrap();
    if !w.poked && !w.stopping {
        w = HUB
            .wake
            .wait_timeout_while(w, period, |w| !w.poked && !w.stopping)
            .unwrap()
            .0;
    }
    w.poked = false;
}

#[cfg(test)]
mod hz_tests {
    use super::*;

    #[test]
    fn the_refresh_rate_lands_on_a_registered_step() {
        assert_eq!(nearest_hz(120.0), 120.0);
        assert_eq!(nearest_hz(144.0), 120.0);
        assert_eq!(nearest_hz(75.0), 75.0);
        assert_eq!(nearest_hz(15.0), 50.0);
        assert_eq!(nearest_hz(70.0), 75.0);
        // 自动档跟着帧率走，不低于 50
        *HZ_WANT.lock().unwrap() = HzWant {
            fps: 120,
            display_hz: 0,
        };
        assert_eq!(wanted_hz(), 120.0);
        *HZ_WANT.lock().unwrap() = HzWant {
            fps: 15,
            display_hz: 0,
        };
        assert_eq!(wanted_hz(), 50.0);
        // 手动档就用它
        *HZ_WANT.lock().unwrap() = HzWant {
            fps: 15,
            display_hz: 90,
        };
        assert_eq!(wanted_hz(), 90.0);
        *HZ_WANT.lock().unwrap() = HzWant::default();
        assert_eq!(wanted_hz(), HZ);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 真建虚拟显示器的测试一个一个来：同一个身份同时建两块会失败
    static HARDWARE: Mutex<()> = Mutex::new(());

    /// 照着本机的显示器：Retina 屏用 HiDPI（点），普通屏用像素；读不出物理尺寸时按 110 PPI 估
    #[test]
    fn shape_follows_the_local_display() {
        let retina = Shape::of((1440.0, 900.0), (2880, 1800), (286.9, 179.3));
        assert_eq!(
            retina,
            Shape {
                width: 1440,
                height: 900,
                hidpi: true,
                mm: (286.9, 179.3)
            }
        );
        assert_eq!(retina.pixels(), (2880, 1800));
        let plain = Shape::of((1920.0, 1080.0), (1920, 1080), (0.0, 0.0));
        assert!(!plain.hidpi);
        assert_eq!(plain.pixels(), (1920, 1080));
        assert!((plain.mm.0 - 443.3).abs() < 0.1, "{:?}", plain.mm);
        // 缩放过的 Retina 屏（"看起来像" 1470x956）
        let scaled = Shape::of((1470.0, 956.0), (2940, 1912), (300.0, 195.0));
        assert_eq!(
            (scaled.width, scaled.height, scaled.hidpi),
            (1470, 956, true)
        );
        // 竖着放的：显示模式是横着的，照桌面上的样子转过来
        assert_eq!(orient((2560u32, 1440u32), true), (1440, 2560));
        assert_eq!(orient((1440.0, 2560.0), true), (1440.0, 2560.0));
        assert_eq!(orient((286.0, 179.0), false), (286.0, 179.0));
    }

    /// 直接读显示模式（熄着屏的也读得到）：亮着的显示器读出来和显示器列表里的一样
    #[test]
    fn reads_shapes_like_the_display_list() {
        for d in macos::displays() {
            // 本进程的虚拟显示器读不到显示模式；转过的显示器列表里的像素没转
            if pixels(d.id).is_some() || objc2_core_graphics::CGDisplayRotation(d.id) != 0.0 {
                continue;
            }
            let mm = CGDisplayScreenSize(d.id);
            let listed = Shape::of(
                (d.points_w, d.points_h),
                (d.width, d.height),
                (mm.width, mm.height),
            );
            assert_eq!(shape_of(d.id), Some(listed), "{d:?}");
        }
    }

    /// 合着盖子时内建的显示器不算；补屏的虚拟显示器自己也不算
    #[test]
    fn closed_lid_hides_the_built_in_display() {
        let online = macos::online_display_ids();
        let builtin: Vec<_> = online
            .iter()
            .copied()
            .filter(|&id| CGDisplayIsBuiltin(id))
            .collect();
        assert_eq!(usable_displays(&online, None, false), online);
        let closed = usable_displays(&online, None, true);
        assert!(closed.iter().all(|id| !builtin.contains(id)));
        if let Some(&first) = online.first() {
            assert!(!usable_displays(&online, Some(first), false).contains(&first));
        }
    }

    /// 建一块虚拟显示器，看它出现在显示器列表里、大小对；丢掉之后没了。会在本机多出一块显示器（2 秒）。
    /// `cargo test --lib creates_a_virtual_display -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn creates_a_virtual_display() {
        let _one = HARDWARE.lock().unwrap_or_else(|e| e.into_inner());
        assert!(usable(), "这个 macOS 上建不了虚拟显示器");
        let shape = Shape {
            width: 1280,
            height: 800,
            hidpi: true,
            mm: (286.0, 179.0),
        };
        let vd = VirtualDisplay::create(shape).expect("建虚拟显示器");
        let id = vd.id;
        std::thread::sleep(Duration::from_millis(500));
        let listed = macos::displays().into_iter().find(|d| d.id == id);
        println!("{listed:#?}");
        let d = listed.expect("虚拟显示器不在列表里");
        assert_eq!((d.width, d.height), (2560, 1600));
        assert_eq!((d.points_w, d.points_h), (1280.0, 800.0));
        assert!(macos::online_display_ids().contains(&id));
        std::thread::sleep(Duration::from_millis(1500));
        drop(vd);
        std::thread::sleep(Duration::from_millis(500));
        assert!(!macos::online_display_ids().contains(&id), "丢掉之后还在");
        assert_eq!(pixels(id), None);
    }

    /// 换刷新率不用重建屏：同一块屏逐档切过去，读回都是那一档，displayID 也不变。
    /// `cargo test --lib changes_the_refresh_rate_in_place -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn changes_the_refresh_rate_in_place() {
        let _one = HARDWARE.lock().unwrap_or_else(|e| e.into_inner());
        assert!(usable(), "这个 macOS 上建不了虚拟显示器");
        let shape = Shape {
            width: 1280,
            height: 800,
            hidpi: true,
            mm: (286.0, 179.0),
        };
        let mut vd = VirtualDisplay::create(shape).expect("建虚拟显示器");
        let id = vd.id;
        std::thread::sleep(Duration::from_millis(300));
        for hz in [120u8, 75, 50, 90, 60] {
            *HZ_WANT.lock().unwrap() = HzWant {
                fps: 60,
                display_hz: hz,
            };
            vd.sync_refresh_rate();
            println!("要 {hz} Hz，现在是 {} Hz，displayID 还是 {}", vd.hz, vd.id);
            assert_eq!(vd.id, id, "换刷新率不该换掉这块屏");
            assert!(
                (vd.hz - f64::from(hz)).abs() < 0.5,
                "{hz} Hz 没切过去，还是 {} Hz",
                vd.hz
            );
            std::thread::sleep(Duration::from_millis(300));
        }
        *HZ_WANT.lock().unwrap() = HzWant::default();
        std::thread::sleep(Duration::from_millis(300));
    }

    /// 预备：照着内建的显示器建一块，镜像它；显示器列表里看不到它，内建的显示器大小不变。本机屏幕会闪一下。
    /// `cargo test --lib mirrors_the_built_in_display -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn mirrors_the_built_in_display() {
        let _one = HARDWARE.lock().unwrap_or_else(|e| e.into_inner());
        let Some(builtin) = macos::online_display_ids()
            .into_iter()
            .find(|&id| CGDisplayIsBuiltin(id))
        else {
            println!("没有内建的显示器");
            return;
        };
        let before = macos::displays();
        let vd = VirtualDisplay::create(shape_of(builtin).expect("内建的显示器的样子"))
            .expect("建虚拟显示器");
        mirror(vd.id, builtin);
        std::thread::sleep(Duration::from_millis(1000));
        assert_eq!(CGDisplayMirrorsDisplay(vd.id), builtin);
        let during = macos::displays();
        println!("{during:#?}");
        assert_eq!(during, before, "镜像时显示器列表、内建显示器的大小都不该变");
        drop(vd);
        std::thread::sleep(Duration::from_millis(500));
    }
}
