# DSH Network

> A transport-neutral connectivity layer for DeepSeek Harness nodes.

`dsh-network` defines the boundary between DSH's distributed features and the network that carries them. A first adapter will use Iroh for encrypted QUIC, NAT traversal, discovery, and relay fallback; the contract itself stays independent of Iroh.

| Layer | Responsibility |
| --- | --- |
| `dsh-network` | Endpoint identity, peer addresses, connections, streams, reachability |
| `dsh-weave` | Membership, capability policy, outbox, task routing |
| `dsh-bridge` | Local DSH session events |
| `dsh-chat` | Human conversation and task controls |

## Status

`0.1.0-rc.0` is a design-preview package that reserves the public API surface. It does not yet open network connections.

```bash
npm install dsh-network@next
```

## Contract

An eventual adapter exposes four concepts:

- **Endpoint** — persistent node identity and local listener lifecycle.
- **Peer address** — a verified route to a named endpoint.
- **Connection** — authenticated, encrypted peer relationship with lifecycle events.
- **Stream** — ordered bidirectional bytes owned by an application protocol such as `dsh-weave/1`.

Transport code must never decide DSH membership or authorize task execution. Those policy decisions belong to `dsh-weave` and the local DSH approval layer.

## Development

```bash
npm run check
```

## License

MIT © Xiang Bai
