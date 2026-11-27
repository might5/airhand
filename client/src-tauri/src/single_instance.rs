//! 单实例：不产生任何文件。
//!
//! * Windows：命名互斥量（内核对象）；
//! * Linux：抽象命名空间的 Unix 套接字（只存在于内核中，进程退出自动释放，不会留下锁文件）；
//! * macOS：在 bootstrap 服务里登记一个 Mach 端口名（`CFMessagePort`），同样只在内核 / launchd 里，
//!   进程退出时端口失效、名字自动注销。

pub struct Guard {
    /// Windows：命名互斥量的句柄。存成整数，好交给别的线程提前放开（见 [`Guard::release`]）
    #[cfg(windows)]
    handle: usize,
    #[cfg(target_os = "linux")]
    _socket: Option<std::os::unix::net::UnixListener>,
    #[cfg(target_os = "macos")]
    _port: Option<objc2_core_foundation::CFRetained<objc2_core_foundation::CFMessagePort>>,
}

#[cfg(windows)]
fn acquire_once() -> Option<Guard> {
    use windows::Win32::Foundation::{ERROR_ALREADY_EXISTS, GetLastError};
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::core::w;

    unsafe {
        let handle = CreateMutexW(None, true, w!("Local\\Airhand.SingleInstance")).ok()?;
        if GetLastError() == ERROR_ALREADY_EXISTS {
            return None;
        }
        Some(Guard {
            handle: handle.0 as usize,
        })
    }
}

#[cfg(windows)]
impl Guard {
    /// 提前放开（关掉互斥量的句柄），不等进程退出。仅为当前用户安装的那一份给为所有用户安装的那份让开时用：
    /// 它还在问用户要不要卸载自己，这时为所有用户安装的那份托盘就得能打开了（见 `crate::watch_service_installed`）
    pub fn release(self) {
        use windows::Win32::Foundation::{CloseHandle, HANDLE};
        let _ = unsafe { CloseHandle(HANDLE(self.handle as _)) };
    }
}

#[cfg(target_os = "linux")]
fn acquire_once() -> Option<Guard> {
    use std::os::linux::net::SocketAddrExt;
    use std::os::unix::net::{SocketAddr, UnixListener};

    // 每个用户一个实例
    let name = format!("airhand.single-instance.{}", unsafe { libc::getuid() });
    let socket =
        match SocketAddr::from_abstract_name(name).and_then(|a| UnixListener::bind_addr(&a)) {
            Ok(s) => Some(s),
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => return None,
            Err(e) => {
                // 无法判断时允许运行
                tracing::warn!("single-instance check failed: {e}");
                None
            }
        };
    Some(Guard { _socket: socket })
}

#[cfg(target_os = "macos")]
fn acquire_once() -> Option<Guard> {
    use objc2_core_foundation::{CFMessagePort, CFString};

    // 每个用户一个实例（不同用户的 bootstrap 命名空间本来就是分开的，带上 uid 更保险）
    let name = CFString::from_str(&format!("app.airhand.single-instance.{}", unsafe {
        libc::getuid()
    }));
    let running = || CFMessagePort::new_remote(None, Some(&name)).is_some();
    if running() {
        return None;
    }
    // 只占用名字，不处理消息（不加入任何 run loop，回调永远不会被调用）
    unsafe extern "C-unwind" fn ignore(
        _: *mut CFMessagePort,
        _: i32,
        _: *const objc2_core_foundation::CFData,
        _: *mut std::ffi::c_void,
    ) -> *const objc2_core_foundation::CFData {
        std::ptr::null()
    }
    let port = unsafe {
        CFMessagePort::new_local(
            None,
            Some(&name),
            Some(ignore),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if port.is_none() {
        // 两个实例同时启动时，后登记的会失败；其它原因无法判断时允许运行
        if running() {
            return None;
        }
        tracing::warn!("single-instance check failed: can't register the Mach port name");
    }
    Some(Guard { _port: port })
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn acquire_once() -> Option<Guard> {
    Some(Guard {})
}

/// 已经有实例时不要立刻放弃，留一小段余量再试：
/// 托盘菜单里的「重启 Airhand」走 tauri 的 restart，它是先起新进程再退出自己，新旧两份会同时活过几十毫秒，
/// 新进程这时被单实例挡住就会白白退出（用户点了重启，Airhand 反而没了）。
/// 真有一个实例在跑时这里最多多等 3 秒，这时还没创建窗口，用户看不到任何东西。
pub fn acquire() -> Option<Guard> {
    if let Some(guard) = acquire_once() {
        return Some(guard);
    }
    const RETRY: std::time::Duration = std::time::Duration::from_millis(50);
    for _ in 0..60 {
        std::thread::sleep(RETRY);
        if let Some(guard) = acquire_once() {
            return Some(guard);
        }
    }
    None
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn only_one_instance() {
        // 这里用 acquire_once：acquire 会为重试等上几秒，测不出东西来
        let first =
            super::acquire_once().expect("第一个实例应该能运行（是不是已经有 Airhand 在运行？）");
        assert!(super::acquire_once().is_none(), "第二个实例不应该运行");
        drop(first);
        assert!(
            super::acquire_once().is_some(),
            "第一个实例退出后应该可以再运行"
        );
    }
}
