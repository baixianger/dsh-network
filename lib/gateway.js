import { createServer, request as httpRequest } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { connect as connectTcp } from "node:net";

const MAX_PAIR_BODY = 4096;
const PAIR_WINDOW_MS = 60_000;
const PAIR_ATTEMPTS = 5;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const BROWSER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const digest = (value) => createHash("sha256").update(String(value)).digest("base64url");

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
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

async function readJSON(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_PAIR_BODY) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function defaultStatePath() {
  return join(process.env.DSH_HOME || join(homedir(), ".dsh"), "network", "state.json");
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function loadOrCreateState(path = defaultStatePath()) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value.hostId && Array.isArray(value.tickets) && Array.isArray(value.devices)) return value;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const state = { version: 1, hostId: randomUUID(), tickets: [], devices: [], createdAt: new Date().toISOString() };
  await writeState(path, state);
  return state;
}

export async function createPairingTicket({ statePath = defaultStatePath(), ttlSeconds = 300 } = {}) {
  const state = await loadOrCreateState(statePath);
  const ticket = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + ttlSeconds * 1000;
  state.tickets = state.tickets.filter((item) => !item.usedAt && item.expiresAt > Date.now());
  state.tickets.push({ hash: digest(ticket), expiresAt });
  await writeState(statePath, state);
  return { ticket, expiresAt, hostId: state.hostId };
}

export class DshNetworkGateway {
  constructor(options) {
    this.options = {
      bindHost: "0.0.0.0",
      gatewayPort: 3081,
      upstreamHost: "127.0.0.1",
      hostName: hostname(),
      statePath: defaultStatePath(),
      ...options,
    };
    // Cordis config objects may contain an explicit `undefined`, which would
    // otherwise overwrite the default and make the first credential write fail.
    this.options.statePath ??= defaultStatePath();
    this.pairAttempts = new Map();
  }

