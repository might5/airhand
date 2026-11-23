//! 显示设置（Windows 的 CCD：`QueryDisplayConfig` / `SetDisplayConfig`）：哪些显示器是虚拟的、哪些在桌面上，
//! 只留虚拟显示器（防窥），按 Windows 记着的设置恢复。
//!
//! * 认虚拟显示器靠显卡：虚拟显示器的"显卡"就是 Airhand 建的那个设备，它的设备路径里有设备的实例 ID
//!   （`\\?\ROOT#AIRHANDVIRTUALDISPLAY#0000#{...}`）；
//! * 改设置一律不存进 Windows 的显示设置数据库（不带 `SDC_SAVE_TO_DATABASE`）：Windows 按"接着哪些显示器"记着
//!   各自的设置，存进去的话，下次接着同样的显示器时它自己就会套用"本机的显示器不在桌面上"——开机就黑屏。
//!   恢复时用的正是这个数据库（`SDC_USE_DATABASE_CURRENT`）；
//! * 要在控制台会话、当前的输入桌面上调用（调用的线程先 `desktop::follow`）。

use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result, ensure};
use windows::Win32::Devices::Display::*;
use windows::Win32::Foundation::{ERROR_INSUFFICIENT_BUFFER, LUID, POINTL};
use windows::Win32::Graphics::Gdi::{
    CDS_TYPE, ChangeDisplaySettingsExW, DEVMODEW, DISP_CHANGE_SUCCESSFUL,
    DISPLAYCONFIG_PATH_ACTIVE, DISPLAYCONFIG_PATH_MODE_IDX_INVALID, DM_DISPLAYFREQUENCY,
    DM_PELSHEIGHT, DM_PELSWIDTH,
};
use windows::core::HSTRING;

use super::Mode;
use super::device::INSTANCE;
use super::plan::{Facts, Target};

struct Config {
    paths: Vec<DISPLAYCONFIG_PATH_INFO>,
    modes: Vec<DISPLAYCONFIG_MODE_INFO>,
}

fn query(flags: QUERY_DISPLAY_CONFIG_FLAGS) -> Result<Config> {
    loop {
        let (mut np, mut nm) = (0u32, 0u32);
        unsafe { GetDisplayConfigBufferSizes(flags, &mut np, &mut nm) }
            .ok()
            .context("GetDisplayConfigBufferSizes")?;
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); np as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); nm as usize];
        let r = unsafe {
            QueryDisplayConfig(
                flags,
                &mut np,
                paths.as_mut_ptr(),
                &mut nm,
                modes.as_mut_ptr(),
                None,
            )
        };
        // 两次调用之间显示器变了：重新问大小
        if r == ERROR_INSUFFICIENT_BUFFER {
            continue;
        }
        r.ok().context("QueryDisplayConfig")?;
        paths.truncate(np as usize);
        modes.truncate(nm as usize);
        return Ok(Config { paths, modes });
    }
}

fn luid_key(l: LUID) -> i64 {
    ((l.HighPart as i64) << 32) | l.LowPart as i64
}

fn wide_str(w: &[u16]) -> String {
    let len = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..len])
}

/// 显卡的设备路径
fn adapter_path(adapter: LUID) -> Option<String> {
    let mut name = DISPLAYCONFIG_ADAPTER_NAME::default();
    name.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_ADAPTER_NAME;
    name.header.size = size_of::<DISPLAYCONFIG_ADAPTER_NAME>() as u32;
    name.header.adapterId = adapter;
    let r = unsafe { DisplayConfigGetDeviceInfo(&mut name.header) };
    (r == 0).then(|| wide_str(&name.adapterDevicePath))
}

/// 输出（源）在 GDI 里的名字，例如 `\\.\DISPLAY5`
fn source_name(adapter: LUID, id: u32) -> Option<String> {
    let mut name = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
    name.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
    name.header.size = size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
    name.header.adapterId = adapter;
    name.header.id = id;
    let r = unsafe { DisplayConfigGetDeviceInfo(&mut name.header) };
    (r == 0).then(|| wide_str(&name.viewGdiDeviceName))
}

/// 认得出哪些显卡是虚拟显示器的（按 LUID 记着，一次查询里不重复问）
#[derive(Default)]
struct Adapters(HashMap<i64, bool>);

impl Adapters {
    fn is_virtual(&mut self, adapter: LUID) -> bool {
        *self.0.entry(luid_key(adapter)).or_insert_with(|| {
            let ours = INSTANCE.replace('\\', "#");
            adapter_path(adapter).is_some_and(|p| p.to_uppercase().contains(&ours))
        })
    }
}

