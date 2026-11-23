//! 虚拟显示器下一步该做什么（纯逻辑，执行见 `super::manager`）。
//!
//! 每一轮看一眼现在的样子（[`Facts`]）和想要什么（[`Wants`]），只决定一步（[`Step`]）；执行完下一轮再看。
//! 中途发生了什么（显示器插拔、别的程序改了显示设置、启用之后虚拟显示器还没出来）都在下一轮按新的样子处理，
//! 不用记一长串计划、也不怕执行到一半被打断。
//!
//! * **防窥**：启用虚拟显示器 → 等它出来 → 只留它在桌面上（撤下本机的显示器）。之后本机又有显示器回到桌面上
//!   （有人重新插了显示器、Windows 按记着的设置放回去了）就再撤一次；
//! * **防窥结束**：先停用虚拟显示器（它是桌面上唯一的显示器，没了之后 Windows 自己就把本机的显示器放回去），
//!   再按 Windows 记着的设置恢复一遍；
//! * **补屏**：有会话、本机却没有显示器在桌面上（显示器关了电源，线上的热插拔信号也断了，Windows 就把它移走了；
//!   或者根本没接显示器）时启用虚拟显示器。本机的显示器回到桌面上一会儿之后停用。补着屏的时候接上了新的显示器
//!   （例如重新打开了显示器的电源）也停用一下，让 Windows 把它放回桌面；放不回去（例如合着笔记本的盖子，
//!   接着但不能用）就过一会儿再补，直到接着的显示器又有变化才再试。最后一个会话结束后再留一会儿（等断线重连）。

use std::time::{Duration, Instant};

/// 一个显示器接口：显卡的 LUID 和接口编号
pub(super) type Target = (i64, u32);

/// 现在的样子
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct Facts {
    /// 虚拟显示器的设备启用着
    pub enabled: bool,
    /// Windows 认出了虚拟显示器的显示器（启用之后要一会儿）
    pub virtual_connected: bool,
    /// 虚拟显示器在桌面上
    pub virtual_active: bool,
    /// 有本机的显示器在桌面上
    pub physical_active: bool,
    /// 接着的本机显示器（不管在不在桌面上），排好序的
    pub physical_connected: Vec<Target>,
}

/// 想要什么
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct Wants {
    /// 防窥模式
    pub privacy: bool,
    /// 有会话（或者最后一个会话刚结束不久）：要有显示器可看
    pub sessions: bool,
}

/// 下一步
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Step {
    /// 什么也不用做
    Idle,
    /// 等虚拟显示器出来
    Wait,
    /// 启用虚拟显示器
    Enable,
    /// 停用虚拟显示器
    Disable,
    /// 只留虚拟显示器在桌面上（防窥）
    Isolate,
    /// 按 Windows 记着的设置恢复本机的显示器（防窥结束）
    Restore,
}

/// 本机的显示器回到桌面上这么久之后才停用补屏的虚拟显示器（Windows 一个一个放回去，别刚放回一个就停）
pub(super) const SETTLE: Duration = Duration::from_secs(2);
/// 补着屏时接上了新的显示器：停用虚拟显示器之后等这么久，Windows 还没把它放回桌面就再补屏
pub(super) const PROBE: Duration = Duration::from_secs(8);

#[derive(Debug, Default)]
pub(super) struct Plan {
    /// 撤下了本机的显示器（防窥），还没恢复。由执行的一方在撤下 / 恢复成功之后设置
    pub isolated: bool,
    /// 为了补屏启用的：那时接着哪些本机显示器
    headless: Option<Vec<Target>>,
    /// 让新接上的显示器回到桌面上：这之前不补屏
    probing: Option<Instant>,
    /// 本机的显示器回到桌面上的时刻
    physical_since: Option<Instant>,
}

