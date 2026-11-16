# Ubuntu / Linux 部署（Docker Compose）

MangaFlow Linux 版是独立 Web 服务，不需要 Ubuntu 图形桌面，也不需要安装 Windows EXE。模型服务（ComfyUI、语言模型）另行部署。Windows 浏览器可以连接 Ubuntu 上的同一服务，项目与生成产物保存在 Ubuntu；不等价于 Windows 原生桌面客户端。

## 前置条件

- Ubuntu x86_64，Git、Docker Engine 与 Compose v2（安装见 [Docker 官方 Ubuntu 指南](https://docs.docker.com/engine/install/ubuntu/)）。以下命令假设当前用户已获 Docker 操作权限；否则在 Docker 命令前加 sudo。
- 构建时需访问镜像仓库与 Bun 依赖源。MangaFlow 容器不执行 GPU 推理，无需 NVIDIA 容器运行时；GPU 在用户配置的 ComfyUI 服务中使用。
- 局域网模式需 Ubuntu 的固定或 DHCP 保留 IPv4 地址、客户端与其网络互通、TCP 3443 可达。不要做公网端口转发。

## 首次部署

```bash
git clone https://github.com/ynw0/Mangaflow.git
cd Mangaflow
# 查看本机地址，选择 Windows 能访问的物理局域网网卡地址
ip -br -4 addr
# 仅在首次、尚不存在 .env 时执行；升级必须保留原文件和数据卷
if [ ! -e .env ]; then
  (umask 077; printf 'TOONFLOW_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env)
fi
chmod 600 .env
```

编辑 .env（使用 `nano .env`），保留生成的 TOONFLOW_TOKEN，添加一行实际 Ubuntu IPv4 地址，例如：

```dotenv
MANGAFLOW_LAN_IP=192.168.1.100
```

然后执行：

```bash
docker compose config --quiet
docker compose --profile lan up -d --build
docker compose --profile lan ps
docker compose --profile lan logs --tail=100 toonflow caddy-lan
```

默认（不指定 profile）仅将服务绑定到 Ubuntu 的 127.0.0.1:3000。lan profile 在指定的局域网 IP 上额外启用 HTTPS 3443，后端仍然只映射到本机 3000。不要用 0.0.0.0 替代局域网 IP，也不要为了省事去掉 TOONFLOW_TOKEN。令牌是共享管理员权限，不是多用户分权账号。

## Windows 浏览器访问

Caddy 为该局域网 IP 签发内部 CA 证书，使 Chrome/Edge 在信任证书后满足画布所需的安全上下文（crypto.randomUUID 等）。首次启动完成后，在 Ubuntu 导出**仅公开根证书**：

```bash
docker compose --profile lan cp caddy-lan:/data/caddy/pki/authorities/local/root.crt ./mangaflow-lan-root.crt
openssl x509 -in mangaflow-lan-root.crt -noout -fingerprint -sha256
```

如果根证书还未生成，检查 caddy-lan 日志并确认启动成功。通过可信方式（例如 SSH/SCP）复制 mangaflow-lan-root.crt 到 Windows，核对证书 SHA-256 指纹，再在 PowerShell 中执行：

```powershell
certutil -user -addstore Root .\mangaflow-lan-root.crt
```

这是有安全影响的信任操作：仅信任自己管理的部署的 CA，不传输 CA 私钥，不忽略浏览器证书错误。企业电脑应遵循管理员证书策略。之后在 Windows Edge 或 Chrome 打开：

```text
https://192.168.1.100:3443
```

换成 Ubuntu 的实际 IP，输入 .env 中自己的 TOONFLOW_TOKEN（可在 Ubuntu 本地用 `grep '^TOONFLOW_TOKEN=' .env` 查看，不要将结果发到聊天或日志）。浏览器开发者控制台确认 `window.isSecureContext === true` 和 `typeof crypto.randomUUID === "function"`。若无法连接，在 Windows 检查 `Test-NetConnection 192.168.1.100 -Port 3443`，核对 IP、路由和 Docker 端口。Docker 发布端口可能绕过 UFW 的普通入站规则；如需限定客户端子网，使用符合 Docker 网络后端的防火墙规则或网络 ACL。不要暴露到公网。

不便安装内部 CA 时，可以不启用 lan profile，采用 Windows SSH 本地转发（需要 Ubuntu SSH 服务和权限）：
`ssh -N -L 3000:127.0.0.1:3000 用户名@192.168.1.100`，然后打开 `http://localhost:3000`。已启用 lan profile 的部署若要关闭 LAN，运行 `docker compose --profile lan stop caddy-lan`。

## 配置模型

- Linux Docker 内的 localhost 是 MangaFlow 容器，不是 Ubuntu 宿主机。如果 ComfyUI 运行在 Ubuntu 宿主机，并监听容器可达的地址，设置 → 工作流 → 本机 ComfyUI 地址可填写 `http://host.docker.internal:8188`（端口按实际服务）。不能只监听宿主机 127.0.0.1；限制 ComfyUI 仅向可信容器网络/客户端开放。
- ComfyUI 若运行在同一 Docker 网络，使用对应服务名和端口；若运行在另一台机器，使用容器能访问的实际地址。
- 设置里配置文本模型，再保存工作流地址，刷新 Gemma 模型列表并启用实际 BF16/INT8 权重。不要在不支持 FP8 的 A800 上启用 FP8 权重。
- 工作区在服务器 data/workspaces 下（容器内 /app/data/workspaces）。不要把 Windows 电脑的 C:\\ 等本地绝对路径当作 Linux 服务路径。

## 升级、停止、数据保存

```bash
# 在原仓库目录，保留 .env
git pull --ff-only origin master
docker compose --profile lan up -d --build
docker compose --profile lan ps
# 停止并删除容器，不删除命名数据卷
docker compose --profile lan down
```

避免在生成任务运行中升级；重启可能中断正在进行的程序操作。数据卷 toonflowData 保存项目、配置和任务记录；caddyLanData 保存内部 CA，保留它才能沿用已信任证书。不要运行 `docker compose down -v`，不要删除卷（除非明确要清空数据）。升级前备份数据卷和 .env，并妥善保护 CA 私钥、访问令牌及 API 密钥。服务器与 Windows 原生客户端不共享本机工作目录。

公网 HTTPS 是原有独立 https profile，需要公网域名和公开可信证书，不是本指南的 LAN 模式。不要同时启动不需要的 profile。