fn active(p: &DISPLAYCONFIG_PATH_INFO) -> bool {
    p.flags & DISPLAYCONFIG_PATH_ACTIVE != 0
}

fn target(p: &DISPLAYCONFIG_PATH_INFO) -> Target {
    (luid_key(p.targetInfo.adapterId), p.targetInfo.id)
}

fn source(p: &DISPLAYCONFIG_PATH_INFO) -> Target {
    (luid_key(p.sourceInfo.adapterId), p.sourceInfo.id)
}

fn source_mode_idx(p: &DISPLAYCONFIG_PATH_INFO) -> u32 {
    // 不带 QDC_VIRTUAL_MODE_AWARE 查询的：联合体里是 modeInfoIdx
    unsafe { p.sourceInfo.Anonymous.modeInfoIdx }
}

fn source_mode(cfg: &Config, p: &DISPLAYCONFIG_PATH_INFO) -> Option<DISPLAYCONFIG_SOURCE_MODE> {
    let m = cfg.modes.get(source_mode_idx(p) as usize)?;
    if m.infoType != DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE {
        return None;
    }
    Some(unsafe { m.Anonymous.sourceMode })
}

/// 现在的样子（`enabled`：设备启用着没有，见 `super::device::enabled`）
pub(super) fn facts(enabled: bool) -> Result<Facts> {
    let cfg = query(QDC_ALL_PATHS)?;
    let mut adapters = Adapters::default();
    let mut f = Facts {
        enabled,
        ..Facts::default()
    };
    for p in &cfg.paths {
        let available = p.targetInfo.targetAvailable.as_bool();
        if adapters.is_virtual(p.targetInfo.adapterId) {
            f.virtual_connected |= available;
            f.virtual_active |= active(p);
        } else {
            f.physical_active |= active(p);
            if available {
                f.physical_connected.push(target(p));
            }
        }
    }
    f.physical_connected.sort_unstable();
    f.physical_connected.dedup();
    Ok(f)
}

/// 本机的主显示器现在的分辨率和刷新率（不在桌面上时为 `None`）：虚拟显示器用一样的，控制端看到的画面大小不变
pub(super) fn primary_mode() -> Option<Mode> {
    let cfg = query(QDC_ONLY_ACTIVE_PATHS).ok()?;
    let mut adapters = Adapters::default();
    cfg.paths.iter().find_map(|p| {
        if !active(p) || adapters.is_virtual(p.targetInfo.adapterId) {
            return None;
        }
        let m = source_mode(&cfg, p)?;
        if (m.position.x, m.position.y) != (0, 0) {
            return None;
        }
        let r = p.targetInfo.refreshRate;
        let hz = if r.Denominator > 0 {
            (r.Numerator as f64 / r.Denominator as f64).round() as u32
        } else {
            60
        };
        Some(Mode {
            width: m.width,
            height: m.height,
            hz,
        })
    })
}

/// 只留虚拟显示器在桌面上（防窥）：它已经在桌面上的接着用，不在的接上一个空着的输出，本机的显示器都撤下；
/// 虚拟显示器从 (0, 0) 起往右排，第一个是主显示器。新接上的输出不指定分辨率，由 Windows 选（驱动的首选）
pub(super) fn isolate() -> Result<()> {
    let cfg = query(QDC_ALL_PATHS)?;
    let mut adapters = Adapters::default();
    let mut chosen: Vec<DISPLAYCONFIG_PATH_INFO> = Vec::new();
    let mut sources: HashSet<Target> = HashSet::new();
    let mut targets: HashSet<Target> = HashSet::new();
    for p in &cfg.paths {
        if active(p) && adapters.is_virtual(p.targetInfo.adapterId) {
            sources.insert(source(p));
            targets.insert(target(p));
            chosen.push(*p);
        }
    }
    for p in &cfg.paths {
        if active(p)
            || !p.targetInfo.targetAvailable.as_bool()
            || !adapters.is_virtual(p.targetInfo.adapterId)
            || targets.contains(&target(p))
            || sources.contains(&source(p))
        {
            continue;
        }
        let mut q = *p;
        q.flags |= DISPLAYCONFIG_PATH_ACTIVE;
        q.sourceInfo.Anonymous.modeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID;
        q.targetInfo.Anonymous.modeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID;
        sources.insert(source(&q));
        targets.insert(target(&q));
        chosen.push(q);
    }
    ensure!(!chosen.is_empty(), "the virtual display isn't connected");
    // 只带上留下的这几条用到的模式（编号重排）
    let mut modes: Vec<DISPLAYCONFIG_MODE_INFO> = Vec::new();
    let mut x = 0i32;
    for q in &mut chosen {
        unsafe {
            for idx in [
                &mut q.sourceInfo.Anonymous.modeInfoIdx,
                &mut q.targetInfo.Anonymous.modeInfoIdx,
            ] {
                if *idx == DISPLAYCONFIG_PATH_MODE_IDX_INVALID {
                    continue;
                }
                let Some(m) = cfg.modes.get(*idx as usize) else {
                    *idx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID;
                    continue;
                };
                let mut m = *m;
                if m.infoType == DISPLAYCONFIG_MODE_INFO_TYPE_SOURCE {
                    m.Anonymous.sourceMode.position = POINTL { x, y: 0 };
                    x += m.Anonymous.sourceMode.width as i32;
                }
                *idx = modes.len() as u32;
                modes.push(m);
            }
        }
    }
    let r = unsafe {
        SetDisplayConfig(
            Some(&chosen),
            (!modes.is_empty()).then_some(modes.as_slice()),
            SDC_APPLY | SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_ALLOW_CHANGES,
        )
    };
    if r == 0 {
        return Ok(());
    }
    // 退一步：只给路径（哪些显示器在桌面上），模式由 Windows 按它记着的或者首选的定
    for q in &mut chosen {
        q.sourceInfo.Anonymous.modeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID;
        q.targetInfo.Anonymous.modeInfoIdx = DISPLAYCONFIG_PATH_MODE_IDX_INVALID;
    }
    let again = unsafe {
        SetDisplayConfig(
            Some(&chosen),
            None,
            SDC_APPLY | SDC_TOPOLOGY_SUPPLIED | SDC_ALLOW_PATH_ORDER_CHANGES,
        )
    };
    ensure!(again == 0, "SetDisplayConfig failed ({r}, then {again})");
    Ok(())
}