impl Plan {
    /// `isolated`：上次撤下了本机的显示器、还没恢复（进程意外退出过，见 `super::device::was_isolated`）
    pub fn new(isolated: bool) -> Self {
        Self {
            isolated,
            ..Self::default()
        }
    }

    pub fn step(&mut self, wants: Wants, f: &Facts, now: Instant) -> Step {
        if f.physical_active {
            self.physical_since.get_or_insert(now);
        } else {
            self.physical_since = None;
        }
        if wants.privacy {
            self.headless = None;
            self.probing = None;
            if !f.enabled {
                return Step::Enable;
            }
            if !f.virtual_connected {
                return Step::Wait;
            }
            if !self.isolated || !f.virtual_active || f.physical_active {
                return Step::Isolate;
            }
            return Step::Idle;
        }
        if self.isolated {
            return if f.enabled {
                Step::Disable
            } else {
                Step::Restore
            };
        }
        if !f.enabled {
            if let Some(until) = self.probing {
                if now < until && !f.physical_active {
                    return Step::Idle;
                }
                self.probing = None;
            }
            if wants.sessions && !f.physical_active {
                self.headless = Some(f.physical_connected.clone());
                return Step::Enable;
            }
            self.headless = None;
            return Step::Idle;
        }
        // 启用着（补屏，或者进程启动之前就启用着）
        if !wants.sessions {
            return Step::Disable;
        }
        if f.physical_active {
            let since = self.physical_since.unwrap_or(now);
            return if now.saturating_duration_since(since) >= SETTLE {
                Step::Disable
            } else {
                Step::Idle
            };
        }
        match &self.headless {
            Some(seen) if f.physical_connected.iter().any(|t| !seen.contains(t)) => {
                // 接上了新的显示器：停用虚拟显示器，让 Windows 把它放回桌面
                self.probing = Some(now + PROBE);
                self.headless = None;
                Step::Disable
            }
            Some(_) => Step::Idle,
            None => {
                self.headless = Some(f.physical_connected.clone());
                Step::Idle
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: Target = (1, 7);

    fn facts(enabled: bool, virtual_active: bool, physical_active: bool) -> Facts {
        Facts {
            enabled,
            virtual_connected: enabled,
            virtual_active,
            physical_active,
            physical_connected: if physical_active {
                vec![MONITOR]
            } else {
                vec![]
            },
        }
    }

    const SESSION: Wants = Wants {
        privacy: false,
        sessions: true,
    };
    const PRIVACY: Wants = Wants {
        privacy: true,
        sessions: true,
    };
    const NOBODY: Wants = Wants {
        privacy: false,
        sessions: false,
    };

    /// 显示器开着：什么也不做；关了电源（从桌面上没了）：补一个，开回来一会儿之后停用
    #[test]
    fn fills_in_while_the_monitor_is_off() {
        let mut p = Plan::default();
        let t0 = Instant::now();
        assert_eq!(p.step(SESSION, &facts(false, false, true), t0), Step::Idle);
        assert_eq!(
            p.step(SESSION, &facts(false, false, false), t0),
            Step::Enable
        );
        // 启用了，还没出来；出来了
        let waiting = Facts {
            enabled: true,
            ..Facts::default()
        };
        assert_eq!(p.step(SESSION, &waiting, t0), Step::Idle);
        assert_eq!(p.step(SESSION, &facts(true, true, false), t0), Step::Idle);
        // 显示器开回来了，Windows 把它放回了桌面
        assert_eq!(p.step(SESSION, &facts(true, true, true), t0), Step::Idle);
        assert_eq!(
            p.step(SESSION, &facts(true, true, true), t0 + SETTLE),
            Step::Disable
        );
        assert_eq!(
            p.step(SESSION, &facts(false, false, true), t0 + SETTLE),
            Step::Idle
        );
        // 没有会话了：不补屏；补着的停用
        assert_eq!(p.step(NOBODY, &facts(false, false, false), t0), Step::Idle);
        assert_eq!(p.step(NOBODY, &facts(true, true, false), t0), Step::Disable);
    }

    /// 补着屏时接上了显示器、Windows 却没把它放回桌面（例如它的设置是"只在 2 上显示"，或者合着盖子）：
    /// 停用一下让它试试，放不回去就过一会儿再补，同一组显示器不再反复试
    #[test]
    fn a_new_monitor_gets_one_try() {
        let mut p = Plan::default();
        let t0 = Instant::now();
        assert_eq!(
            p.step(SESSION, &facts(false, false, false), t0),
            Step::Enable
        );
        assert_eq!(p.step(SESSION, &facts(true, true, false), t0), Step::Idle);
        let plugged = Facts {
            physical_connected: vec![MONITOR],
            ..facts(true, true, false)
        };
        assert_eq!(p.step(SESSION, &plugged, t0), Step::Disable);
        let disabled = Facts {
            physical_connected: vec![MONITOR],
            ..facts(false, false, false)
        };
        assert_eq!(p.step(SESSION, &disabled, t0), Step::Idle);
        assert_eq!(p.step(SESSION, &disabled, t0 + PROBE), Step::Enable);
        let enabled = Facts {
            physical_connected: vec![MONITOR],
            ..facts(true, true, false)
        };
        assert_eq!(p.step(SESSION, &enabled, t0 + PROBE), Step::Idle);
        // 显示器拔掉了：不用试
        assert_eq!(
            p.step(SESSION, &facts(true, true, false), t0 + PROBE),
            Step::Idle
        );
    }

    /// 防窥：启用、等它出来、只留它；本机的显示器又回到桌面上就再撤；结束时先停用再恢复
    #[test]
    fn privacy_isolates_and_restores() {
        let mut p = Plan::default();
        let t0 = Instant::now();
        assert_eq!(
            p.step(PRIVACY, &facts(false, false, true), t0),
            Step::Enable
        );
        let waiting = Facts {
            enabled: true,
            virtual_connected: false,
            ..facts(true, false, true)
        };
        assert_eq!(p.step(PRIVACY, &waiting, t0), Step::Wait);
        // Windows 把它扩展到了桌面上（本机的也还在）
        assert_eq!(p.step(PRIVACY, &facts(true, true, true), t0), Step::Isolate);
        p.isolated = true;
        assert_eq!(p.step(PRIVACY, &facts(true, true, false), t0), Step::Idle);
        // 有人插拔了显示器，Windows 把它放回了桌面
        assert_eq!(p.step(PRIVACY, &facts(true, true, true), t0), Step::Isolate);
        // 结束：先停用，再恢复
        assert_eq!(p.step(NOBODY, &facts(true, true, false), t0), Step::Disable);
        assert_eq!(
            p.step(NOBODY, &facts(false, false, true), t0),
            Step::Restore
        );
        p.isolated = false;
        assert_eq!(p.step(NOBODY, &facts(false, false, true), t0), Step::Idle);
    }

    /// 补着屏的时候打开防窥：不用再启用，直接只留它
    #[test]
    fn privacy_while_filling_in() {
        let mut p = Plan::default();
        let t0 = Instant::now();
        assert_eq!(
            p.step(SESSION, &facts(false, false, false), t0),
            Step::Enable
        );
        assert_eq!(
            p.step(PRIVACY, &facts(true, true, false), t0),
            Step::Isolate
        );
        p.isolated = true;
        assert_eq!(p.step(PRIVACY, &facts(true, true, false), t0), Step::Idle);
        // 关掉防窥：显示器还关着、会话还在，恢复之后又会补屏
        assert_eq!(
            p.step(SESSION, &facts(true, true, false), t0),
            Step::Disable
        );
        assert_eq!(
            p.step(SESSION, &facts(false, false, false), t0),
            Step::Restore
        );
        p.isolated = false;
        assert_eq!(
            p.step(SESSION, &facts(false, false, false), t0),
            Step::Enable
        );
    }
}
