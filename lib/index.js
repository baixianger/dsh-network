import { hostname } from "node:os";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DshNetworkGateway } from "./gateway.js";

export const DSH_NETWORK_PROTOCOL_VERSION = 1;
export const DSH_NETWORK_STAGE = "secure-gateway";
export const name = "dsh-network";
export const inject = ["webServer"];

const APP_ICON_PATH = fileURLToPath(new URL("../assets/app-icon.png", import.meta.url));

function downloadURL(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function send(request, response, contentType, body, cacheControl = "no-store") {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end();
    return;
  }
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": body.length,
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

export async function apply(ctx, config = {}) {
  const iosAppDownloadURL = downloadURL(config.iosAppDownloadURL);
  const appIcon = await readFile(APP_ICON_PATH);
  const gateway = await new DshNetworkGateway({
    upstreamPort: ctx.webServer.port,
    gatewayPort: config.gatewayPort ?? 3081,
    bindHost: config.bindHost ?? "0.0.0.0",
    hostName: config.hostName ?? hostname(),
    statePath: config.statePath,
    logger: ctx.logger,
  }).start();
  ctx.accessor("dshNetwork", { get: () => gateway });
  ctx.effect(() => {
    const disposeConfig = ctx.webServer.register({
      kind: "exact",
      path: "/dsh-network/ui-config",
      handler: (request, response) => send(
        request,
        response,
        "application/json; charset=utf-8",
        Buffer.from(JSON.stringify({ iosAppDownloadURL }))
      ),
    });
    const disposeIcon = ctx.webServer.register({
      kind: "exact",
      path: "/dsh-network/app-icon.png",
      handler: (request, response) => send(request, response, "image/png", appIcon, "public, max-age=86400"),
    });
    return () => {
      disposeConfig();
      disposeIcon();
    };
  }, "dsh-network.web-client-resources");
  ctx.effect(() => async () => {
    await gateway.close();
  }, "dsh-network.gateway");
}

export { DshNetworkGateway, createPairingTicket, loadOrCreateState, defaultStatePath } from "./gateway.js";
