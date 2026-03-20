# Mind Keeper 部署指南

## 两种运行模式

### 模式 A：本机客户端（个人开发用）

```bash
# 安装
git clone <repo> && cd mind-keeper
npm ci && npm run build

# 运行 MCP (AntiGravity 自动启动)
node dist/index.js

# 运行 Dashboard
npm run http
# 打开 http://127.0.0.1:6700
```

AntiGravity `settings.json`:
```json
{
  "mcpServers": {
    "mind-keeper": {
      "command": "node",
      "args": ["D:/projects/mind_keeper/dist/index.js"]
    }
  }
}
```

---

### 模式 B：服务器部署（多终端共享）

#### 方式 1: Docker (推荐)

```bash
# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

数据持久化在 Docker volume `mind-keeper-data`。

#### 方式 2: 直接运行

```bash
npm ci && npm run build
node dist/http.js --host 0.0.0.0 --port 6700 --project-root /path/to/data
```

---

## 其他电脑接入服务器

其他电脑安装 Mind Keeper 后，配置 AntiGravity `settings.json`:

```json
{
  "mcpServers": {
    "mind-keeper": {
      "command": "node",
      "args": [
        "D:/projects/mind_keeper/dist/mcp-proxy.js",
        "--server", "http://192.168.x.x:6700"
      ]
    }
  }
}
```

这样 AntiGravity 以为是本地 MCP，实际操作远程服务器。

Dashboard 直接浏览器打开: `http://192.168.x.x:6700`

---

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `MIND_KEEPER_HTTP_PORT` | HTTP 端口 | 6700 |
| `MIND_KEEPER_HTTP_HOST` | 绑定地址 | 127.0.0.1 |
| `MIND_KEEPER_PROJECT_ROOT` | 默认项目根目录 | 无 |
| `MIND_KEEPER_SERVER` | Proxy: 远程服务器地址 | http://127.0.0.1:6700 |
| `OPENAI_API_KEY` | Embedding API Key | 无 |
