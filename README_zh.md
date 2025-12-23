# NanoVault

一个运行在 Cloudflare Workers 上的轻量级 Bitwarden 兼容服务器。

## 功能特性

### ✅ 已支持

- **认证**: 邮箱验证注册、JWT access/refresh token、密码/邮箱修改
- **保险库**: 完整同步、密码项 CRUD（登录、安全笔记、银行卡、身份、SSH 密钥）、文件夹 CRUD、批量导入、软删除/恢复
- **安全**: 服务端密码哈希、SecurityStamp token 失效机制
- **存储**: Cloudflare KV + R2、等效域名（全局和自定义）
- **推送通知** (可选): 通过 Bitwarden 中继服务实现移动端同步

### ❌ 暂不支持

- 组织 / 共享
- 双因素认证 (2FA)
- 附件
- 紧急访问
- Send（安全分享）
- WebAuthn / 通行密钥
- 无密码登录
- WebSocket 实时同步
- 邮件发送（token 打印到控制台）

## 安装配置

1. **安装依赖**
   ```bash
   npm install
   ```

2. **配置 Cloudflare 资源**
   ```bash
   wrangler kv:namespace create DB
   wrangler r2 bucket create nanovault-storage
   wrangler secret put JWT_SECRET
   ```

3. **更新 `wrangler.toml`** 填入 KV 命名空间 ID

## 开发

```bash
npm test        # 运行测试
npm run dev     # 启动开发服务器
npm run deploy  # 部署到 Cloudflare
```

## 客户端配置

将 Bitwarden 客户端（自托管）指向：`https://nanovault.<your-subdomain>.workers.dev`

## 推送通知（可选）

1. 从 https://bitwarden.com/host/ 获取凭证
2. 在 `wrangler.toml` 中配置：
   ```toml
   [vars]
   PUSH_ENABLED = "true"
   PUSH_INSTALLATION_ID = "your-id"
   PUSH_INSTALLATION_KEY = "your-key"
   ```

> ⚠️ 仅支持官方 App Store / Google Play 版本的 Bitwarden App
