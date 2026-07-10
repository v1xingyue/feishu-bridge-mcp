# Feishu Bridge

部署在 Vercel 上的飞书 MCP Server 与内容工作台。

## 1. 创建飞书应用

OAuth 登录仅申请一个用户权限：

- `contact:user.base:readonly`（获取登录用户基本信息）

Bot/应用按需要开启业务权限：

- `drive:drive`（管理应用拥有或被授权的云空间文件）
- `docx:document`（创建、读取和编辑新版文档）
- `calendar:calendar`（创建、读取、修改和删除共享日历）
- `calendar:calendar.event:read`（读取日程）
- `calendar:calendar.event:create`（创建日程）
- `calendar:calendar.event:update`（编辑日程）
- `calendar:calendar.event:delete`（删除日程）

业务接口全部使用应用身份，只能操作应用创建或明确共享给应用的内容，不会读取登录用户的个人云空间和私人日历。

## 2. 本地运行

```bash
cp .env.example .env
npm install
npm run dev
```

使用 `openssl rand -hex 32` 分别生成 `AUTH_SECRET` 和 `MCP_JWT_SECRET`，写入 `.env`。两者不能相同，重启时也不要重新生成。

打开 `http://localhost:3000`。页面会显示当前域名对应的 OAuth 回调地址，将它加入飞书应用的重定向 URL 白名单。

## 3. 部署 Vercel

导入此仓库，在 Vercel 项目 Settings → Environment Variables 中添加：

```text
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
AUTH_SECRET=固定的NextAuth随机密钥
MCP_JWT_SECRET=独立的MCP随机密钥
FEISHU_ALLOWED_OPEN_IDS=ou_reader1,ou_reader2
FEISHU_ADMIN_OPEN_IDS=ou_admin
```

在飞书应用的「安全设置 → 重定向 URL」添加：

```text
https://你的域名/api/auth/callback/feishu
```

随后重新发布飞书应用并部署。`AUTH_SECRET` 只负责 NextAuth 登录会话，`MCP_JWT_SECRET` 只负责 MCP JWT；登录后可在「MCP 接入」页生成 30、180 或 360 天有效的 JWT。

`ou_xxx` 是登录用户在当前飞书应用中的 `open_id`，不是部门 ID。用户可以完成 OAuth 身份认证，但只有允许名单可以读取内容；管理员名单自动拥有读取、创建、修改、删除及生成 MCP Token 的权限。两个名单都未配置时，登录后的所有业务操作默认拒绝。页面右上角和权限错误会显示当前用户的 `open_id`，便于配置名单。名单变更后，旧网页会话会在下一次请求时重新校验；已移出管理员名单的 MCP Token 也会立即失效。

### `JWEDecryptionFailed`

这表示浏览器中的 NextAuth Cookie 由另一个 `AUTH_SECRET` 加密。确认 `.env` 和 Vercel 中的 `AUTH_SECRET` 没有被重新生成，然后清除本站的 `next-auth.session-token` / `__Secure-next-auth.session-token` Cookie，重新登录飞书。旧 Cookie 在密钥变化后无法恢复。

- 修改 `AUTH_SECRET`：所有网页登录会话失效。
- 修改 `MCP_JWT_SECRET`：所有已生成的 MCP JWT 失效，不影响网页登录。

## 4. 连接 MCP 客户端

- URL：`https://你的域名/api/mcp`
- Transport：Streamable HTTP
- Header：`Authorization: Bearer <JWT_TOKEN>`

MCP 提供文档列表、文章 CRUD、日历 CRUD 和日程 CRUD，共 13 个工具。
