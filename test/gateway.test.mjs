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

test("the same HTTPS ticket URL pairs a browser with an HttpOnly cookie", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const pairing = await createPairingTicket({ statePath: f.statePath });
  const response = await fetch(`${f.baseURL}/dsh-network/connect?ticket=${pairing.ticket}`, { redirect: "manual" });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /dsh_device=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);

  const value = cookie.match(/dsh_device=([^;]+)/)[1];
  const proxied = await fetch(`${f.baseURL}/browser`, { headers: { cookie: `dsh_device=${value}` } });
  assert.equal(proxied.status, 200);
  assert.equal((await proxied.json()).authorization, null);
});
