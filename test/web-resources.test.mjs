import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { apply } from "../lib/index.js";

function responseCapture() {
  return {
    status: 0,
    headers: {},
    body: undefined,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
}

test("the local web resource exposes a configured HTTPS iOS download URL", async (t) => {
  const routes = new Map();
  const disposers = [];
  const statePath = join(await mkdtemp(join(tmpdir(), "dsh-network-web-test-")), "state.json");
  const ctx = {
    webServer: {
      port: 1,
      register(route) {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
    accessor() {},
    effect(factory) { disposers.push(factory()); },
  };
  t.after(async () => {
    for (const dispose of disposers.reverse()) await dispose?.();
  });

  await apply(ctx, {
    gatewayPort: 0,
    bindHost: "127.0.0.1",
    statePath,
    iosAppDownloadURL: "https://apps.apple.com/app/id123456789",
  });

  const configResponse = responseCapture();
  routes.get("/dsh-network/ui-config").handler({ method: "GET" }, configResponse);
  assert.equal(configResponse.status, 200);
  assert.deepEqual(JSON.parse(configResponse.body.toString()), {
    iosAppDownloadURL: "https://apps.apple.com/app/id123456789",
  });

  const iconResponse = responseCapture();
  routes.get("/dsh-network/app-icon.png").handler({ method: "GET" }, iconResponse);
  assert.equal(iconResponse.status, 200);
  assert.equal(iconResponse.headers["content-type"], "image/png");
  assert.ok(iconResponse.body.length > 1_000);
});
function webFixture(t) {
  const routes = new Map();
  const disposers = [];
  const statePath = join(mkdtempSync(), "state.json");
  const ctx = {
    webServer: {
      port: 1,
      register(route) {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
    accessor() {},
    effect(factory) { disposers.push(factory()); },
  };
  t.after(async () => {
    for (const dispose of disposers.reverse()) await dispose?.();
  });
  return { routes, statePath, ctx };
}

function mkdtempSync() {
  return tmpdir() + "/dsh-network-web-" + crypto.randomUUID();
}

test("the local web resource reports host status without credentials", async (t) => {
  const { routes, ctx, statePath } = webFixture(t);
  await apply(ctx, { gatewayPort: 0, bindHost: "127.0.0.1", statePath });

  const statusResponse = responseCapture();
  routes.get("/dsh-network/status").handler({ method: "GET", url: "/dsh-network/status" }, statusResponse);
  assert.equal(statusResponse.status, 200);
  const status = JSON.parse(statusResponse.body.toString());
  assert.equal(typeof status.hostId, "string");
  assert.equal(status.requiresPairing, true);
  assert.equal(status.bindHost, "127.0.0.1");
  assert.equal(typeof status.gatewayPort, "number");
  assert.equal(status.pairedDevices, 0);
  assert.equal("accessToken" in status, false);
  assert.ok(status.lanUrl === null || typeof status.lanUrl === "string");
});

test("the local web resource issues a QR-encoded one-time pairing ticket", async (t) => {
  const { routes, ctx, statePath } = webFixture(t);
  await apply(ctx, { gatewayPort: 0, bindHost: "127.0.0.1", statePath });

  const qrResponse = responseCapture();
  await routes.get("/dsh-network/pairing/qr").handler(
    { method: "GET", url: "/dsh-network/pairing/qr?url=" + encodeURIComponent("http://127.0.0.1:3081") },
    qrResponse
  );
  assert.equal(qrResponse.status, 200);
  const value = JSON.parse(qrResponse.body.toString());
  assert.equal(typeof value.hostId, "string");
  assert.ok(value.expiresAt > Date.now());
  assert.match(value.qr, /^data:image\/png;base64,/);
  const payload = new URL(value.url);
  assert.equal(payload.pathname, "/dsh-network/connect");
  assert.equal(payload.host, "127.0.0.1:3081");
  const fragment = new URLSearchParams(payload.hash.slice(1));
  assert.equal(fragment.get("v"), "1");
  assert.ok(fragment.get("t"));
  assert.equal(fragment.get("h"), value.hostId);

  const missing = responseCapture();
  await routes.get("/dsh-network/pairing/qr").handler({ method: "GET", url: "/dsh-network/pairing/qr?url=not-a-url" }, missing);
  assert.equal(missing.status, 400);
});

