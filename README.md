# DSH Network

> One secure connection layer for DeepSeek Harness on a LAN, Tailnet, or HTTPS server.

`dsh-network` is an independent DSH server plugin. It keeps DSH bound to
`127.0.0.1`, places an authenticated gateway in front of it, and gives every
host a persistent `hostId` so clients can merge multiple routes to one server.

| Route | Discovery | Address |
| --- | --- | --- |
| Home / LAN | Bonjour `_dsh._tcp` | Gateway on the local machine |
| Tailnet | QR or manual | Tailscale Serve MagicDNS URL |
| Public server | QR or manual | User-managed HTTPS URL |

Bonjour records contain only the protocol version, `hostId`, authentication
mode, and port. Credentials are never broadcast.

## Install

```bash
dsh plugin --profile web add dsh-network@next
dsh web
```

The plugin starts its gateway on port `3081` and publishes it on the current
LAN. DSH itself remains on loopback port `3080`.

## Pair on the LAN

With the server running, choose the automatically discovered host in the iOS
app and scan a fresh ticket from the server shell:

```bash
npx dsh-network pair
```

## Configure a Tailnet

Tailscale must already be installed and signed in. This command configures
Tailscale Serve to forward the private MagicDNS HTTPS URL to the authenticated
gateway, then prints a pairing QR code:

```bash
npx dsh-network setup
```

Bonjour is not forwarded through a Tailnet. The QR code supplies the MagicDNS
URL to the iOS app once; the app then remembers the route.

## Public HTTPS server

Public discovery is intentionally unsupported. Put port `3081` behind a
trusted HTTPS reverse proxy, then generate a QR code containing that URL:

```bash
npx dsh-network pair --url https://dsh.example.com
```

Do not expose DSH port `3080` itself. Public mode requires TLS and should also
use provider firewall and rate-limit controls.

## Credential lifecycle

1. The QR contains a random, single-use pairing ticket valid for five minutes.
2. Pairing issues a device refresh credential and a one-hour access token.
3. The client refreshes automatically and both credentials rotate.
4. Only credential hashes are stored under `~/.dsh/network/state.json`.
5. Bonjour TXT records never contain a ticket, token, or secret.

The gateway rate-limits pairing attempts. Device listing and revocation will be
exposed in the DSH settings UI before a stable release.

## Platform support

The mDNS/DNS-SD implementation is cross-platform. macOS works without extra
software; Linux and Windows may require allowing the DSH process through the
host firewall for TCP `3081` and multicast UDP `5353`.

## Development

```bash
npm test
npm run check
```

## License

MIT © Xiang Bai
