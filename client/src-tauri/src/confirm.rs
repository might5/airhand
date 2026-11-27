//! 托盘菜单里「重启 Airhand」「退出」的确认对话框。
//!
//! 这两项都会断开正在控制本机的连接、退出后本机不能再被远程控制，点错了很麻烦，
//! 所以点完之后先问一句：
//! * macOS：`NSAlert`，与「卸载 Airhand…」的确认对话框同一套做法（见 `uninstall::confirm`）；
//! * Windows：`MessageBoxW`；
//! * Linux：控制台/托盘没有引入 GTK 绑定的模态对话框，保持原来的行为直接执行。
//!
//! 两个平台的默认按钮（回车、空格）都落在「取消」上，不会一按回车就重启或退出。

/// 问一句再干：`true` = 用户点了确认
///
/// `destructive`：macOS 上把确认按钮标成破坏性操作（红色）
pub fn yes_no(title: &str, text: &str, confirm_label: &str, destructive: bool) -> bool {
    // 连点两下菜单时只弹一个：第二个直接当成"没确认"，免得叠出两个模态对话框
    static BUSY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if BUSY.swap(true, std::sync::atomic::Ordering::AcqRel) {
        return false;
    }
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            BUSY.store(false, std::sync::atomic::Ordering::Release);
        }
    }
    let _reset = Reset;

    #[cfg(target_os = "macos")]
    {
        macos(title, text, confirm_label, destructive)
    }
    #[cfg(windows)]
    {
        windows(title, text, confirm_label, destructive)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (title, text, confirm_label, destructive);
        true
    }
}

#[cfg(target_os = "macos")]
fn macos(title: &str, text: &str, confirm_label: &str, destructive: bool) -> bool {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSAlertSecondButtonReturn, NSAlertStyle};
    use objc2_foundation::NSString;

    let Some(mtm) = MainThreadMarker::new() else {
        // 不该发生（都在主线程上弹）：宁可不弹，也不要在用户不知情的情况下重启或退出
        tracing::warn!("confirmation dialog off the main thread");
        return false;
    };
    let alert = NSAlert::new(mtm);
    alert.setAlertStyle(NSAlertStyle::Warning);
    alert.setMessageText(&NSString::from_str(title));
    alert.setInformativeText(&NSString::from_str(text));
    // 第一个按钮是默认按钮（回车）：默认是"取消"，不会一按回车就重启了
    alert.addButtonWithTitle(&NSString::from_str(&tr!("取消", "Cancel")));
    let ok = alert.addButtonWithTitle(&NSString::from_str(confirm_label));
    ok.setHasDestructiveAction(destructive);
    // 平时只有菜单栏图标（没有窗口、不在程序坞里）：先把自己带到前面，别让对话框躲在别的程序后面
    crate::tray::front_panel(mtm, &alert.window());
    alert.runModal() == NSAlertSecondButtonReturn
}

#[cfg(windows)]
fn windows(title: &str, text: &str, confirm_label: &str, destructive: bool) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        IDYES, MB_DEFBUTTON2, MB_ICONWARNING, MB_SETFOREGROUND, MB_YESNO, MessageBoxW,
    };
    use windows::core::{HSTRING, w};

    // MessageBoxW 的按钮文字由系统语言决定（是/否），用不上自定义的确认按钮文字
    let _ = (confirm_label, destructive);
    let text = HSTRING::from(text);
    let answer = unsafe {
        MessageBoxW(
            None,
            &text,
            w!("Airhand"),
            // 默认按钮是第二个（否），和 macOS 的"默认不执行"一致
            MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2 | MB_SETFOREGROUND,
        )
    };
    answer == IDYES
}