  async start() {
    this.state = await loadOrCreateState(this.options.statePath);
    this.server = createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        if (!response.headersSent) sendJSON(response, 500, { error: "gateway_error" });
        else response.destroy();
        this.options.logger?.warn?.(error);
      });
    });
    this.server.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.gatewayPort, this.options.bindHost, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.port = this.server.address().port;
    return this;
  }

  info() {
    return { protocolVersion: 1, hostId: this.state.hostId, name: this.options.hostName, requiresPairing: true };
  }

  async refreshState() {
    this.state = await loadOrCreateState(this.options.statePath);
  }

  async authorized(request) {
    await this.refreshState();
    const value = request.headers.authorization || "";
    if (value.startsWith("Bearer ")) {
      const tokenHash = digest(value.slice(7));
      return this.state.devices.some((device) =>
        !device.revokedAt && device.accessExpiresAt > Date.now() && safeEqual(device.accessTokenHash, tokenHash));
    }
    const cookie = String(request.headers.cookie || "").split(";").map((item) => item.trim()).find((item) => item.startsWith("dsh_device="));
    if (!cookie) return false;
    const tokenHash = digest(decodeURIComponent(cookie.slice("dsh_device=".length)));
    return this.state.devices.some((device) =>
      !device.revokedAt && device.browserExpiresAt > Date.now() && safeEqual(device.browserTokenHash, tokenHash));
  }

  canAttemptPair(address) {
    const now = Date.now();
    const recent = (this.pairAttempts.get(address) || []).filter((time) => now - time < PAIR_WINDOW_MS);
    recent.push(now);
    this.pairAttempts.set(address, recent);
    return recent.length <= PAIR_ATTEMPTS;
  }

  async handle(request, response) {
    const url = new URL(request.url || "/", "http://dsh-network.local");
    if (request.method === "GET" && url.pathname === "/dsh-network/info") {
      await this.refreshState();
      return sendJSON(response, 200, this.info());
    }
    if (request.method === "GET" && url.pathname === "/dsh-network/health") {
      return sendJSON(response, 200, { ok: true, hostId: this.state.hostId });
    }
    if (request.method === "GET" && url.pathname === "/dsh-network/connect") {
      const address = request.socket.remoteAddress || "unknown";
      if (!this.canAttemptPair(address)) return sendJSON(response, 429, { error: "too_many_attempts" });
      await this.refreshState();
      const ticketHash = digest(url.searchParams.get("ticket") || "");
      const ticket = this.state.tickets.find((item) => !item.usedAt && item.expiresAt > Date.now() && safeEqual(item.hash, ticketHash));
      if (!ticket) return sendJSON(response, 401, { error: "invalid_or_expired_ticket" });
      ticket.usedAt = Date.now();
      const browserToken = randomBytes(48).toString("base64url");
      this.state.devices.push({
        id: randomUUID(),
        browserTokenHash: digest(browserToken),
        browserExpiresAt: Date.now() + BROWSER_SESSION_TTL_MS,
        name: String(request.headers["user-agent"] || "Browser").slice(0, 160),
        createdAt: Date.now(),
      });
      await writeState(this.options.statePath, this.state);
      response.writeHead(303, {
        location: "/",
        "cache-control": "no-store",
        "set-cookie": `dsh_device=${encodeURIComponent(browserToken)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${BROWSER_SESSION_TTL_MS / 1000}`,
        "referrer-policy": "no-referrer",
      });
      response.end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/dsh-network/pair") {
      const address = request.socket.remoteAddress || "unknown";
      if (!this.canAttemptPair(address)) return sendJSON(response, 429, { error: "too_many_attempts" });
      const body = await readJSON(request);
      await this.refreshState();
      const ticketHash = digest(body.ticket || "");
      const ticket = this.state.tickets.find((item) => !item.usedAt && item.expiresAt > Date.now() && safeEqual(item.hash, ticketHash));
      if (!ticket) return sendJSON(response, 401, { error: "invalid_or_expired_ticket" });
      ticket.usedAt = Date.now();
      const accessToken = randomBytes(32).toString("base64url");
      const refreshToken = randomBytes(48).toString("base64url");
      const accessExpiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
      this.state.devices.push({
        id: randomUUID(),
        accessTokenHash: digest(accessToken),
        accessExpiresAt,
        refreshTokenHash: digest(refreshToken),
        name: String(body.deviceName || "iOS"),
        createdAt: Date.now(),
      });
      await writeState(this.options.statePath, this.state);
      return sendJSON(response, 200, { ...this.info(), accessToken, accessExpiresAt, refreshToken });
    }
    if (request.method === "POST" && url.pathname === "/dsh-network/refresh") {
      const body = await readJSON(request);
      await this.refreshState();
      const refreshHash = digest(body.refreshToken || "");
      const device = this.state.devices.find((item) => !item.revokedAt && safeEqual(item.refreshTokenHash, refreshHash));
      if (!device) return sendJSON(response, 401, { error: "invalid_refresh_token" });
      const accessToken = randomBytes(32).toString("base64url");
      const refreshToken = randomBytes(48).toString("base64url");
      const accessExpiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
      device.accessTokenHash = digest(accessToken);
      device.accessExpiresAt = accessExpiresAt;
      device.refreshTokenHash = digest(refreshToken);
      device.refreshedAt = Date.now();
      await writeState(this.options.statePath, this.state);
      return sendJSON(response, 200, { accessToken, accessExpiresAt, refreshToken });
    }
    if (!(await this.authorized(request))) return sendJSON(response, 401, { error: "pairing_required" });
    this.proxy(request, response);
  }

  proxy(request, response) {
    const headers = { ...request.headers, host: `${this.options.upstreamHost}:${this.options.upstreamPort}` };
    delete headers.authorization;
    delete headers.cookie;
    const upstream = httpRequest({
      host: this.options.upstreamHost,
      port: this.options.upstreamPort,
      method: request.method,
      path: request.url,
      headers,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) sendJSON(response, 502, { error: "dsh_unavailable" });
      else response.destroy();
    });
    request.pipe(upstream);
  }

  async handleUpgrade(request, socket, head) {
    if (!(await this.authorized(request))) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = connectTcp(this.options.upstreamPort, this.options.upstreamHost, () => {
      const headers = Object.entries(request.headers)
        .filter(([name]) => !["authorization", "cookie", "host"].includes(name.toLowerCase()))
        .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
      headers.push(`host: ${this.options.upstreamHost}:${this.options.upstreamPort}`);
      upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  }

  async close() {
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
  }
}
