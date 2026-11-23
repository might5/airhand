//! 网页控制台的"我的设备"：连接过的电脑存在服务器上（不写浏览器的存储），换浏览器、清站点数据都还在。
//!
//! 桌面版把这个列表存在 `config.toml` 的 `[[device]]`（见 `client/src-tauri`）；网页控制台跑在服务器 /
//! 容器里，就存在那边的一个文件里（`AIRHAND_WEB_DEVICES`，Docker 镜像里是 `/data/devices.json`，
//! 文件权限 600）。浏览器通过 `GET /api/devices` 和 `PUT /api/devices` 读写它，和别的请求一样要过访问密码
//! （见 [`crate::auth`]）：**访问密码是这里唯一的门**，所以对外暴露端口时一定要设置 `AIRHAND_WEB_PASSWORD`。
//!
//! 里面是控制码、重连凭证和对方的公钥，服务器上是明文（和桌面版的 `config.toml` 相同，靠文件权限保护）。
//! 没有地方保存时只记在内存里：重启之后列表就空了。

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderValue, StatusCode};
use axum::http::header::CONTENT_TYPE;
use axum::response::{IntoResponse, Response};
use serde_json::Value;
use tracing::warn;

/// 与 `client/src/lib/devices.ts` 里的 `MAX_DEVICES` 相同：最多记这么多台
pub const MAX_DEVICES: usize = 50;

/// 一台电脑大约 1 KB；留足余量，别让人把大文件塞进 `/data`
pub const MAX_BODY: usize = 64 * 1024;

/// 读写 `/api/devices` 时给路由挂的请求体上限
pub fn body_limit() -> DefaultBodyLimit {
    DefaultBodyLimit::max(MAX_BODY)
}

pub struct Devices {
    /// `None`：没有地方保存，只在内存里
    path: Option<PathBuf>,
    list: Mutex<Vec<Value>>,
}

impl Devices {
    /// 从文件里读出来（没有文件就是空列表）
    pub fn load(path: Option<&Path>) -> Self {
        let list = match path {
            Some(path) => read(path).unwrap_or_default(),
            None => {
                warn!(
                    "AIRHAND_WEB_DEVICES is not set: My devices is only kept in memory (set it, or AIRHAND_WEB_CERT, to keep the list across restarts)"
                );
                Vec::new()
            }
        };
        Self {
            path: path.map(Path::to_path_buf),
            list: Mutex::new(list),
        }
    }

    fn list(&self) -> Vec<Value> {
        self.list.lock().expect("devices").clone()
    }

    /// 整个列表换掉（浏览器每次变化都发完整的列表，和桌面版一样）
    fn replace(&self, items: Vec<Value>) -> std::io::Result<()> {
        if let Some(path) = &self.path {
            let text = serde_json::to_vec_pretty(&items).expect("a list of devices is JSON");
            save(path, &text)?;
        }
        *self.list.lock().expect("devices") = items;
        Ok(())
    }
}

fn read(path: &Path) -> Option<Vec<Value>> {
    let text = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Array(items)) => Some(items.into_iter().take(MAX_DEVICES).collect()),
        Ok(_) => {
            warn!("{} isn't a list of devices, ignoring it", path.display());
            None
        }
        Err(e) => {
            warn!("can't read {} ({e}), ignoring it", path.display());
            None
        }
    }
}

fn save(path: &Path, text: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // 先写临时文件再改名：中途被打断也不会留下半个文件
    let tmp = path.with_extension("json.tmp");
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(text)?;
        f.sync_all()?;
    }
    #[cfg(not(unix))]
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

/// 一条记录至少得有 6 位控制码，否则界面那边也读不出来
fn is_device(v: &Value) -> bool {
    let Some(d) = v.as_object() else {
        return false;
    };
    d.get("code")
        .and_then(Value::as_str)
        .is_some_and(|c| c.len() == 6 && c.bytes().all(|b| b.is_ascii_digit()))
}

/// 读出"我的设备"
pub async fn get(State(app): State<Arc<crate::http::App>>) -> Response {
    json(Value::Array(app.devices.list()))
}

/// 存下整个"我的设备"列表（请求体是完整的列表，最多 [`MAX_DEVICES`] 台）
pub async fn put(State(app): State<Arc<crate::http::App>>, body: Bytes) -> Response {
    // 不用 axum 的 Json（它要多带一个 crate，锁文件里没有）
    let Ok(body) = serde_json::from_slice::<Value>(&body) else {
        return bad_request("expected a JSON list of devices");
    };
    let Value::Array(items) = body else {
        return bad_request("expected a list of devices");
    };
    if items.len() > MAX_DEVICES {
        return bad_request(&format!("at most {MAX_DEVICES} devices"));
    }
    if !items.iter().all(is_device) {
        return bad_request("every device needs a 6-digit control code");
    }
    match app.devices.replace(items) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => {
            warn!("can't save My devices: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "can't save My devices on this server",
            )
                .into_response()
        }
    }
}

fn json(value: Value) -> Response {
    match serde_json::to_vec(&value) {
        Ok(bytes) => {
            let mut res = Response::new(Body::from(bytes));
            res.headers_mut()
                .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            res
        }
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "can't read My devices on this server",
        )
            .into_response(),
    }
}

fn bad_request(message: &str) -> Response {
    (StatusCode::BAD_REQUEST, message.to_string()).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "airhand-web-devices-{tag}-{}-{nanos}",
            std::process::id()
        ))
    }

    fn device(code: &str) -> Value {
        serde_json::json!({ "code": code, "alias": null, "name": "mac", "os": "macos", "resume": [1, 2], "lastUsed": 7, "hostKey": null })
    }

    #[test]
    fn kept_across_restarts() {
        let dir = temp_dir("keep");
        let path = dir.join("devices.json");
        let a = Devices::load(Some(&path));
        assert!(a.list().is_empty());
        a.replace(vec![device("123456")]).unwrap();
        // 重新启动：从文件里读
        let b = Devices::load(Some(&path));
        assert_eq!(b.list(), vec![device("123456")]);
        // 文件只有本账户能读写
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn without_a_place_to_keep_it_the_list_lives_in_memory() {
        let devices = Devices::load(None);
        devices.replace(vec![device("123456")]).unwrap();
        assert_eq!(devices.list(), vec![device("123456")]);
    }

    #[test]
    fn broken_files_are_ignored_and_long_lists_are_cut() {
        let dir = temp_dir("broken");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("devices.json");
        std::fs::write(&path, "{not json").unwrap();
        assert!(Devices::load(Some(&path)).list().is_empty());
        let long: Vec<Value> = (0..MAX_DEVICES + 10)
            .map(|i| device(&format!("{i:06}")))
            .collect();
        std::fs::write(&path, serde_json::to_vec(&long).unwrap()).unwrap();
        assert_eq!(Devices::load(Some(&path)).list().len(), MAX_DEVICES);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_device_needs_a_control_code() {
        assert!(is_device(&device("123456")));
        assert!(!is_device(&device("12345")));
        assert!(!is_device(&device("12345a")));
        assert!(!is_device(&serde_json::json!("123456")));
        assert!(!is_device(&serde_json::json!({ "name": "mac" })));
    }
}
