# CF Worker 优选 IP 批量订阅生成器

一个专门给 **自建节点** 用的 Cloudflare Workers 项目。

它不负责找优选 IP，只负责把你已经找好的优选 IP / 优选域名，批量替换进你自己的节点，然后输出为：

- **原始订阅**：适合 **V2rayN / Shadowrocket**
- **Clash 订阅**：适合 **Clash / Mihomo / Clash Verge**
- **Surge 订阅**：适合 **Surge**（当前以 VMess / Trojan 为主）

---

## 适用场景

你已经有：

1. 一台 VPS
2. 已搭好的 3X-UI / Xray 节点
3. 一个通过域名访问的节点，例如 VMess WS TLS
4. 一批自己测速得到的 Cloudflare 优选 IP

你想要：

- 导入一个自建节点
- 一次性导入 10 个优选 IP
- 自动生成 10 个“替换 server 为优选 IP”的节点
- 生成一条订阅链接，让客户端直接导入

这个项目就是为这个场景写的。

---

## 当前支持

### 导入

- `vmess://`
- `vless://`
- `trojan://`
- 也支持直接粘贴 **base64 原始订阅内容**

### 导出

- `raw`：V2rayN / Shadowrocket 推荐
- `clash`：Clash / Mihomo 推荐
- `surge`：Surge 推荐（当前主要保证 VMess / Trojan）
- `json`：调试用

### 优选地址输入格式

支持：

```txt
104.16.1.2
104.16.1.2:2053
104.16.1.2#HK-01
104.16.1.2:2053#HK-02
cf.example.com#US-Edge
cf.example.com:443#US-Edge
```

---

## 设计说明

### 1. 不落库

本项目默认 **不使用 KV / D1 / R2**，也不把节点长期存储在 Cloudflare 上。

网页提交后，Worker 会：

1. 解析节点
2. 批量替换优选 IP
3. 用 `SUB_LINK_SECRET` 把节点内容加密成一个 token
4. 返回形如 `/sub/<token>?target=clash` 的订阅链接

这样做的好处：

- 部署简单
- 不需要数据库
- 自建使用更方便

### 2. 保留原 Host / SNI

默认会保留原始节点的：

- `Host`
- `SNI`

同时只替换：

- `server / add`
- 如果优选地址里带端口，也会替换端口

这更符合你“自建域名接入 Cloudflare，再用优选 IP 接入”的使用方式。

---

## 目录结构

```txt
cf-worker-ip-sub-web/
├─ public/
│  ├─ index.html
│  ├─ app.js
│  └─ styles.css
├─ src/
│  ├─ core.js
│  └─ worker.js
├─ tests/
│  └─ smoke.mjs
├─ .dev.vars.example
├─ .gitignore
├─ package.json
├─ README.md
└─ wrangler.toml
```

---

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 配置本地密钥

复制一份：

```bash
cp .dev.vars.example .dev.vars
```

然后修改：

```env
SUB_LINK_SECRET="请替换成你自己的长随机字符串"
```

### 3. 启动本地调试

```bash
npm run dev
```

### 4. 跑一次冒烟测试

```bash
npm run check
```

---

## 上传到 GitHub

### 方法 A：网页上传

1. 在 GitHub 创建一个新仓库，例如：`cf-worker-ip-sub-web`
2. 把本项目文件全部上传
3. 提交到 `main` 分支

### 方法 B：命令行上传

