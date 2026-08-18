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
