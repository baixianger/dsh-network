import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPairingTicket, DshNetworkGateway } from "../lib/gateway.js";

const UPSTREAM_COOKIE = "dsh-auth-mock=v1.payload.signature";
const PROCESS_TOKEN = "process-token";

/**
 * A stand-in for the Web runtime: the index requires the one-shot `?token=`
 * exchange (or its cookie), and `/api` applies the Host/Origin fence.
 */
function createMockUpstream() {
  const state = { exchanges: 0, lastCookie: null, lastOrigin: null };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://dsh.invalid");
    const cookie = String(request.headers.cookie ?? "");
    const authenticated = cookie.split(";").some((item) => item.trim() === UPSTREAM_COOKIE);
    if (url.pathname === "/") {
      if (request.method === "GET" && url.searchParams.get("token") === PROCESS_TOKEN) {
        state.exchanges += 1;
        response.writeHead(303, {
          "set-cookie": `${UPSTREAM_COOKIE}; Max-Age=3600; Path=/; HttpOnly; SameSite=Strict`,
          location: "./",
        });
        response.end();
        return;
      }
      if (authenticated) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><title>DSH</title>index-ok");
        return;
      }
      response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
      response.end("dsh web authentication required; reopen the URL printed by dsh web.\n");
      return;
    }
    if (url.pathname === "/api") {
      state.lastCookie = request.headers.cookie ?? null;
      state.lastOrigin = request.headers.origin ?? null;
      if (!authenticated) {
        response.writeHead(401);
        response.end("unauthorized");
        return;
      }
      const authority = `http://${request.headers.host}`;
      if (request.headers.origin !== undefined && request.headers.origin !== authority) {
        response.writeHead(403);
        response.end("forbidden");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ host: request.headers.host, origin: request.headers.origin ?? null }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  return { server, state };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function createFixture() {
  const { server, state } = createMockUpstream();
  const upstreamPort = await listen(server);
  const directory = await mkdtemp(join(tmpdir(), "dsh-network-auth-"));
  const statePath = join(directory, "state.json");
  const gateway = new DshNetworkGateway({
    upstreamPort,
    gatewayPort: 0,
    bindHost: "127.0.0.1",
    hostName: "test-host",
    statePath,
    upstreamAuthURL: () => `http://127.0.0.1:${upstreamPort}/?token=${PROCESS_TOKEN}`,
  });
  await gateway.start();
  const origin = `http://127.0.0.1:${gateway.port}`;
  return {
    state,
    gateway,
    origin,
    upstreamPort,
    async pair() {
      const pairing = await createPairingTicket({ statePath, ttlSeconds: 60 });
      const response = await fetch(`${origin}/dsh-network/pair/browser`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket: pairing.ticket, hostId: pairing.hostId, deviceName: "test-device" }),
      });
      assert.equal(response.status, 200);
      const token = /dsh_device=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
      assert.ok(token, "pairing must set a device cookie");
      return `dsh_device=${token}`;
    },
    async close() {
      await gateway.close();
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("a paired browser reaches the upstream index instead of the 401 refusal", async (context) => {
  const fixture = await createFixture();
  context.after(() => fixture.close());
  const cookie = await fixture.pair();

  const index = await fetch(`${fixture.origin}/`, { headers: { cookie } });
  const body = await index.text();
  assert.equal(index.status, 200);
  assert.match(body, /index-ok/);

  const api = await fetch(`${fixture.origin}/api`, {
    headers: { cookie, origin: fixture.origin, "sec-fetch-site": "same-origin" },
  });
  assert.equal(api.status, 200);
  const echoed = await api.json();
  assert.equal(echoed.host, `127.0.0.1:${fixture.upstreamPort}`);
  assert.equal(echoed.origin, `http://127.0.0.1:${fixture.upstreamPort}`);
});

test("the browser pairing cookie is stripped and a foreign Origin is not laundered", async (context) => {
  const fixture = await createFixture();
  context.after(() => fixture.close());
  const cookie = await fixture.pair();

  const same = await fetch(`${fixture.origin}/api`, {
    headers: { cookie, origin: fixture.origin, "sec-fetch-site": "same-origin" },
  });
  assert.equal(same.status, 200);
  await same.arrayBuffer();
  assert.ok(!String(fixture.state.lastCookie).includes("dsh_device"), "pairing cookie must not reach upstream");
  assert.ok(String(fixture.state.lastCookie).includes("dsh-auth-mock"), "upstream session cookie must be replayed");

  const foreign = await fetch(`${fixture.origin}/api`, {
    headers: { cookie, origin: "http://evil.example", "sec-fetch-site": "cross-site" },
  });
  assert.equal(foreign.status, 403);
  assert.equal(fixture.state.lastOrigin, "http://evil.example");
  await foreign.arrayBuffer();
});

test("the upstream session is exchanged once and re-exchanged after a rejection", async (context) => {
  const fixture = await createFixture();
  context.after(() => fixture.close());
  const cookie = await fixture.pair();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const index = await fetch(`${fixture.origin}/`, { headers: { cookie } });
    assert.equal(index.status, 200);
    await index.arrayBuffer();
  }
  assert.equal(fixture.state.exchanges, 1, "the session cookie must be cached, not minted per request");

  fixture.gateway.upstreamSession = "dsh-auth-mock=stale";
  fixture.gateway.upstreamSessionExpiresAt = Date.now() + 60_000;
  const refreshed = await fetch(`${fixture.origin}/`, { headers: { cookie } });
  assert.equal(refreshed.status, 200, "a rejected session must be exchanged again and replayed once");
  await refreshed.arrayBuffer();
  assert.equal(fixture.state.exchanges, 2);
});
