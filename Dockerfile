FROM oven/bun:1.3.14

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY . .

# ACT: 保留工作区与依赖以兼容运行时动态加载；需要缩减镜像时再拆分构建阶段。
RUN bun install --frozen-lockfile

# 构建编号由 root 以 0600 写入；服务以 bun 用户运行，需要读取该编号以同步内置插件。
RUN bun run build:server \
    && chmod 0644 build/pluginRevision.txt \
    && mkdir -p data/workspaces/myProject \
    && chown -R bun:bun data

ENV NODE_ENV=production
ENV TOONFLOW_DATA_DIR=/app/data
# 容器内监听所有网卡，宿主机端口由 compose 绑定 127.0.0.1。非本机监听必须提供 TOONFLOW_TOKEN。
ENV TOONFLOW_HOST=0.0.0.0

USER bun
# 在构建阶段使用实际运行用户检查读取权限，避免镜像启动后才发现权限错误。
RUN test -r /app/build/pluginRevision.txt
EXPOSE 3000

CMD ["bun", "build/server/index.js"]
