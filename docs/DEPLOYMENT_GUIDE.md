# OpenSynapse 云服务器部署指南

## 概述

本文档记录将 OpenSynapse 部署到阿里云 ECS 的完整流程。PostgreSQL 沿用 APT 安装，Node.js 应用继续由 PM2 管理。Chroma 默认使用 Docker Compose，本机 CLI 仅作为手动备用方式；代码可用 rsync 上传。

## 前置条件

- **服务器**: Ubuntu 24.04 LTS
- **IP 地址**: 101.133.166.67（示例）
- **SSH 密钥**: `opennew.pem`（存储在项目根目录）
- **域名**: 可选，可使用 IP 直接访问

---

## 第一步：服务器环境初始化

### 1.1 连接服务器

```bash
cd /Users/lv/Workspace/OpenSynapse
ssh -i opennew.pem -o StrictHostKeyChecking=accept-new root@101.133.166.67
```

### 1.2 安装 Node.js 20

```bash
# 使用 NodeSource 安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 验证安装
node --version  # 应显示 v20.x.x
npm --version   # 应显示 10.x.x
```

### 1.3 安装 PM2 和 tsx

```bash
npm install -g pm2 tsx

# 验证 PM2
pm2 --version
```

### 1.4 安装 PostgreSQL

PostgreSQL 使用 APT 直接安装，Chroma 的 Compose 启动不会影响此数据库：

```bash
# 添加 PostgreSQL 官方源
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt-get update

# 安装 PostgreSQL 16
apt-get install -y postgresql-16 postgresql-client-16

# 启动 PostgreSQL
systemctl enable postgresql
systemctl start postgresql
```

---

## 第二步：配置数据库

### 2.1 创建数据库和用户

```bash
# 切换到 postgres 用户
su - postgres

# 进入 PostgreSQL 控制台
psql

# 创建数据库和用户
CREATE DATABASE opensynapse;
CREATE USER opensynapse WITH PASSWORD '你的密码';

# 授权
GRANT ALL PRIVILEGES ON DATABASE opensynapse TO opensynapse;

# 退出
\q
exit
```

### 2.2 执行数据库迁移

项目使用 Drizzle ORM，需要创建数据库表：

```bash
# 在服务器上执行
ssh -i opennew.pem root@101.133.166.67

# 执行 SQL 迁移文件
su - postgres -c "psql -d opensynapse -f /www/wwwroot/opensynapse/src/db/migrations/0000_gifted_madame_web.sql"
su - postgres -c "psql -d opensynapse -f /www/wwwroot/opensynapse/src/db/migrations/0001_swift_magus.sql"
su - postgres -c "psql -d opensynapse -f /www/wwwroot/opensynapse/src/db/migrations/0002_add_session_ip_columns.sql"

# 授予权限
su - postgres -c "psql -d opensynapse -c 'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO opensynapse;'"
su - postgres -c "psql -d opensynapse -c 'GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO opensynapse;'"

# 验证表已创建
su - postgres -c "psql -d opensynapse -c '\dt'"
```

### 2.3 配置远程访问（可选）

如需从外部连接数据库：

```bash
# 编辑配置文件
nano /etc/postgresql/16/main/postgresql.conf
# 找到并修改：listen_addresses = '*'

nano /etc/postgresql/16/main/pg_hba.conf
# 添加：host  all  all  0.0.0.0/0  scram-sha-256

# 重启 PostgreSQL
systemctl restart postgresql
```

---

## 第三步：部署项目代码

### 3.1 创建项目目录

```bash
mkdir -p /www/wwwroot/opensynapse
cd /www/wwwroot/opensynapse
```

### 3.2 上传代码（使用 rsync）

由于 GitHub 被墙，从本地上传代码：

**在本地执行：**

```bash
cd /Users/lv/Workspace/OpenSynapse

# 使用 rsync 上传（排除 node_modules）
rsync -avz --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  -e "ssh -i opennew.pem" \
  ./ root@101.133.166.67:/www/wwwroot/opensynapse/
```

### 3.3 安装依赖

**在服务器上执行：**

```bash
cd /www/wwwroot/opensynapse
npm install
```

