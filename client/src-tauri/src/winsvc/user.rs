//! Windows 仅为当前用户安装（安装程序里选"仅为我安装"，不需要管理员权限）。
//!
//! 没有系统服务：被控端和调试构建直接运行时一样，在托盘进程里、以登录的用户的身份运行。所以锁屏、登录界面和
//! UAC 确认框不能控制（它们在安全桌面上，见 `host::desktop`），以管理员身份运行的窗口只能看、不能操作（UIPI），
//! 登录之后 Airhand 才会运行。
//!
//! * 安装包复制完文件后运行 `airhand.exe --install-user`：在 `HKCU\Software\Airhand` 里记下这个 airhand.exe 的位置
//!   （启动时据此认出自己是装好的，见 [`installed_here`]；没有安装的 airhand.exe 不能运行），按 config.toml 设置登录时自动启动；
//! * 登录时自动启动（`config.toml` 的 `autostart`，托盘里可以切换）= `HKCU\...\Run` 里的 `Airhand`。
//!   在任务管理器的"启动应用"里禁用过它的话，托盘里打开时一并恢复（[`choose_autostart`]）；
//! * 升级（`--stop`）、卸载（`--uninstall`）和为所有用户安装时共用，见 [`super`]；卸载时删除上面两项（[`unregister`]）；
//! * config.toml 和为所有用户安装时一样在程序旁边：安装目录在用户自己的目录里，托盘直接读写
//!   （安装包不让仅为当前用户安装的 Airhand 装进 Program Files 和 Windows 文件夹）；
//! * 一台电脑上只该有一份 Airhand 在运行被控端。安装包按已有的安装升级，不会让同一个用户两种方式都装上；
//!   但别的用户可能还会为所有用户安装：看到有 Airhand 服务时这一份就不再运行（[`step_aside`]）。

use std::path::Path;

use anyhow::{Context, Result};
use tracing::{info, warn};
use windows::core::{HSTRING, w};
use winreg::RegKey;
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};

use super::{RUN_KEY, SERVICE_NAME};

/// 记下安装位置的注册表项（`HKCU` 下）和值。安装包（`windows/hooks.nsh`）也用到它们。
/// 注册表的键名不分大小写：这个键也是 Tauri 安装包的 `Software\airhand`（它在里面记安装位置和语言），
/// 所以只增删自己的值，不动整个键
const KEY: &str = r"Software\Airhand";
const VALUE: &str = "UserInstall";

/// 这个 airhand.exe 是不是仅为当前用户安装好的（安装包运行 `--install-user` 时记下了它的位置）。
/// 是的话没有系统服务，被控端在托盘进程里运行
pub fn installed_here() -> bool {
    match (recorded(), std::env::current_exe()) {
        (Ok(Some(path)), Ok(me)) => super::same_file(&path, &me),
        (Ok(None), _) => false,
        (Err(e), _) => {
            warn!("can't read the per-user installation: {e:#}");
            false
        }
        (_, Err(e)) => {
            warn!("can't find this program's path: {e}");
            false
        }
    }
}

/// 记下的仅为当前用户安装的 airhand.exe 的位置
fn recorded() -> Result<Option<std::path::PathBuf>> {
    let value = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(KEY)
        .and_then(|k| k.get_value::<String, _>(VALUE));
    match value {
        Ok(path) => Ok(Some(path.into())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).context("reading the registry"),
    }
}

/// `--install-user`：记下安装位置，按 config.toml 设置登录时自动启动。安装包在复制完文件后调用
/// （选了"仅为我安装"的管理员运行安装程序时是提升了权限的，HKCU 仍是这个用户的）
pub(super) fn install() -> Result<()> {
    let exe = std::env::current_exe()?;
    crate::config::ensure_file().context("can't create config.toml")?;
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(KEY)
        .context("can't create the registry key")?;
    key.set_value(VALUE, &exe.as_os_str())
        .context("can't record the installation")?;
    // 自动启动设不上不算安装失败：Airhand 照样能用，托盘里还可以再切换，下次启动时也会按配置文件再设一次
    let autostart = crate::config::settings().autostart;
    if let Err(e) = apply_autostart(autostart) {
        warn!("can't apply the autostart setting: {e:#}");
    }
    info!(
        "Airhand is installed for this user ({}, autostart {})",
        exe.display(),
        if autostart { "on" } else { "off" }
    );
    Ok(())
}

