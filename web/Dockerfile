# syntax=docker/dockerfile:1
# Airhand 网页控制台：控制端跑在容器里，在浏览器里使用。构建上下文是仓库根目录（见 web/docker-compose.yml）。
# ── 控制台界面（React，与桌面版同一份）──────────────────
FROM node:22-bookworm-slim AS ui
WORKDIR /ui
COPY client/package.json client/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY client/index.html client/vite.config.ts client/tsconfig.json ./
COPY client/public ./public
COPY client/src ./src
RUN npm run build

# ── 服务（Rust）──────────────────────────────────────
# web/ 是独立的 Cargo 工作区，只用到 crates/ 里的两个库，不需要根目录的工作区和中转服务器
FROM rust:1-slim-bookworm AS builder
WORKDIR /src/web
COPY crates /src/crates
COPY web/Cargo.toml web/Cargo.lock ./
COPY web/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/web/target \
    cargo build --release --locked \
 && cp target/release/airhand-web /airhand-web

# ── 运行（distroless，无 shell，以 root 运行）────────────
# 以 root 运行（不用 :nonroot 标签、不设 USER）：挂载进来的 /data 不管属于谁都写得进去。目录不存在时 Docker 替你建的属于 root，
# 自己 mkdir 的属于你的用户，nonroot（65532）都写不进去，服务会因为写不了证书而退出。代价：data/ 里生成的文件在宿主机上属于 root。
FROM gcr.io/distroless/cc-debian12
COPY --from=builder /airhand-web /usr/local/bin/airhand-web
COPY --from=ui /ui/dist /usr/share/airhand/www
ENV AIRHAND_WEB_LISTEN=0.0.0.0:8080 \
    AIRHAND_WEB_ROOT=/usr/share/airhand/www \
    AIRHAND_WEB_CERT=/data/cert.pem \
    AIRHAND_WEB_KEY=/data/key.pem \
    AIRHAND_SERVER_TRUST=/data/server-trust.txt \
    AIRHAND_WEB_IDENTITY=/data/controller-key.txt \
    AIRHAND_WEB_DEVICES=/data/devices.json \
    RUST_LOG=info
VOLUME ["/data"]
# HTTP 和 HTTPS 共用这一个端口
EXPOSE 8080/tcp
ENTRYPOINT ["/usr/local/bin/airhand-web"]
