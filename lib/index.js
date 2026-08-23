import { hostname } from "node:os";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { createPairingTicket, DshNetworkGateway, lanURL } from "./gateway.js";

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

function sendJSON(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  response.end(body);
}

function pairingBaseURL(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
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
    const disposeStatus = ctx.webServer.register({
      kind: "exact",
      path: "/dsh-network/status",
      handler: (request, response) => {
        let lanUrl = null;
        try {
          lanUrl = lanURL(gateway.status().gatewayPort);
        } catch {}
        return sendJSON(response, 200, { ...gateway.status(), lanUrl });
      },
    });
    const disposePairingQR = ctx.webServer.register({
      kind: "exact",
      path: "/dsh-network/pairing/qr",
      handler: async (request, response) => {
        const query = new URL(request.url || "/", "http://dsh-network.local").searchParams;
        const ttl = Math.min(Math.max(Number(query.get("ttl") || 300), 30), 3600);
        const rawURL = query.get("url");
        let base;
        if (rawURL != null) {
          base = pairingBaseURL(rawURL);
          if (!base) return sendJSON(response, 400, { error: "invalid_pairing_url" });
        } else {
          try { base = lanURL(gateway.status().gatewayPort); } catch { base = null; }
        }
        if (!base) return sendJSON(response, 400, { error: "no_pairing_url" });
        try {
          const pairing = await createPairingTicket({ statePath: gateway.options.statePath, ttlSeconds: ttl });
          const payloadURL = new URL("/dsh-network/connect", base);
          payloadURL.hash = new URLSearchParams({ v: "1", t: pairing.ticket, h: pairing.hostId }).toString();
          const payload = payloadURL.toString();
          const qr = await QRCode.toDataURL(payload, { margin: 1, width: 360, errorCorrectionLevel: "M" });
          return sendJSON(response, 200, { url: payload, qr, expiresAt: pairing.expiresAt, hostId: pairing.hostId });
        } catch (error) {
          ctx.logger?.warn?.(error);
          return sendJSON(response, 500, { error: "pairing_qr_failed" });
        }
      },
    });
    return () => {
      disposeConfig();
      disposeIcon();
      disposeStatus();
      disposePairingQR();
    };
  }, "dsh-network.web-client-resources");
  ctx.effect(() => async () => {
    await gateway.close();
  }, "dsh-network.gateway");
}

export { DshNetworkGateway, createPairingTicket, lanURL, loadOrCreateState, defaultStatePath } from "./gateway.js";
