# MangaFlow Ubuntu 离线安装（x86_64）

本发行包面向不能访问互联网的 Ubuntu 服务器，要求已安装并启动 Docker Engine 和 Compose v2。没有 Docker 的机器须另行准备匹配 Ubuntu 发行版及架构的离线安装依赖。MangaFlow 的镜像已包含应用、运行时、依赖、内置插件/工作流和 FFmpeg；LAN 反向代理镜像也一起提供。不包含 ComfyUI、H3/Gemma 或文本模型权重，不需要在目标机 git clone、bun install、docker pull 或 docker build。

## 1. 在有网的 Windows 下载发行包

下载同一 Linux release 下的所有手动安装资产：
- mangaflow-linux-amd64-deploy.tar.gz
- mangaflow-linux-amd64-images.tar.gz（若超出单文件发布限制，则为同名前缀的 .part-000、.part-001 等，必须全部下载）
- SHA256SUMS

使用 U 盘、SCP 或其他可信方式复制到 Ubuntu 同一目录。GitHub 自动附带的 Source code 不需要下载。

## 2. 校验和导入（Ubuntu 上操作）

```bash
uname -m
docker version
docker compose version
sha256sum -c SHA256SUMS
```

必须全部显示 OK。然后执行：

```bash
if [ -f mangaflow-linux-amd64-images.tar.gz ]; then
  docker load -i mangaflow-linux-amd64-images.tar.gz
else
  set -o pipefail
  cat mangaflow-linux-amd64-images.tar.gz.part-* | gzip -dc | docker load
fi
tar -xzf mangaflow-linux-amd64-deploy.tar.gz
cd mangaflow-offline
```

## 3. 设置与启动

在新部署目录查看 Ubuntu 地址（物理网卡的局域网 IPv4）：

```bash
ip -br -4 addr
if [ ! -e .env ]; then
  (umask 077; printf 'TOONFLOW_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env)
fi
chmod 600 .env
nano .env
```

保留随机 TOONFLOW_TOKEN，将服务器实际局域网 IP 写入 .env，例如 MANGAFLOW_LAN_IP=192.168.1.100。服务默认仅绑定环回，需显式启动 lan profile。
发行包自带 version.env，升级不改自己的 .env。以下命令中的项目名应保持不变；首次部署使用 mangaflow，若已有 Docker 部署必须先核对原 project 标签和数据卷（docker compose ls、docker volume ls），沿用原项目名、备份原数据和 .env，不能把新建空卷当作旧数据丢失。

```bash
docker compose -p mangaflow --env-file version.env --env-file .env config --quiet
docker compose -p mangaflow --env-file version.env --env-file .env --profile lan up -d --no-build --pull never
docker compose -p mangaflow --env-file version.env --env-file .env --profile lan ps
```

## 4. Windows 局域网访问

在 Ubuntu 导出仅公开根证书，核对指纹：

```bash
docker compose -p mangaflow --env-file version.env --env-file .env --profile lan cp caddy-lan:/data/caddy/pki/authorities/local/root.crt ./mangaflow-lan-root.crt
openssl x509 -in mangaflow-lan-root.crt -noout -fingerprint -sha256
```

通过可信方式复制证书到 Windows，核对 SHA-256 指纹，从 PowerShell 导入当前用户受信任根证书：

```powershell
certutil -user -addstore Root .\mangaflow-lan-root.crt
```

仅信任自己管理的部署 CA；不传输 CA 私钥、不忽略证书错误。浏览器打开 https://192.168.1.100:3443（改为真实 IP），输入 .env 中的访问令牌。不能安装证书时，也可以仅运行 toonflow 服务，使用 Windows SSH 本地转发 ssh -N -L 3000:127.0.0.1:3000 用户名@服务器IP，再访问 http://localhost:3000。不要将端口转发到公网。Docker 发布端口可能绕过普通 UFW 入站规则，必要时用 Docker 适配的防火墙或网络 ACL 限制访问范围。

## 5. 配置完全离线的本地模型

ComfyUI 在宿主机运行且监听容器可达地址时，可在工作流设置填 http://host.docker.internal:8188（按实际端口）。文本模型填写已在内网部署的 OpenAI 兼容 API 地址与模型名。Docker 里的 localhost 不是宿主机。可使用镜像内系统 FFmpeg，不要点击联网下载。模型及工作流所需节点、权重需另外提前部署。在线 API、市场下载、云端 AutoDL、外部互联网 MCP 隧道、在线创作资料搜索等功能没有公网时不可用；离线本地画布、已部署推理服务与局域网访问不依赖这些功能。

## 6. 更新

下载新 release 的离线包，先校验和导入。在原部署目录备份 .env、compose.yaml、version.env 与数据卷，更新 compose.yaml、version.env、caddyLanConfig（不覆盖 .env）。维持原 Compose 项目名，任务结束后再运行第3节的 up 命令。不要运行 down -v，保留 toonflowData 及 caddyLanData（含 CA）。旧镜像保留可供回退；应用数据兼容性仍需评估。此安装包不改动 ComfyUI/PyTorch/CUDA 环境。

内置工作流随新镜像更新，不需要复制到数据卷。已被统一工作流替代的旧 H3 ID 与旧 Gemma 规格 ID 不再出现在工作流列表中；历史 H3 引用仍可解析到统一双采。通过系统上传的自定义工作流保存在数据卷，额外配置的工作流目录也不会被升级删除。若曾把旧内置工作流手动复制到这些目录，其文件仍保留，但废弃 ID 不会作为可选项加载。
