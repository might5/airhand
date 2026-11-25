#!/usr/bin/env bash
#
# 把各条流水线的产物统一挂到同一个 Release 上：tag 固定为 v<版本号>（例如 v0.3.1）。
#
# 桌面端（macOS dmg + Windows exe）、安卓 APK、iOS ipa、网页控制台镜像、中转服务器镜像
# 分在不同的 workflow / job 里跑，谁先跑完谁建 Release，其余的只把产物补进同一个 Release，
# 于是每个版本只有一个 Release，点进去就是全部东西。
#
# 用法：release-upload.sh <版本号> <产物文件...>
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "用法：release-upload.sh <版本号> <产物文件...>" >&2
  exit 1
fi

VER="$1"
shift
REPO="${GITHUB_REPOSITORY:?缺少 GITHUB_REPOSITORY 环境变量}"

# 发布规则对齐上游：一个版本(tag)一个 Release，老产物不再被后续构建覆盖。
# 只有在 vX.Y.Z(-rc.N) tag 上运行时才算正式版本；手动/一键构建一律挂到 ci-<版本>-<run> 的预发布。
PRE=()
if [ "${GITHUB_REF_TYPE:-}" = "tag" ] && [[ "${GITHUB_REF_NAME:-}" == v* ]]; then
  TAG="${GITHUB_REF_NAME}"
  VER="${TAG#v}"
else
  TAG="ci-${VER}-${GITHUB_RUN_NUMBER:-$(date +%Y%m%d%H%M%S)}"
  PRE=(--prerelease)
  echo "非 tag 运行，产物挂到临时的预发布 ${TAG}（不会覆盖正式版本）"
fi

for f in "$@"; do
  if [ ! -f "${f}" ]; then
    echo "要上传的产物不存在：${f}" >&2
    exit 1
  fi
done

# 说明只在第一次创建 Release 时写进去，后面的 job 只补文件、不覆盖已有说明
NOTES="$(cat <<EOF
Airhand ${VER} 的全部产物都在这一个 Release 里：

| 平台 | 文件 |
| --- | --- |
| macOS（Apple Silicon） | Airhand_${VER}_aarch64.dmg |
| Windows（x64） | Airhand_${VER}_x64-setup.exe |
| 安卓（arm64-v8a / armeabi-v7a / x86_64，Android 7.0+） | Airhand-${VER}-android.apk |
| iOS（17.0+） | Airhand-${VER}-ios*.ipa |
| 网页控制台镜像（linux/amd64） | airhand-web_${VER}_amd64.tar.gz |
| 中转服务器镜像（linux/amd64，UDP 4433） | airhand-server_${VER}_amd64.tar.gz |

镜像先 docker load -i 对应 tar.gz，再 docker run 起来；客户端安装包未做正式签名（macOS 首次打开请右键→打开，iOS 用 Sideloadly / AltStore 安装或自行重签）。
EOF
)"

# 各 job 是并行跑的，可能同时抢着创建同一 tag：谁先建成算谁的，另一个 create 失败属正常
if ! gh release view "${TAG}" --repo "${REPO}" >/dev/null 2>&1; then
  gh release create "${TAG}" --repo "${REPO}" \
    --title "Airhand ${VER}" --notes "${NOTES}" ${PRE[@]+"${PRE[@]}"} || true
fi

# 等 Release 真的可见（另一个 job 可能正在创建）
for i in $(seq 1 20); do
  if gh release view "${TAG}" --repo "${REPO}" >/dev/null 2>&1; then
    break
  fi
  if [ "${i}" -eq 20 ]; then
    echo "等不到 Release ${TAG} 就绪" >&2
    exit 1
  fi
  echo "等 Release ${TAG} 就绪（第 ${i} 次）"
  sleep 3
done

# --clobber：仅同一 tag 重跑时覆盖自己的同名产物（跨版本不会互相覆盖）
gh release upload "${TAG}" "$@" --clobber --repo "${REPO}"
echo "已挂到 ${TAG}，本次上传：$*"
gh release view "${TAG}" --repo "${REPO}" --json url -q .url