### 3.4 构建前端

```bash
npm run build

# 确认 dist 目录生成
ls -la dist/
```

---

## 第四步：配置环境变量

### 4.1 创建生产环境配置

```bash
cd /www/wwwroot/opensynapse
# 首次部署才复制模板，已有配置不要覆盖
cp -n .env.example .env.local
nano .env.local
```

**填入以下内容：**

```env
# 数据库连接（使用 PostgreSQL）
DATABASE_URL=postgresql://opensynapse:你的密码@localhost:5432/opensynapse

# Better Auth 密钥（32 位以上随机字符串）
BETTER_AUTH_SECRET=your-super-secret-auth-key-minimum-32-characters

# 社交登录配置（可选，如需登录功能）
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret

# AI API 密钥（可选，如需 AI 功能）
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key

# Chroma（Docker 和本机备用共用同一地址）
CHROMA_URL=http://127.0.0.1:8000

# 其他配置
NODE_ENV=production
PORT=3000
```

`server.ts` 明确读取当前工作目录的 `.env.local`，生产环境也一样。仅填写 `.env.production` 不会生效。系统或 PM2 已注入的同名环境变量优先于 dotenv 文件，修改配置后应检查是否有旧值覆盖并重启应用。

### 4.2 创建 PM2 配置

由于 package.json 使用 `"type": "module"`，使用 CommonJS 配置文件。若已有配置，保留现有参数并核对 `cwd`：

```bash
cd /www/wwwroot/opensynapse
nano ecosystem.config.cjs
```

**首次创建时可使用以下 ecosystem.config.cjs 内容：**

```javascript
module.exports = {
  apps: [
    {
      name: 'opensynapse',
      cwd: '/www/wwwroot/opensynapse',
      script: 'server.ts',
      interpreter: 'tsx',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
```

---

## 第五步：启动应用

### 5.1 先启动 Chroma（Docker 默认）

