# Public Host boundary

`dsh-network` treats every public deployment as a user-managed HTTPS origin.
The plugin does not discover, install, edit, reload, or take ownership of DNS,
reverse proxies, certificates, firewalls, containers, hosting panels, or ports.

## Accepted routes

Any working HTTPS origin can be paired, including a domain or an IP address
whose TLS certificate is trusted by the client:

```text
https://dsh.example.com
https://dsh.example.com:8443
https://203.0.113.10:8443
https://[2001:db8::10]:8443
```

The origin must forward HTTP and WebSocket traffic to the authenticated
Gateway on port `3081`. DSH port `3080` stays on loopback and must never be
published directly. Plain HTTP is accepted only for a trusted LAN.

Generate pairing material after the route is already operational:

```bash
npx dsh-network pair --url https://dsh.example.com
```

## Pairing security

The universal QR payload is:

```text
https://host[:port]/dsh-network/connect#v=1&t=<ticket>&h=<host-id>
```

The secret remains in the URL fragment, is single-use, expires after five
minutes, and is bound to the expected Host ID. A browser redeems it with a
same-origin POST and receives an HttpOnly cookie. A native client receives
rotating credentials stored in platform secure storage.

Browser and native credentials are intentionally separate. An authenticated
iPhone browser can explicitly open the DSH app; the Gateway then mints a new
one-minute ticket for that handoff instead of exposing the browser cookie.

## Client behavior

Clients deduplicate multiple LAN, Tailnet, or public routes by Host ID. Adding
a second route to the same Host updates that Host instead of creating a duplicate
Host. Public discovery is intentionally unsupported.