/// 按 Windows 记着的设置（接着的这几个显示器上次的样子）恢复：防窥结束、意外退出之后
pub(super) fn restore() -> Result<()> {
    let r = unsafe { SetDisplayConfig(None, None, SDC_APPLY | SDC_USE_DATABASE_CURRENT) };
    ensure!(
        r == 0,
        "SetDisplayConfig(SDC_USE_DATABASE_CURRENT) failed ({r})"
    );
    Ok(())
}

/// 桌面上的第一个虚拟显示器：GDI 名字和现在的大小
fn virtual_source() -> Option<(String, u32, u32)> {
    let cfg = query(QDC_ONLY_ACTIVE_PATHS).ok()?;
    let mut adapters = Adapters::default();
    cfg.paths.iter().find_map(|p| {
        if !active(p) || !adapters.is_virtual(p.targetInfo.adapterId) {
            return None;
        }
        let m = source_mode(&cfg, p)?;
        let name = source_name(p.sourceInfo.adapterId, p.sourceInfo.id)?;
        Some((name, m.width, m.height))
    })
}

/// 桌面上的虚拟显示器换成 `mode`（大小不一样的话）。只改这一次（不存进注册表）：下次启用时驱动的首选就是它
/// （见 `super::device::write_settings`），这里只是防 Windows 套用以前记着的分辨率。
/// 返回有没有虚拟显示器在桌面上（没有就是还不用改）
pub(super) fn apply_mode(mode: Mode) -> Result<bool> {
    let Some((name, w, h)) = virtual_source() else {
        return Ok(false);
    };
    if (w, h) == (mode.width, mode.height) {
        return Ok(true);
    }
    let mut dm = DEVMODEW {
        dmSize: size_of::<DEVMODEW>() as u16,
        dmPelsWidth: mode.width,
        dmPelsHeight: mode.height,
        dmDisplayFrequency: mode.hz,
        dmFields: DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY,
        ..Default::default()
    };
    let name = HSTRING::from(name);
    let mut r = unsafe { ChangeDisplaySettingsExW(&name, Some(&dm), None, CDS_TYPE(0), None) };
    if r != DISP_CHANGE_SUCCESSFUL {
        // 驱动没有这个刷新率：只改大小
        dm.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT;
        r = unsafe { ChangeDisplaySettingsExW(&name, Some(&dm), None, CDS_TYPE(0), None) };
    }
    ensure!(
        r == DISP_CHANGE_SUCCESSFUL,
        "can't set the virtual display to {}x{} ({})",
        mode.width,
        mode.height,
        r.0
    );
    Ok(true)
}

#[cfg(test)]
mod tests {
    /// 只读：列出现在的显示器、哪些是虚拟的（`cargo test --lib list_displays -- --ignored --nocapture`）
    #[test]
    #[ignore]
    fn list_displays() {
        let f = super::facts(false).unwrap();
        println!("{f:#?}");
        println!("primary: {:?}", super::primary_mode());
    }
}
