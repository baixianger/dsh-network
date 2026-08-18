# DSH Network

> One secure connection layer for DeepSeek Harness on a LAN, Tailnet, or HTTPS server.

`dsh-network` is an independent DSH server plugin. It keeps DSH bound to
`127.0.0.1`, places an authenticated gateway in front of it, and gives every
host a persistent `hostId` so clients can merge multiple routes to one server.

| Route | Discovery | Address |
| --- | --- | --- |
| Home / LAN | QR or pasted pairing link | Gateway on the local machine |
| Tailnet | QR or manual | Tailscale Serve MagicDNS URL |
| Public server | QR or manual | User-managed HTTPS URL |

## Install

```bash
dsh plugin --profile web add dsh-network@next
dsh web
```

The plugin starts its authenticated gateway on port `3081`. DSH itself remains
on loopback port `3080`.

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
    iosAppDownloadURL: https://apps.apple.com/app/id000000000
```

## Pair on the LAN

With the server running, generate a QR containing a private LAN address and
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
remembers the route. The historical `dsh-network setup` command remains an
alias for `setup tailscale`.

## Public HTTPS server

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
public-server boundary.

## Credential lifecycle

1. The QR contains a random, single-use pairing ticket valid for five minutes.
2. Pairing issues a device refresh credential and a one-hour access token.
3. The client refreshes automatically and both credentials rotate.
4. Only credential hashes are stored under `~/.dsh/network/state.json`.
5. Pairing links are generated on demand and are never broadcast.

When an authenticated iPhone browser opens DSH, the web client can mint a new
one-minute, app-only ticket and hand the same Server to the DSH iOS app. Browser
cookies and iOS Keychain credentials remain separate.

The gateway rate-limits pairing attempts. Device listing and revocation will be
exposed in the DSH settings UI before a stable release.

## Platform support

LAN setup uses ordinary HTTP addressing and Tailnet setup uses Tailscale's
HTTPS Serve. Linux and Windows may require allowing the DSH process through the
host firewall for TCP `3081` on trusted private interfaces.

## Development

```bash
npm test
npm run check
```

## License

MIT © Xiang Bai