```bash
git init
git add .
git commit -m "init project"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

---

## 部署到 Cloudflare Workers

你有两种方式。

---

### 方式 1：本地 Wrangler 直接部署（最简单）

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

### 2. 修改 Worker 名称

打开 `wrangler.toml`：

```toml
name = "cf-worker-ip-sub-web"
```

改成你自己的 Worker 名称，例如：

```toml
name = "my-ip-sub"
```

### 3. 设置密钥

```bash
npx wrangler secret put SUB_LINK_SECRET
```

终端会提示你输入一串密钥，建议使用长度较长的随机字符串。

### 4. 部署

```bash
npm run deploy
```

部署成功后，你会拿到一个地址，例如：

```txt
https://my-ip-sub.<你的子域>.workers.dev
```

打开即可使用。

---

### 方式 2：GitHub 仓库接入 Cloudflare 自动部署

### 1. 先把项目上传到 GitHub

确保仓库里已经包含：

- `wrangler.toml`
- `package.json`
- `src/worker.js`
- `public/`

### 2. 进入 Cloudflare 后台

打开：

- **Workers & Pages**
- **Create application**
- **Import a repository**

### 3. 选择 GitHub 仓库

选中你的这个仓库并完成导入。

### 4. 设置密钥

导入完成后，进入：

- Worker
- **Settings**
- **Variables and Secrets**

添加：

- 名称：`SUB_LINK_SECRET`
- 类型：**Secret**
- 值：你自己的长随机字符串

### 5. 重新部署

保存后重新触发部署，或者直接推送一次新的 commit。

---

## 使用方法

### 1. 打开网页

访问你的 Worker 域名，例如：

```txt
https://my-ip-sub.<你的子域>.workers.dev
```

### 2. 粘贴自建节点

例如：

```txt
vmess://xxxxx
```

### 3. 粘贴优选 IP

例如：

```txt
104.16.1.2#HK-01
104.17.2.3#HK-02
104.18.3.4:2053#US-01
```

### 4. 点击“生成订阅”

页面会返回：

- 自动识别链接
- 原始订阅链接
- Clash 订阅链接
- Surge 订阅链接

---

## 客户端导入说明

### V2rayN

使用：

- **原始订阅链接**

在 V2rayN 中选择：

- 订阅分组
- 添加订阅
- 粘贴 `raw` 链接

---

### Shadowrocket

使用：

- **原始订阅链接**

新增一个订阅，把 `raw` 链接粘贴进去即可。

---

### Clash / Mihomo / Clash Verge

使用：

- **Clash 订阅链接**

把 `?target=clash` 这个链接作为配置订阅导入。

---

### Surge

使用：

- **Surge 订阅链接**

把 `?target=surge` 的链接作为托管配置导入。

> 注意：当前 Surge 导出优先覆盖 **VMess / Trojan** 常见场景。你的示例 VMess 节点适用。

---

## API

### 1. 生成订阅

`POST /api/generate`

请求示例：

```json
{
  "nodeLinks": "vmess://...",
  "preferredIps": "104.16.1.2#HK\n104.17.2.3#US",
  "namePrefix": "CF",
  "keepOriginalHost": true
}
```

响应示例：

```json
{
  "ok": true,
  "token": "xxxx",
  "urls": {
    "auto": "https://example.workers.dev/sub/xxxx",
    "raw": "https://example.workers.dev/sub/xxxx?target=raw",
    "clash": "https://example.workers.dev/sub/xxxx?target=clash",
    "surge": "https://example.workers.dev/sub/xxxx?target=surge",
    "json": "https://example.workers.dev/sub/xxxx?target=json"
  }
}
```

### 2. 获取订阅

```txt
GET /sub/<token>?target=raw
GET /sub/<token>?target=clash
GET /sub/<token>?target=surge
GET /sub/<token>?target=json
```

如果不带 `target`，Worker 会尝试根据客户端 `User-Agent` 自动判断。

---

## 限制

### 1. 当前更偏向 Cloudflare CDN 场景

也就是：

- 域名接入 Cloudflare
- 节点使用 WS/TLS 等常见接入方式
- 用优选 IP 替换目标地址

### 2. Surge 导出不是全协议全场景覆盖

本项目目前优先保证：

- **VMess WS TLS**
- **Trojan WS TLS**

如果你后续需要再补 Reality / gRPC / H2 / 更多客户端格式，可以继续扩展 `src/core.js`。

### 3. 订阅链接仍然属于敏感信息

虽然 token 是加密过的，但任何拿到订阅链接的人，都能继续使用该订阅。

所以：

- 不要公开分享
- 不要放到公开仓库 README
- 不要发到公开群里

---

## 后续可扩展方向

你后面如果想继续迭代，很容易往下加：

- 支持批量导入多个原始节点
- 支持 VLESS Reality 的更完整转换
- 支持 sing-box 专用导出
- 接入 KV，生成更短、更稳定的订阅路径
- 添加密码访问或一次性访问 token
- 增加导入二维码 / 文件导入

---

## 许可证

MIT