安装 [Docker Engine 和 Compose 插件](https://docs.docker.com/engine/install/ubuntu/)，启动 Docker 服务，确认下面两条命令成功：

```bash
docker info
docker compose version
```

已有旧 Chroma 容器或卷时，先完成下文“旧容器和旧卷检查”，不要直接重建。

```bash
cd /www/wwwroot/opensynapse
docker compose config --quiet
docker compose up -d chroma
docker compose ps chroma

# 在宿主机用现有客户端验证心跳；Node.js 20.6+，需已 npm install
node --env-file=.env.local --import tsx --input-type=module -e 'import { vectorStore } from "./src/vector/chroma.ts"; const result = await vectorStore.healthCheck(); console.log(result); if (!result.healthy) process.exitCode = 1;'
```

只指定 `chroma`，不会启动或更改 Compose 中的 PostgreSQL。等待容器变为 `healthy` 且客户端返回 `healthy: true`，再启动应用。不要用无服务名的 `docker compose up -d` 替代此命令。

### 5.2 使用 PM2 启动

```bash
cd /www/wwwroot/opensynapse
pm2 start ecosystem.config.cjs --env production

# 保存 PM2 配置
pm2 save

# 设置开机自启
pm2 startup systemd
```

### 5.3 检查运行状态

```bash
# 查看进程状态
pm2 status

# 查看日志
pm2 logs opensynapse --lines 50

# 本地测试
curl http://localhost:3000
```

---

## 第六步：配置阿里云安全组

### 6.1 创建安全组模板

1. 登录 **阿里云控制台** → **ECS** → **安全组**
2. 点击 **创建安全组模板**
3. 填写：
   - **模板名称**: `opensynapse`
   - **添加规则**: 
     - 类型：自定义 TCP
     - 端口范围：`3000`
     - 来源 IP：`0.0.0.0/0`（或你的 IP）
     - 策略：允许
     - 备注：`OpenSynapse`
   - 点击 **创建模板**

### 6.2 应用安全组到实例

1. 进入 **ECS 实例列表**
2. 找到目标实例 → **更多** → **网络和安全组** → **安全组配置**
3. 点击 **加入安全组**
4. 选择刚才创建的 `opensynapse` 模板
5. 确认加入

---

## 第七步：验证部署

### 7.1 外部访问测试

```bash
# 从本地测试
curl http://101.133.166.67:3000
```

或在浏览器访问：`http://101.133.166.67:3000`

### 7.2 常见问题排查

**问题 1：连接被拒绝**
```bash
# 检查 PM2 状态
pm2 status

# 检查日志
pm2 logs opensynapse

# 检查端口监听
netstat -tlnp | grep 3000
```

**问题 2：模块错误**
- 确保 PM2 使用 CommonJS 配置 `ecosystem.config.cjs`，且 `cwd` 指向项目根目录

**问题 3：数据库连接失败**
```bash
# 测试数据库连接
su - postgres -c "psql -d opensynapse -c '\dt'"

# 检查 PostgreSQL 状态
systemctl status postgresql
```

---

## 第八步：可选配置

### 8.1 配置 Nginx 反向代理（推荐）

如需使用域名访问：

```bash
apt-get install -y nginx

# 创建配置
nano /etc/nginx/sites-available/opensynapse
```

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/opensynapse /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### 8.2 配置 HTTPS（使用 Certbot）

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

### 8.3 Chroma 运维

见下文“Chroma 运维与本机备用”，包括持久化、备份恢复和手动切换。

---

## 第六步（可选）：配置 Nginx 反向代理（隐藏端口号）

默认情况下应用运行在 3000 端口，访问时需要输入 `http://IP:3000`。使用 Nginx 反向代理可以隐藏端口号，直接通过 `http://IP` 访问。

### 6.1 快速配置（使用脚本）

```bash
# 在项目根目录执行
./setup-nginx.sh
```

### 6.2 手动配置

```bash
# 1. 安装 Nginx
ssh -i opennew.pem root@101.133.166.67
apt-get update
apt-get install -y nginx

# 2. 创建配置文件
cat > /etc/nginx/sites-available/opensynapse << 'EOF'
server {
    listen 80;
    server_name _;

    access_log /var/log/nginx/opensynapse-access.log;
    error_log /var/log/nginx/opensynapse-error.log;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_buffering off;
    }

    location /assets/ {
        proxy_pass http://localhost:3000;
        expires 1d;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# 3. 启用配置
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/opensynapse /etc/nginx/sites-enabled/opensynapse

# 4. 测试并重启
nginx -t
systemctl restart nginx
systemctl enable nginx
```

### 6.3 更新 Better Auth 配置

使用 Nginx 后，需要添加端口 80 到 Better Auth 的信任来源：

```typescript
// src/auth/server.ts
trustedOrigins: [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://101.133.166.67:3000",
  "http://101.133.166.67",        // 添加：Nginx 反向代理
  "http://101.133.166.67:80"
],
```

修改后重新部署：
```bash
./deploy.sh 更新
```

### 6.4 阿里云安全组配置

配置 Nginx 后，需要更新安全组规则：

| 规则方向 | 授权策略 | 协议类型 | 端口范围 | 授权对象 | 说明 |
|---------|---------|---------|---------|---------|------|
| 入方向 | 允许 | HTTP (80) | 80/80 | 0.0.0.0/0 | Nginx 对外服务 |
| 入方向 | 允许 | 自定义 TCP | 3000/3000 | 127.0.0.1/32 | 仅本地访问（可选） |

**建议**：可以关闭外部对 3000 端口的访问，只允许本地（127.0.0.1）访问，增强安全性。

### 6.5 验证

配置完成后访问：
```
http://101.133.166.67
```

不再需要使用 `:3000` 端口号。

---

## 附录 A：快速命令参考

```bash
# SSH 登录
ssh -i opennew.pem root@101.133.166.67

# PM2 常用命令
pm2 status              # 查看状态
pm2 logs opensynapse    # 查看日志
pm2 restart opensynapse # 重启应用
pm2 stop opensynapse    # 停止应用
pm2 delete opensynapse  # 删除进程

# PostgreSQL 常用命令
su - postgres
psql -d opensynapse
\dt                     # 查看表
\q                      # 退出

# 查看端口占用
netstat -tlnp | grep 3000
lsof -i :3000

# 查看防火墙（阿里云安全组是主要限制）
iptables -L -n | grep 3000
```

---

## 附录 B：更新部署流程

当代码更新时：

```bash
# 1. 本地构建并上传
cd /Users/lv/Workspace/OpenSynapse
npm run build
rsync -avz --exclude 'node_modules' --exclude '.git' \
  -e "ssh -i opennew.pem" \
  ./ root@101.133.166.67:/www/wwwroot/opensynapse/

# 2. 服务器上重启
ssh -i opennew.pem root@101.133.166.67 "pm2 restart opensynapse"
```

---

## 已知限制

1. **GitHub 访问**: 中国大陆服务器无法直接访问 GitHub，使用 rsync 上传代码
2. **Docker Hub**: 服务器需能拉取固定 Chroma 镜像；无法访问时可手动使用下述本机 CLI 备用方式。PostgreSQL 沿用 APT 安装。
3. **API 访问**: 如需使用 AI 功能，确保 API 密钥可用（Gemini/OpenAI 等）
4. **Chroma**: 默认 Docker，本机 CLI 手动备用；两者不同时运行，数据不自动同步。

---

**最后更新**: 2026-10-08

## Chroma 运维与本机备用

### 固定版本与数据位置

| 方式 | 数据位置 | 应用地址 |
| --- | --- | --- |
| Docker（默认，`chromadb/chroma:1.5.5`） | `chroma_data` 命名卷，容器内 `/data` | `http://127.0.0.1:8000` |
| 本机 CLI（手动备用，`chromadb==1.5.5`） | 项目 `./data/chroma` | `http://127.0.0.1:8000` |

Compose 保留逻辑卷名 `chroma_data`，实际名称通常为 `<Compose 项目名>_chroma_data`。保持原项目目录和 Compose 项目名，否则可能创建一个新卷，看起来像数据丢失。`CHROMA_URL` 只配置客户端连接地址，不决定服务器数据位置。

[官方迁移说明](https://docs.trychroma.com/updates/migration)指出新版容器默认目录从 `/chroma/chroma` 改为 `/data`。本配置使用 1.5.5 镜像自带 `/config.yaml` 的 `persist_path: /data`，移除旧 `IS_PERSISTENT`、`PERSIST_DIRECTORY`。镜像版本是服务端版本，npm `chromadb` 是独立版本的 TypeScript 客户端，二者无需版本号相同。

镜像实测含 `/bin/bash`，不含 `curl`、Python 或 `wget`。Compose 健康检查用 Bash TCP 连接请求 `/api/v2/heartbeat` 并验证 HTTP 200，而非仅检查端口。Docker 的 `timeout` 限制整个探测时间。`restart: unless-stopped` 用于进程退出和主机重启后的恢复；它不会因为 `unhealthy` 状态自动重启容器，手动停止后也不会自动启动。

### 旧容器和旧卷检查（首次应用新配置前）

先保留旧 Compose 配置，并检查现存资源；以下命令不修改数据：

```bash
docker ps -a --filter name=opensynapse-chroma
docker volume ls --filter label=com.docker.compose.volume=chroma_data
# 容器存在时执行；记录旧镜像标记、镜像 ID、实际卷名和挂载目标
docker inspect opensynapse-chroma --format '{{.Config.Image}} {{.Image}} {{json .Mounts}}'
# 正在运行时，检查真实配置和数据文件，不要只看卷是否存在
docker exec opensynapse-chroma /bin/sh -c 'cat /config.yaml 2>/dev/null; ls -la /data /chroma/chroma 2>/dev/null'
```

只有卷、没有容器时，用实际卷名替换下方占位符，先确认卷存在，再以只读方式检查卷根目录。`docker volume inspect` 失败时不要继续，避免误创建空卷：

```bash
docker volume inspect 实际旧卷名
docker run --rm --entrypoint /bin/sh \
  --mount type=volume,src=实际旧卷名,dst=/inspect,readonly \
  chromadb/chroma:1.5.5 -c 'ls -la /inspect'
```

如果旧卷已有数据，先核对原版本、配置、`chroma.sqlite3` 和索引目录的实际位置，并停止写入后备份。旧容器可能挂载 `/chroma/chroma`，但真实数据位于未挂载的 `/data`；此时必须在删除或重建旧容器前复制 `/data`。不确定时同时备份两个目录，并保留原镜像和容器。不要因为旧卷为空就认定没有数据。

目录调整不等于数据库格式迁移。先在旧数据的副本上按原版本到目标版本的官方迁移说明验证，再调整生产挂载。不要直接把较新版本数据交给较旧镜像，也不要直接对唯一数据副本试升级。回滚应恢复升级前备份并使用原镜像。本文不会自动修改或迁移已有卷。

### 日志、停止与重建

```bash
docker compose logs --tail=100 -f chroma
docker compose restart chroma
docker compose stop chroma
docker compose up -d chroma
# 仅在已备份并确认版本、卷和路径正确后重建
docker compose up -d --force-recreate chroma
```

容器重建会丢弃容器可写层，但同一个命名卷会重新挂载，卷内数据保留。`docker compose down` 默认保留命名卷，但会停止整个项目的服务，日常操作请使用上述仅针对 Chroma 的命令。`docker compose down -v` 或删除 `chroma_data` 实际卷会清除向量数据；`down -v` 还可能删除 Compose 中的 PostgreSQL 卷，不能作为重启命令。

### 备份（停写后的完整目录）

以下适用于已确认使用 `/data` 的默认 Docker 部署。旧版本请先核对路径并替换。停止应用和 Chroma，避免 SQLite 与索引文件复制时不一致；命令均在项目根目录执行：

```bash
pm2 stop opensynapse
docker compose stop chroma
CHROMA_BACKUP_DIR="$HOME/opensynapse-backups/chroma-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$CHROMA_BACKUP_DIR/data"
chmod 700 "$CHROMA_BACKUP_DIR"
docker inspect opensynapse-chroma --format '{{.Config.Image}} {{.Image}} {{json .Mounts}}' > "$CHROMA_BACKUP_DIR/source.txt"
# docker cp 支持已停止的容器；复制数据库与全部索引，不只复制 sqlite 文件
docker cp -a opensynapse-chroma:/data/. "$CHROMA_BACKUP_DIR/data/"
ls -la "$CHROMA_BACKUP_DIR/data"
docker compose up -d chroma
# 确认 healthy 后恢复应用
pm2 restart opensynapse --update-env
```

检查复制命令成功、备份包含预期文件，再恢复服务。备份目录含用户内容，应保存到受控的项目外存储，不提交 Git；备份还应定期做恢复验证。备份向量库不替代 PostgreSQL 备份，完整恢复需要配套的笔记数据。

### 恢复（只向空目标卷恢复）

先停止 PM2 和 Chroma，并保留当前卷作为回滚副本。使用与备份一致的镜像版本；如果现有目标卷非空，不要覆盖或混合文件，先由操作者另选一个空命名卷，在临时 Compose override 中让 `chroma_data.name` 指向该卷，再创建容器。后续所有 Compose 命令必须使用相同 override。

对于确认为空的默认目标卷：

```bash
# 创建但不启动容器，确保恢复前服务不会生成数据库文件
docker compose create chroma
# 检查挂载，确认容器确实使用预期的空目标卷
docker inspect opensynapse-chroma --format '{{json .Mounts}}'
# 用上一步得到的实际卷名检查目录；必须为空才继续
# docker run --rm --entrypoint /bin/sh --mount type=volume,src=实际目标卷名,dst=/inspect,readonly chromadb/chroma:1.5.5 -c 'ls -la /inspect'
CHROMA_BACKUP_DIR=/绝对路径/到/已验证的备份
docker cp -a "$CHROMA_BACKUP_DIR/data/." opensynapse-chroma:/data/
docker compose up -d chroma
docker compose ps chroma
node --env-file=.env.local --import tsx --input-type=module -e 'import { vectorStore } from "./src/vector/chroma.ts"; const result = await vectorStore.healthCheck(); console.log(result); if (!result.healthy) process.exitCode = 1;'
```

心跳成功只证明服务可访问；还应核对集合数量并抽查已知笔记的向量查询结果，再恢复 PM2 应用。

### 本机 CLI 手动备用

`npm install` 只安装 TypeScript 客户端，不会安装 `chroma` 服务端命令。推荐 Python 3.12 和独立虚拟环境，固定与 Docker 相同的服务端版本。Ubuntu 24.04 可先执行 `sudo apt-get install python3.12-venv`；其他系统先安装 Python 3.12。

```bash
cd /www/wwwroot/opensynapse
# 虚拟环境放在项目外，避免混入部署文件
python3.12 -m venv "$HOME/.venvs/opensynapse-chroma"
source "$HOME/.venvs/opensynapse-chroma/bin/activate"
python -m pip install 'chromadb==1.5.5'
# 用 Python 包元数据核对版本；CLI 自报版本可能与发行包号不同
python -c 'import importlib.metadata; print(importlib.metadata.version("chromadb"))'

# 停止 Docker 方式，释放 8000 端口
docker compose stop chroma
# 在项目根目录执行，前台运行；保持此终端开启
npm run chroma
```

该命令明确使用 `--path ./data/chroma --port 8000 --host 127.0.0.1`。另开终端执行前文客户端心跳命令，再启动或继续使用 PM2 应用。本机方式不自动启动、不自动由 PM2 托管；关闭该进程后服务停止。首次使用为空库，不会读取 Docker 命名卷。

切回 Docker：在 CLI 终端按 Ctrl+C，确认端口释放，再运行 `docker compose up -d chroma` 并检查心跳。两种方式的连接配置相同，但持久化位置独立，不会自动切换后端或同步数据。如需迁移数据，应停写、备份，并在相同版本的空目标目录中单独恢复完整目录。本机方式备份时先停止 CLI，再完整复制 `./data/chroma`；恢复也须在 CLI 停止、目标目录为空时进行，并保留文件权限。

Chroma 停止后，应用保留现有关键词检索降级逻辑，笔记同步会跳过不可用的向量库；PostgreSQL 仍须正常运行。恢复 Chroma 不会自动补齐停服期间缺失的向量，本次不增加同步机制。


### 本次兼容性验证记录（2026-10-08）

在 macOS ARM64、Docker Desktop Linux ARM64 上，使用仓库已安装的 TypeScript `chromadb@3.4.0` 和 `chromadb/chroma:1.5.5` 实测。拉取的镜像摘要为 `sha256:0771874eaffc80fb4a66ba4de41a8fadf0447240b08d92353450e26ee43c9355`。本机 CLI 使用 Python 3.12.13 和 [官方 `chromadb==1.5.5` 包](https://pypi.org/project/chromadb/1.5.5/)。

- Compose 配置校验通过；隔离 Compose 项目仅启动 Chroma，健康检查返回 `healthy`。
- 现有 `vectorStore` 心跳、添加、批量 upsert、查询、元数据过滤、更新和删除通过，测试显式提供三维向量，不调用外部 embedding API。
- 隔离命名卷写入后强制重建容器，原数据仍可查询；停服复制完整 `/data`，恢复到另一空卷后亦可查询。
- 临时目录复用原 `npm run chroma` 脚本，确认生成 `./data/chroma/chroma.sqlite3` 和索引目录，停止并重启 CLI 后原数据仍可查询。未操作项目已有 `data/chroma`。
- 真实 Chroma 停止后，运行现有 `hybridSearch` 返回 `sources: ['keyword']`。此项仅将 PostgreSQL repository 查询替换为内存笔记，不是登录态与真实数据库的端到端测试。
- 测试容器、卷、网络和本机服务已清理或停止；原 PostgreSQL 未改动。生产 Ubuntu 主机尚未部署验证，部署时仍需检查心跳。

客户端会提示缺少默认 embedding function 包，但显式传入向量的上述操作成功；本次保留现有业务逻辑。首次执行 `npm run lint` 时，历史 Firebase 迁移脚本因缺少 `firebase-admin` 阻塞检查；后续已将该脚本移至 `scripts/archive`，排除在日常类型检查之外，重新执行 `npm run lint` 通过。详见[归档说明](../scripts/archive/README.md)。
