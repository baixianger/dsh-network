# DSH Network

[English](README.md) | [简体中文](README.zh.md)

> 让同一台 DeepSeek Harness Host 通过局域网、Tailnet 或自建公网 HTTPS 地址安全接入。

`dsh-network` 是一个独立的 DSH Host 插件。它让 DSH 继续只监听
`127.0.0.1`，在外层提供带身份验证的网关，并为每台 Host 保存稳定的
`hostId`。客户端因此可以把局域网、Tailnet 和公网地址识别为同一台 Host，
而不会重复添加。

## 核心能力

- **一台 Host，多条路由**：在家使用局域网地址，外出时使用 Tailscale 私有地址，
  或接入你自己维护的公网 HTTPS 地址。
- **扫码配对**：可以在终端或 DSH 设置页生成短时有效、仅能使用一次的配对二维码。
- **面向客户端的凭据机制**：访问凭据和刷新凭据会轮换，Host 端只持久化凭据哈希。
- **长会话传输优化**：默认裁剪历史记录中不会显示的冗余流式增量，
  保留 DSH 实际渲染的消息与分页语义。
- **DSH 核心服务不直接暴露**：核心 Web 服务仍在回环地址上，远程流量统一经过认证网关。

| 接入方式 | 发现 / 配置 | 客户端使用的地址 |
| --- | --- | --- |
| 家庭 / 局域网 | 二维码或粘贴配对链接 | 本机网关的局域网地址 |
| Tailnet | 二维码或手动配置 | Tailscale Serve 的 MagicDNS HTTPS 地址 |
| 公网 Host | 二维码或手动配置 | 用户自行维护的 HTTPS 地址 |

## 快速开始

前置条件：

- Node.js 22 或更高版本；
- 已安装并能正常运行的 `dsh` CLI；
- 局域网配对时，手机与 Host 之间可相互访问。

安装插件并启动 DSH Web：

```bash
dsh plugin --profile web add dsh-network@next
dsh web
```

插件默认在 `3081` 端口启动认证网关；DSH 本身继续只监听回环地址的
`3080` 端口。

在另一个终端运行配置向导：

```bash
dsh plugin --profile web exec dsh-network setup

# 1. 局域网 / 家庭网络
# 2. Tailscale / Tailnet
# 3. 自定义地址
```

不指定模式时，向导会明确询问要放入二维码的路由，不会默认选择。
用客户端扫描生成的二维码即可完成配对。

## 设置页

插件会通过 `settings.section` 槽位向 DSH 设置中添加 **Network** 页面。这里会显示：

- Host 标识；
- 网关地址；
- 已配对设备数量；
- 新的配对二维码。

地址留空时会自动检测局域网 URL；也可粘贴 Tailnet 或公网 HTTPS URL，
把指定路由写入二维码。

## 选择接入方式

### 局域网

DSH Host 运行后，生成包含局域网地址的二维码：

```bash
npx dsh-network setup lan
```

如果 Host 有多个私有网卡，自动检测的地址不是手机可访问的那个，可以显式指定：

```bash
npx dsh-network setup lan --url http://HOST:3081
```

局域网模式会验证客户端身份，但传输层依赖可信的本地网络。
**不要把这个 HTTP 地址暴露到公网。**

### Tailnet

请先安装 Tailscale 并登录。以下命令会配置 Tailscale Serve，把私有的
MagicDNS HTTPS 地址转发到认证网关，然后输出配对二维码：

```bash
npx dsh-network setup tailscale
```

二维码只需向客户端提供一次 MagicDNS URL，客户端会记住这条路由。

### 自定义地址

在配置向导中选择第 3 项，粘贴一个已经能访问认证网关的地址；也可以直接传入：

```bash
npx dsh-network setup custom --url https://dsh.example.com
```

### 公网 HTTPS Host

插件不会自动发现公网服务。请先用你信任的 HTTPS 反向代理代理网关端口
`3081`，再生成包含该 URL 的二维码：

```bash
npx dsh-network pair --url https://dsh.example.com
```

