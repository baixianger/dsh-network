# DSH Network

[English](README.md) | [简体中文](README.zh.md)

> Securely connect to one DeepSeek Harness Host over your LAN, Tailnet, or public HTTPS route.

`dsh-network` is an independent DSH Host plugin. It keeps DSH bound to
`127.0.0.1`, places an authenticated gateway in front of it, and gives every
Host a persistent `hostId` so clients can merge multiple routes to one Host.

## What it gives you

- **One Host, multiple routes** — use a local address at home, a private Tailscale
  address away from home, or your own public HTTPS endpoint without creating
  duplicate Hosts in the client.
- **Scan-to-pair access** — create a short-lived, single-use QR code from the
  terminal or the DSH Settings page.
- **Credentials designed for clients** — access and refresh credentials rotate;
  only hashes are persisted by the Host.
- **Smaller long-session responses** — optional history chunk trimming removes
  redundant streaming deltas while preserving the messages rendered by DSH.
- **No public exposure of DSH itself** — the core Web server stays on loopback;
  remote traffic goes through the authenticated gateway.

| Route | Discovery | Address |
| --- | --- | --- |
| Home / LAN | QR or pasted pairing link | Gateway on the local machine |
| Tailnet | QR or manual | Tailscale Serve MagicDNS URL |
| Public Host | QR or manual | User-managed HTTPS URL |

## Quick start

```bash
dsh plugin --profile web add dsh-network@next
dsh web
```

The plugin starts its authenticated gateway on port `3081`. DSH itself remains
on loopback port `3080`.

In another terminal, run the setup assistant. With no mode supplied it always
asks which route to place in the QR code; it never silently selects one:

```bash
dsh plugin --profile web exec dsh-network setup

# 1. LAN / home network
# 2. Tailscale / Tailnet
# 3. Custom address
```

Scan the generated QR code with your client. For LAN setup, the phone and Host
must be able to reach each other on the same trusted network.

### Optional iOS download card

Once the iOS app has a real App Store or TestFlight HTTPS URL, set
`iosAppDownloadURL` in the `dsh-network` plugin config. The local Web client
then shows one small, dismissible download card on its first eligible browser
launch. It uses DSH's additive `shell.overlay` slot and never replaces or
reflows the application shell. With no URL configured, no card is shown.

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: dsh-network
  config:
    iosAppDownloadURL: https://apps.apple.com/app/id6802863224
```

## History chunk trimming

Long agent turns emit a huge number of streaming `assistant/chunk` frames (a
single turn can produce 95k+ deltas), and every history read serializes all of
them — a 50-message tail can weigh tens of megabytes. `dsh-network` shadows
`/api/session.history` and `/api/subagents.history` with exact routes and
removes the chunks that never surface as display rows: settled steps are fully
replaced by their final `assistant/message`, so only the in-progress step's
partial and each settled step's first token-delta (for first-token timing) are
kept. The response is otherwise byte-identical, `hasMore`/`projections` are
untouched, and both the Web GUI and the iOS client fold the trimmed page the
same way they fold the full one — typically 80–95% smaller over the wire.

Enabled by default; disable it or tune the fence in the plugin config:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: dsh-network
  config:
    gatewayPort: 3081
    historyChunkTrim: false        # set false to serve the untrimmed page
    # historyTrustedHosts:         # mirror client-connection trustedHosts when
    #   - 192.168.1.5:3080         # the web server binds 0.0.0.0 and clients
    #                             # reach it directly by LAN address
```

The trim routes reuse the same Host/cross-site/origin fence as the core `/api`
route; requests that would have been refused there are refused here too.

## Settings page

The plugin also contributes a **Network** page to DSH Settings (via the
`settings.section` slot). It shows the Host identity, gateway address, and
paired-device count, and can mint a fresh pairing QR right from the browser —
no terminal needed. Leave the address field empty to auto-detect the LAN URL,
or paste a Tailnet / public HTTPS URL to place that route in the QR code.

## Choose a connection route

## Pair on the LAN

With the DSH Host running, generate a QR containing a private LAN address and
scan it in the iOS app:

```bash
npx dsh-network setup lan
```

Use `--url http://HOST:3081` if the machine has multiple private interfaces and
the automatically selected address is not the one the phone can reach. LAN
mode authenticates the client but uses the trusted local network for transport;
do not use its HTTP URL over the public internet.

## Configure a Tailnet

Tailscale must already be installed and signed in. This command configures
Tailscale Serve to forward the private MagicDNS HTTPS URL to the authenticated
gateway, then prints a pairing QR code:

```bash
npx dsh-network setup tailscale
```

The QR code supplies the MagicDNS URL to the iOS app once; the app then
remembers the route.

## Custom address

Choose option 3 in the setup assistant and paste an address that already
reaches the authenticated gateway, or provide it explicitly:

```bash
npx dsh-network setup custom --url https://dsh.example.com
```

## Public HTTPS Host

Public discovery is intentionally unsupported. Put port `3081` behind a
trusted HTTPS reverse proxy, then generate a QR code containing that URL:

```bash
npx dsh-network pair --url https://dsh.example.com
```

Do not expose DSH port `3080` itself. Public mode requires TLS and should also
use provider firewall and rate-limit controls.

The plugin does not install or edit a reverse proxy, container, firewall,
certificate, DNS record, or hosting panel. It only accepts the working HTTPS
address that the user already operates. See
[`docs/internet-compatibility.md`](docs/internet-compatibility.md) for the
public Host boundary.

## Credential lifecycle

1. The QR contains a random, single-use pairing ticket valid for five minutes.
2. Pairing issues a device refresh credential and a one-hour access token.
3. The client refreshes automatically and both credentials rotate.
4. Only credential hashes are stored under `~/.dsh/network/state.json`.
5. Pairing links are generated on demand and are never broadcast.

When an authenticated iPhone browser opens DSH, the web client can mint a new
one-minute, app-only ticket and hand the same Host to the DSH iOS app. Browser
cookies and iOS Keychain credentials remain separate.

The gateway rate-limits pairing attempts. Device listing and revocation will be
exposed in the DSH settings UI before a stable release.

## Platform support

LAN setup uses ordinary HTTP addressing and Tailnet setup uses Tailscale's
HTTPS Serve. Linux and Windows may require allowing the DSH process through the
host firewall for TCP `3081` on trusted private interfaces.

## Troubleshooting

- **The phone cannot open the LAN address:** make sure both devices are on the
  same network, allow inbound TCP `3081` in the Host firewall, and rerun setup
  with `--url http://HOST:3081` if auto-detection chose the wrong interface.
- **Tailscale setup fails:** install Tailscale, sign in, and confirm that
  `tailscale status` works before running `setup tailscale` again.
- **A public URL does not connect:** verify that the reverse proxy forwards both
  HTTP and WebSocket traffic to port `3081`, and that its TLS certificate is
  trusted by the client.
- **A QR code expired:** generate another one. Pairing tickets are deliberately
  single-use and valid for five minutes.

For the exact public deployment boundary, see
[`docs/internet-compatibility.md`](docs/internet-compatibility.md).

## Development

```bash
npm test
npm run check
```

## License

MIT © Xiang Bai
