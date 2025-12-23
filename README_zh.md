# Nanovault

一个运行在 Cloudflare Workers 上的轻量级 Bitwarden 兼容服务器。

## 功能特性

### ✅ 已支持

**认证与账户**
- 邮箱验证注册流程 (`/identity/accounts/register/finish`)
- 基于 JWT 的认证，区分 access/refresh token
- 密码修改（自动使旧 token 失效）
- 邮箱修改（带验证 token）
- 预登录 KDF 设置 (PBKDF2 / Argon2)

**保险库管理**
- 完整保险库同步
- 密码项 CRUD（登录、安全笔记、银行卡、身份、SSH 密钥）
- 文件夹 CRUD
- 批量导入（密码项和文件夹）
- 软删除 / 从回收站恢复
- 密码历史记录支持

**安全特性**
- 服务端密码哈希（带盐值）
- Token 类型区分（access vs refresh）
- SecurityStamp 用于 token 失效

**存储**
- Cloudflare KV 存储用户数据
- Cloudflare R2 存储加密保险库
- 等效域名（全局和自定义）

**移动端推送通知**（可选）
- 需要从 https://bitwarden.com/host/ 获取凭证
- 仅支持官方 Bitwarden App（App Store / Google Play）
- 保险库变更时自动同步

### ❌ 暂不支持

- 组织 / 共享
- 双因素认证 (2FA)
- 附件上传/下载
- 紧急访问
- Send（安全分享）
- WebAuthn / 通行密钥
- 认证请求 / 无密码登录
- WebSocket 实时同步 (`/notifications/hub`)
- 邮件发送（自托管环境：token 打印到控制台）

## 项目结构

```
src/
├── index.ts          # 路由 (~30 行)
├── types.ts          # 类型定义
├── api/
│   ├── auth.ts       # 预登录、注册、Token、密码/邮箱修改
│   ├── sync.ts       # 同步、个人资料
│   ├── ciphers.ts    # 密码项 CRUD
│   ├── folders.ts    # 文件夹 CRUD
│   └── config.ts     # 服务器配置和存根
├── storage/
│   ├── kv.ts         # KV 操作
│   └── s3.ts         # R2/S3 操作
└── constants/
    └── domains.ts    # 全局等效域名
```

## 安装配置

1. **安装依赖**
   ```bash
   npm install
   ```

2. **配置 Cloudflare 资源**
   - **KV 命名空间**：创建命名空间并更新 `wrangler.toml` 中的 ID。
     ```bash
     wrangler kv:namespace create DB
     ```
   - **R2 存储桶**：创建名为 `nanovault-storage` 的存储桶（或更新 `wrangler.toml`）。
     ```bash
     wrangler r2 bucket create nanovault-storage
     ```

3. **密钥配置**
   - 设置 `JWT_SECRET` 用于签名 token。
     ```bash
     wrangler secret put JWT_SECRET
     ```

## 开发

```bash
# 运行测试
npm test

# 启动开发服务器
npm run dev
```

## 部署

```bash
npm run deploy
```

## 客户端配置

将你的 Bitwarden 客户端（自托管）指向 Worker URL：`https://nanovault.<your-subdomain>.workers.dev`

## API 端点

### 认证

| 端点 | 方法 | 描述 |
|------|------|------|
| `/identity/accounts/prelogin` | POST | 获取 KDF 参数 |
| `/identity/accounts/register/send-verification-email` | POST | 发起注册 |
| `/identity/accounts/register/finish` | POST | 完成注册 |
| `/identity/connect/token` | POST | 登录 / 刷新 token |
| `/api/accounts/password` | POST | 修改密码 |
| `/api/accounts/email-token` | POST | 发起邮箱修改 |
| `/api/accounts/email` | POST | 完成邮箱修改 |

### 保险库

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/sync` | GET | 完整保险库同步 |
| `/api/ciphers` | POST | 创建密码项 |
| `/api/ciphers/:id` | GET/PUT/DELETE | 密码项 CRUD |
| `/api/ciphers/import` | POST | 批量导入 |
| `/api/folders` | POST | 创建文件夹 |
| `/api/folders/:id` | GET/PUT/DELETE | 文件夹 CRUD |

### 设置

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/accounts/profile` | GET | 用户资料 |
| `/api/accounts/revision-date` | GET | 保险库修订日期 |
| `/api/settings/domains` | GET/PUT | 等效域名 |
| `/api/config` | GET | 服务器配置 |
| `/health` | GET | 健康检查 |
