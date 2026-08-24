import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPairingTicket, DshNetworkGateway } from "../lib/gateway.js";

test("an omitted Cordis state path keeps the secure default", () => {
  const gateway = new DshNetworkGateway({ upstreamPort: 1, statePath: undefined });
  assert.equal(typeof gateway.options.statePath, "string");
  assert.match(gateway.options.statePath, /network\/state\.json$/);
});

async function fixture() {
  const upstream = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ path: request.url, host: request.headers.host, authorization: request.headers.authorization ?? null }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(join(tmpdir(), "dsh-network-test-"));
  const statePath = join(directory, "state.json");
  const gateway = await new DshNetworkGateway({
    upstreamPort: upstream.address().port,
    gatewayPort: 0,
    bindHost: "127.0.0.1",
    statePath,
    hostName: "Test DSH",
  }).start();
  return {
    gateway,
    statePath,
    baseURL: `http://127.0.0.1:${gateway.port}`,
    close: async () => {
      await gateway.close();
      await new Promise((resolve) => upstream.close(resolve));
    },
  };
}

test("publishes public metadata without leaking credentials", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const response = await fetch(`${f.baseURL}/dsh-network/info`);
  const info = await response.json();
  assert.equal(response.status, 200);
  assert.equal(info.name, "Test DSH");
  assert.equal(info.requiresPairing, true);
  assert.equal("token" in info, false);
});

test("one-time ticket pairs a device and authenticated requests reach DSH", async (t) => {
  const f = await fixture();
  t.after(f.close);
  assert.equal((await fetch(`${f.baseURL}/api/host.describe`, { method: "POST" })).status, 401);

  const pairing = await createPairingTicket({ statePath: f.statePath });
  const pairedResponse = await fetch(`${f.baseURL}/dsh-network/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: pairing.ticket, deviceName: "Test iPhone" }),
  });
  const paired = await pairedResponse.json();
  assert.equal(pairedResponse.status, 200);
  assert.ok(paired.accessToken);
  assert.ok(paired.refreshToken);

  const replay = await fetch(`${f.baseURL}/dsh-network/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: pairing.ticket }),
  });
  assert.equal(replay.status, 401);

  const proxied = await fetch(`${f.baseURL}/api/host.describe`, {
    method: "POST",
    headers: { authorization: `Bearer ${paired.accessToken}` },
  });
  assert.equal(proxied.status, 200);
  assert.deepEqual(await proxied.json(), {
    path: "/api/host.describe",
    host: `127.0.0.1:${f.gateway.options.upstreamPort}`,
    authorization: null,
  });
});

test("refresh rotates both access and refresh credentials", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const pairing = await createPairingTicket({ statePath: f.statePath });
  const paired = await (await fetch(`${f.baseURL}/dsh-network/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: pairing.ticket }),
  })).json();

  const refreshedResponse = await fetch(`${f.baseURL}/dsh-network/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: paired.refreshToken }),
  });
  const refreshed = await refreshedResponse.json();
  assert.equal(refreshedResponse.status, 200);
  assert.notEqual(refreshed.accessToken, paired.accessToken);
  assert.notEqual(refreshed.refreshToken, paired.refreshToken);

  assert.equal((await fetch(`${f.baseURL}/api/test`, { headers: { authorization: `Bearer ${paired.accessToken}` } })).status, 401);
  assert.equal((await fetch(`${f.baseURL}/api/test`, { headers: { authorization: `Bearer ${refreshed.accessToken}` } })).status, 200);
  const state = JSON.parse(await readFile(f.statePath, "utf8"));
  assert.equal(state.devices.length, 1);
  assert.equal("accessToken" in state.devices[0], false);
  assert.equal("refreshToken" in state.devices[0], false);
});

test("the fragment landing page pairs an HTTP LAN browser with a host-bound HttpOnly cookie", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const pairing = await createPairingTicket({ statePath: f.statePath });
  const landing = await fetch(`${f.baseURL}/dsh-network/connect`);
  assert.equal(landing.status, 200);
  assert.match(landing.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(landing.headers.get("set-cookie"), null);

  const response = await fetch(`${f.baseURL}/dsh-network/pair/browser`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: pairing.ticket, hostId: pairing.hostId }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /dsh_device=/);
  assert.match(cookie, /HttpOnly/);
  assert.doesNotMatch(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);

  const value = cookie.match(/dsh_device=([^;]+)/)[1];
  const proxied = await fetch(`${f.baseURL}/browser`, { headers: { cookie: `dsh_device=${value}` } });
  assert.equal(proxied.status, 200);
  assert.equal((await proxied.json()).authorization, null);
});

test("a ticket cannot be redeemed for a different host identity", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const pairing = await createPairingTicket({ statePath: f.statePath });
  const response = await fetch(`${f.baseURL}/dsh-network/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: pairing.ticket, hostId: "wrong-host" }),
  });
  assert.equal(response.status, 401);
});

test("an authenticated browser can mint a separate one-use iOS handoff", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const browserPairing = await createPairingTicket({ statePath: f.statePath });
  const browserResponse = await fetch(`${f.baseURL}/dsh-network/pair/browser`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: browserPairing.ticket, hostId: browserPairing.hostId }),
  });
  const browserCookie = browserResponse.headers.get("set-cookie").match(/dsh_device=([^;]+)/)[1];

  const unauthenticated = await fetch(`${f.baseURL}/dsh-network/handoff/ios`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: f.baseURL },
    body: JSON.stringify({ origin: f.baseURL }),
  });
  assert.equal(unauthenticated.status, 401);

  const handoffResponse = await fetch(`${f.baseURL}/dsh-network/handoff/ios`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `dsh_device=${browserCookie}`,
      origin: f.baseURL,
    },
    body: JSON.stringify({ origin: f.baseURL }),
  });
  assert.equal(handoffResponse.status, 200);
  const handoff = new URL((await handoffResponse.json()).url);
  assert.equal(handoff.protocol, "dsh:");
  assert.equal(handoff.host, "pair");
  const fragment = new URLSearchParams(handoff.hash.slice(1));
  assert.equal(fragment.get("h"), browserPairing.hostId);
  assert.equal(fragment.get("u"), f.baseURL);

  const nativePair = await fetch(`${f.baseURL}/dsh-network/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: fragment.get("t"), hostId: fragment.get("h") }),
  });
  assert.equal(nativePair.status, 200);
  const replay = await fetch(`${f.baseURL}/dsh-network/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: fragment.get("t"), hostId: fragment.get("h") }),
  });
  assert.equal(replay.status, 401);
});

test("a one-time ticket has exactly one winner under concurrent redemption", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const pairing = await createPairingTicket({ statePath: f.statePath });
  const redeem = () => fetch(`${f.baseURL}/dsh-network/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket: pairing.ticket, hostId: pairing.hostId }),
  });
  const responses = await Promise.all([redeem(), redeem()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401]);
  const state = JSON.parse(await readFile(f.statePath, "utf8"));
  assert.equal(state.devices.length, 1);
});

test("concurrent ticket creation preserves every ticket", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dsh-network-state-test-"));
  const statePath = join(directory, "state.json");
  await Promise.all(Array.from({ length: 12 }, () => createPairingTicket({ statePath })));
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(state.tickets.length, 12);
});