**不要直接暴露 DSH 的 `3080` 端口。** 公网模式必须使用 TLS，并建议在云服务商或反向代理中配置防火墙与限流。

`dsh-network` 不会安装或修改反向代理、容器、防火墙、证书、DNS 或托管面板；
它只接收用户已经搭建并能正常访问的 HTTPS 地址。详见
[`docs/internet-compatibility.md`](docs/internet-compatibility.md)。

## 配对与凭据生命周期

1. 二维码中包含一个随机的单次配对票据，有效期为 5 分钟。
2. 配对成功后，设备会获得刷新凭据和有效期为 1 小时的访问令牌。
3. 客户端会自动刷新，两类凭据都会轮换。
4. Host 只将凭据哈希保存在 `~/.dsh/network/state.json` 中。
5. 配对链接按需生成，不会广播。

已认证的 iPhone 浏览器打开 DSH 时，Web 客户端可以新建一个仅有效 1 分钟的
App 专用票据，将同一台 Host 交接给 DSH iOS App。浏览器 Cookie 与 iOS Keychain
凭据相互独立。

网关会限制配对尝试频率。在稳定版发布前，设备列表和撤销功能会继续完善并暴露到 DSH 设置界面。

## 长会话历史裁剪

长时间的 Agent 回合可能产生大量 `assistant/chunk` 流式增量，每次读取历史都需要序列化它们。
`dsh-network` 会用精确路由覆盖 `/api/session.history` 和 `/api/subagents.history`，
移除不会成为显示行的增量事件：

- 已结束步骤由最终 `assistant/message` 表示；
- 仅保留进行中步骤的部分内容；
- 每个已结束步骤保留第一个 token 增量，用于首 token 时间统计；
- `hasMore` 和 `projections` 保持不变。

在长会话中，这通常可以减少 80–95% 的网络传输体积。该功能默认开启，可在插件配置中关闭或调整信任 Host：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: dsh-network
  config:
    gatewayPort: 3081
    historyChunkTrim: false        # 设为 false 后返回未裁剪的历史页
    # historyTrustedHosts:         # Web 服务监听 0.0.0.0 且客户端通过 LAN 直连时，
    #   - 192.168.1.5:3080         # 与 client-connection 的 trustedHosts 保持一致
```

裁剪路由复用 DSH 核心 `/api` 路由的 Host、跨站与 Origin 限制；原本会被核心路由拒绝的请求，在这里同样会被拒绝。

## 可选的 iOS 下载卡片

当 iOS App 有可用的 App Store 或 TestFlight HTTPS 地址后，可以在插件配置中设置
`iosAppDownloadURL`：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: dsh-network
  config:
    iosAppDownloadURL: https://apps.apple.com/app/id6802863224
```

本地 Web 客户端会在首次符合条件的浏览器启动时显示一张小型、可关闭的下载卡片。
卡片使用 DSH 的叠加式 `shell.overlay` 槽位，不会替换或重排应用外壳。未配置 URL 时不显示。

## 平台说明

局域网模式使用普通 HTTP 地址，Tailnet 模式使用 Tailscale Serve 提供的 HTTPS。
Linux 和 Windows 可能需要在主机防火墙中允许 DSH 进程从可信私有网络访问 TCP `3081` 端口。

## 常见问题

### 手机无法打开局域网地址

确认手机和 Host 在同一个可相互访问的网络中，并在 Host 防火墙允许 TCP `3081`。
如果自动检测选错网卡，重新运行 `setup lan --url http://HOST:3081`。

### Tailscale 配置失败

先确认 Tailscale 已安装并登录，且 `tailscale status` 能正常运行，再重试
`setup tailscale`。

### 公网 URL 无法连接

确认反向代理同时转发 HTTP 和 WebSocket 流量到 `3081` 端口，并确保客户端信任该 HTTPS 证书。

### 二维码已过期或已使用

请重新生成二维码。配对票据设计为仅能使用一次，且有效期只有 5 分钟。

## 开发

```bash
npm test
npm run check
```

## 许可证

MIT © Xiang Bai
