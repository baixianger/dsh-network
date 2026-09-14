<div align="center">

<img src="docs/assets/hero.svg" alt="DSH Network" width="100%" />

# DSH Network

[English](README.md) · [简体中文](README.zh.md)

[![npm](https://img.shields.io/npm/v/dsh-network?style=flat-square&color=374151)](https://www.npmjs.com/package/dsh-network) [![License: MIT](https://img.shields.io/badge/License-MIT-374151?style=flat-square)](LICENSE) [![DSH plugin](https://img.shields.io/badge/DSH-plugin-374151?style=flat-square)](https://github.com/topics/dsh-plugin)

</div>

Reach your DeepSeek Harness host from your LAN, Tailnet, or an existing HTTPS endpoint. Pair a client once and keep multiple routes attached to the same host identity.

## One host, several ways to connect

| Route | Address | Setup |
| --- | --- | --- |
| **LAN** | A reachable local gateway address | Choose LAN and scan the pairing QR. |
| **Tailnet** | A Tailscale Serve MagicDNS HTTPS URL | Choose Tailscale on an already signed-in host. |
| **Custom HTTPS** | Your working reverse-proxy URL | Supply the address when creating the QR. |

DSH stays on loopback. The plugin puts an authenticated gateway in front of it, with short-lived pairing tickets, rotating device credentials, and a persistent host ID.

## Quick start

```bash
dsh plugin --profile web add dsh-network@latest
dsh web
```

Open **Settings → Network** to see the host and create a pairing QR, or use the setup assistant in another terminal:

```bash
dsh plugin --profile web exec dsh-network setup
```

Choose **LAN**, **Tailscale**, or **Custom address**. The assistant asks when no mode is supplied. Scan the result with a compatible client.

The default gateway listens on port `3081`. DSH's underlying Web server remains bound to loopback at its configured port.

## Choose your route

```bash
# LAN: both devices must be able to reach each other
dsh plugin --profile web exec dsh-network setup lan

# Tailnet: requires Tailscale already installed and signed in
dsh plugin --profile web exec dsh-network setup tailscale

# A working HTTPS gateway you already operate
dsh plugin --profile web exec dsh-network setup custom --url https://dsh.example.com
```

Use `--url http://HOST:3081` if LAN detection selects the wrong interface. Tailscale setup configures Serve to forward to the authenticated gateway. A custom public route must already provide trusted HTTPS and HTTP/WebSocket forwarding; this plugin does not configure DNS, certificates, firewalls, or a reverse proxy.

## Settings that explain the current state

The Network page groups host identity and device pairing separately, with labelled inputs, pending states, and inline errors. It follows DSH's English/Chinese locale and light/dark theme. Pending settings requests stop when the panel unmounts.

An optional `iosAppDownloadURL` displays a dismissible app-download card when configured with a valid HTTPS URL. Without one, the card stays hidden.

## Configuration

| Field | Default | Purpose |
| --- | --- | --- |
| `gatewayPort` | `3081` | Authenticated gateway port. |
| `bindHost` | `0.0.0.0` | Gateway interfaces; `127.0.0.1` limits it to loopback. |
| `hostName` | System hostname | Host display name. |
| `statePath` | `$DSH_HOME/network/state.json` | Pairing and device state. |
| `historyChunkTrim` | `true` | Remove redundant settled streaming chunks from history responses. |
| `historyTrustedHosts` | `[]` | Additional allowed direct-Web Host values for history routes. |
| `iosAppDownloadURL` | Unset | App Store or TestFlight HTTPS URL for the optional card. |

`DSH_HOME` defaults to `~/.dsh`. History trimming preserves rendered messages, first-token timing, and current partial output while reducing redundant deltas; savings depend on the session. Its routes retain the host's origin and cross-site checks.

## Pairing & credentials

Pairing tickets are single-use and expire after five minutes. A paired client receives a refresh credential and a one-hour access token; refresh rotates both. The host stores hashes, not the original credentials. Pairing links are generated on demand rather than broadcast.

LAN HTTP relies on a trusted local network. For a public route, expose the authenticated gateway through HTTPS, not the underlying DSH Web port. See [public deployment boundaries](docs/internet-compatibility.md).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| LAN address does not open | Device reachability, private-interface firewall rules, and the selected IP. |
| Tailscale setup fails | `tailscale status` and the host's existing sign-in. |
| Public route fails | Trusted TLS and both HTTP/WebSocket reverse-proxy forwarding. |
| Pairing QR expired | Generate a new single-use ticket. |

Full device listing and revocation controls in settings remain future work; the current panel exposes host status, paired-device count, and pairing.

## Development & feedback

```bash
npm ci
npm run check
```

[Report an issue](https://github.com/baixianger/dsh-network/issues) · [Release notes](RELEASES.md) · [MIT license](LICENSE)