/// `--uninstall` 的一部分：记下的安装位置是这个 airhand.exe（或者记下的程序已经不在了）的话，删除记录和登录时启动项。
/// 只删自己的值：键是和 Tauri 安装包共用的
pub(super) fn unregister() -> Result<()> {
    let Some(path) = recorded()? else {
        return Ok(());
    };
    if path.exists() && !super::same_file(&path, &std::env::current_exe()?) {
        return Ok(());
    }
    apply_autostart(false)?;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags(KEY, KEY_READ | KEY_SET_VALUE)
        .context("opening the registry key")?;
    key.delete_value(VALUE)
        .context("can't delete the recorded installation")?;
    // 键里没有别的东西了（Tauri 的记录已经删了，或者从来没有），也删掉
    if key.enum_keys().next().is_none() && key.enum_values().next().is_none() {
        drop(key);
        let _ = hkcu.delete_subkey(KEY);
    }
    info!("removed the per-user installation");
    Ok(())
}

/// 用户在托盘菜单里切换登录时自动启动：同 [`apply_autostart`]，打开时还删掉任务管理器里"已禁用"的记录
/// （见 [`super::STARTUP_APPROVED_KEY`]）：用户明确要打开，Run 项不能还被它挡着。
/// 启动时按 config.toml 同步（[`apply_autostart`]）不删：在任务管理器里禁用是用户的选择
pub fn choose_autostart(on: bool) -> Result<()> {
    apply_autostart(on)?;
    if on
        && let Err(e) =
            super::forget_startup_disabled(windows::Win32::System::Registry::HKEY_CURRENT_USER)
    {
        warn!("{e:#}");
    }
    Ok(())
}

/// 登录时自动启动：本用户的 `HKCU\...\Run` 里的 `Airhand`
pub fn apply_autostart(on: bool) -> Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if on {
        let exe = std::env::current_exe()?;
        let (run, _) = hkcu
            .create_subkey(RUN_KEY)
            .context("can't open the Run key")?;
        run.set_value(SERVICE_NAME, &format!("\"{}\"", exe.display()))
            .context("can't write the Run key")?;
    } else {
        let r = hkcu
            .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)
            .and_then(|run| run.delete_value(SERVICE_NAME));
        match r {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            r => r.context("can't delete the Run key")?,
        }
    }
    Ok(())
}

/// 这台电脑（被别的用户）为所有用户安装了 Airhand：被控端在它的服务里运行，这一份让开，否则两个被控端同时运行。
/// 不再登录时自动启动（只改启动项，config.toml 里的设置不动：那一份卸载之后再打开这一份，按设置恢复），
/// 问用户要不要卸载这一份
pub fn step_aside() {
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::{
        IDYES, MB_ICONINFORMATION, MB_YESNO, MessageBoxW, SW_SHOWNORMAL,
    };
    if let Err(e) = apply_autostart(false) {
        warn!("can't turn off autostart: {e:#}");
    }
    let text = HSTRING::from(tr!(
        "这台电脑已经为所有用户安装了 Airhand（作为系统服务运行）。仅为你安装的这一份不再运行，以免两个被控端同时运行，登录时也不再自动启动。\n\n要现在卸载仅为你安装的这一份吗？",
        "Airhand is also installed for all users on this computer (as a system service). The copy installed just for you no longer runs, so that two hosts don't run at the same time, and no longer starts when you sign in.\n\nUninstall the copy installed just for you now?"
    ));
    let answer = unsafe { MessageBoxW(None, &text, w!("Airhand"), MB_YESNO | MB_ICONINFORMATION) };
    if answer != IDYES {
        return;
    }
    // 卸载程序要求提升权限（管理员账户）时只有 ShellExecute 能弹出 UAC，CreateProcess 会失败
    let uninstaller = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.join("uninstall.exe")))
        .filter(|p| p.exists());
    match uninstaller {
        Some(path) => unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                &HSTRING::from(Path::new(&path)),
                None,
                None,
                SW_SHOWNORMAL,
            );
        },
        None => warn!("the uninstaller is missing"),
    }
}
