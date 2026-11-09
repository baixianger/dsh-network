import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir, hostname, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { connect as connectTcp } from "node:net";
import { fileURLToPath } from "node:url";

const MAX_PAIR_BODY = 4096;
const PAIR_WINDOW_MS = 60_000;
const PAIR_ATTEMPTS = 5;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const BROWSER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BROWSER_COOKIE = "__Host-dsh_device";
const INSECURE_BROWSER_COOKIE = "dsh_device";
// The Web runtime authenticates its index through a one-shot `?token=` exchange
// and then keeps a `dsh-auth-*` browser cookie bound to the request authority.
// The gateway is a loopback client, so it completes that exchange itself and
// replays the resulting cookie on every upstream request.
const UPSTREAM_AUTH_COOKIE_PREFIX = "dsh-auth-";
const STATE_LOCK_STALE_MS = 30_000;
const STATE_LOCK_TIMEOUT_MS = 10_000;
const APP_ICON_PATH = fileURLToPath(new URL("../assets/app-icon.png", import.meta.url));

const CONNECT_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pair with DSH</title>
</head>
<body>
  <main><p id="status">Pairing with this DSH Host…</p></main>
  <script src="/dsh-network/connect.js" defer></script>
</body>
</html>`;

const CONNECT_SCRIPT = `(() => {
  const status = document.getElementById("status");
  const values = new URLSearchParams(location.hash.slice(1));
  const ticket = values.get("t");
  const hostId = values.get("h");
  history.replaceState(null, "", location.pathname);
  if (!ticket || !hostId) {
    status.textContent = "This pairing link is invalid.";
    return;
  }
  fetch("/dsh-network/pair/browser", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticket, hostId, deviceName: navigator.userAgent })
  }).then(async (response) => {
    if (!response.ok) throw new Error(await response.text());
    location.replace("/");
  }).catch(() => { status.textContent = "Pairing failed or the link expired. Generate a new QR code."; });
})();`;

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

function sendText(response, status, body, contentType) {
  const value = Buffer.from(body);
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": value.length,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(value);
}

function sendBinary(response, status, body, contentType) {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": body.length,
    "cache-control": "public, max-age=86400",
    "x-content-type-options": "nosniff",
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

/**
 * Find the Web runtime's browser-session cookie in an upstream Set-Cookie list.
 * @param setCookie - the upstream response's Set-Cookie header, if any.
 * @returns the `name=value` pair with its absolute expiry, or null.
 */
function upstreamAuthCookie(setCookie) {
  const lines = Array.isArray(setCookie) ? setCookie : typeof setCookie === "string" ? [setCookie] : [];
  for (const line of lines) {
    const text = String(line);
    const pair = /^\s*([^=;]+)=([^;]*)/.exec(text);
    if (!pair || !pair[1].startsWith(UPSTREAM_AUTH_COOKIE_PREFIX)) continue;
    const maxAge = /;\s*max-age=(-?\d+)/i.exec(text);
    const expires = /;\s*expires=([^;]+)/i.exec(text);
    let expiresAt;
    if (maxAge) expiresAt = Date.now() + Number(maxAge[1]) * 1000;
    else if (expires) expiresAt = Date.parse(expires[1]);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    return { value: `${pair[1]}=${pair[2]}`, expiresAt };
  }
  return null;
}

/**
 * Translate a browser Origin/Referer that names this gateway into the loopback
 * authority the upstream request will carry. Any other value is returned
 * unchanged so the upstream's own cross-site fence still refuses it.
 * @param mode - `origin` keeps only the authority; `referer` keeps the path.
 */
function translateGatewayURL(value, gatewayHost, upstreamOrigin, mode) {
  if (typeof value !== "string" || value === "") return value;
  try {
    const parsed = new URL(value);
    if (parsed.host !== gatewayHost) return value;
    if (mode === "origin") return upstreamOrigin;
    return `${upstreamOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return value;
  }
}

export function defaultStatePath() {
  return join(process.env.DSH_HOME || join(homedir(), ".dsh"), "network", "state.json");
}

export function lanURL(port) {
  const addresses = Object.values(networkInterfaces()).flat().filter((entry) =>
    entry && !entry.internal && (entry.family === "IPv4" || entry.family === 4) &&
    (/^10\./.test(entry.address) || /^192\.168\./.test(entry.address) || /^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)));
  if (!addresses.length) throw new Error("No private LAN IPv4 address was found. Pass --url http://HOST:PORT explicitly.");
  return `http://${addresses[0].address}:${port}`;
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function acquireStateLock(path) {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + STATE_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      return async () => {
        await handle.close();
        await unlink(lockPath).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > STATE_LOCK_STALE_MS) {
          await unlink(lockPath);
          continue;
        }
      } catch (lockError) {
        if (lockError?.code === "ENOENT") continue;
        throw lockError;
      }
      if (Date.now() >= deadline) throw new Error(`timed out waiting for network state lock: ${lockPath}`);
      await delay(20 + Math.floor(Math.random() * 30));
    }
  }
}

async function updateState(path, mutate) {
  const release = await acquireStateLock(path);
  try {
    const state = await loadOrCreateState(path);
    const result = await mutate(state);
    await writeState(path, state);
    return { state, result };
  } finally {
    await release();
  }
}

export async function loadOrCreateState(path = defaultStatePath()) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value.hostId && Array.isArray(value.tickets) && Array.isArray(value.devices)) {
      await chmod(dirname(path), 0o700); await chmod(path, 0o600);
      return value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const state = { version: 1, hostId: randomUUID(), tickets: [], devices: [], createdAt: new Date().toISOString() };
  await writeState(path, state);
  return state;
}

export async function createPairingTicket({ statePath = defaultStatePath(), ttlSeconds = 300 } = {}) {
  const ticket = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const { state } = await updateState(statePath, (current) => {
    current.tickets = current.tickets.filter((item) => !item.usedAt && item.expiresAt > Date.now());
    current.tickets.push({ hash: digest(ticket), expiresAt });
  });
  return { ticket, expiresAt, hostId: state.hostId };
}

export class DshNetworkGateway {
  constructor(options) {
    this.options = {
      bindHost: "0.0.0.0",
      gatewayPort: 3081,
      upstreamHost: "127.0.0.1",
      upstreamProtocol: "http:",
      hostName: hostname(),
      statePath: defaultStatePath(),
      ...options,
    };
    // Cordis config objects may contain an explicit `undefined`, which would
    // otherwise overwrite the default and make the first credential write fail.
    this.options.statePath ??= defaultStatePath();
    this.pairAttempts = new Map();
    // Teardown state: closeAllConnections() covers ordinary requests but never
    // upgraded sockets, so both sets are tracked and drained by close().
    this.connections = new Set();
    this.upgrades = new Set();
    // Upstream browser session: minted once from the Web runtime's own token
    // exchange, then replayed until it expires or the runtime rejects it.
    this.upstreamSession = null;
    this.upstreamSessionExpiresAt = 0;
    this.upstreamSessionAttempt = null;
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
    this.server.on("connection", (socket) => {
      this.connections.add(socket);
      socket.once("close", () => this.connections.delete(socket));
    });
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

  status() {
    const devices = (this.state?.devices ?? []).filter((item) => !item.revokedAt);
    return {
      ...this.info(),
      gatewayPort: this.port ?? this.options.gatewayPort,
      bindHost: this.options.bindHost,
      pairedDevices: devices.length,
    };
  }

  async refreshState() {
    const release = await acquireStateLock(this.options.statePath);
    try { this.state = await loadOrCreateState(this.options.statePath); }
    finally { await release(); }
  }

  /** Whether the embedding host can hand this gateway a tokenized index URL. */
  upstreamAuthEnabled() {
    return typeof this.options.upstreamAuthURL === "function";
  }

  /** The loopback origin the upstream request is rewritten to carry. */
  upstreamOrigin() {
    return `${this.options.upstreamProtocol ?? "http:"}//${this.options.upstreamHost}:${this.options.upstreamPort}`;
  }

  /** The cached upstream browser cookie, minting one when absent or expired. */
  async ensureUpstreamSession() {
    if (!this.upstreamAuthEnabled()) return null;
    if (this.upstreamSession && Date.now() < this.upstreamSessionExpiresAt) return this.upstreamSession;
    if (this.upstreamSessionAttempt) return this.upstreamSessionAttempt;
    this.upstreamSessionAttempt = this.mintUpstreamSession().finally(() => {
      this.upstreamSessionAttempt = null;
    });
    return this.upstreamSessionAttempt;
  }

  /**
   * Complete the Web runtime's `?token=` index exchange as a loopback client and
   * keep the browser cookie it returns. The token comes from the in-process
   * Connection service, so no credential is written to disk or exposed to clients.
   */
  async mintUpstreamSession() {
    let tokenized;
    try {
      tokenized = await this.options.upstreamAuthURL();
    } catch (error) {
      this.options.logger?.warn?.(error);
      return null;
    }
    if (!tokenized) return null;
    let path = "/";
    try {
      const parsed = new URL(String(tokenized));
      path = `${parsed.pathname}${parsed.search}`;
    } catch {
      return null;
    }
    const authority = `${this.options.upstreamHost}:${this.options.upstreamPort}`;
    const send = this.options.upstreamProtocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve) => {
      const request = send({
        host: this.options.upstreamHost,
        port: this.options.upstreamPort,
        method: "GET",
        path,
        headers: { host: authority, accept: "text/html" },
      }, (response) => {
        response.resume();
        const cookie = upstreamAuthCookie(response.headers["set-cookie"]);
        if (!cookie) {
          resolve(null);
          return;
        }
        this.upstreamSession = cookie.value;
        this.upstreamSessionExpiresAt = cookie.expiresAt;
        resolve(cookie.value);
      });
      request.on("error", () => resolve(null));
      request.end();
    });
  }

  /** Upstream headers: loopback Host, translated same-authority Origin/Referer, injected session cookie. */
  upstreamHeaders(request) {
    const headers = { ...request.headers, host: `${this.options.upstreamHost}:${this.options.upstreamPort}` };
    delete headers.authorization;
    delete headers.cookie;
    const gatewayHost = request.headers.host;
    if (typeof gatewayHost === "string" && gatewayHost !== "") {
      const origin = this.upstreamOrigin();
      if (headers.origin !== undefined) headers.origin = translateGatewayURL(headers.origin, gatewayHost, origin, "origin");
      if (headers.referer !== undefined) headers.referer = translateGatewayURL(headers.referer, gatewayHost, origin, "referer");
    }
    if (this.upstreamSession) headers.cookie = this.upstreamSession;
    return headers;
  }

  async authorized(request) {
    await this.refreshState();
    const value = request.headers.authorization || "";
    if (value.startsWith("Bearer ")) {
      const tokenHash = digest(value.slice(7));
      return this.state.devices.some((device) =>
        !device.revokedAt && device.accessExpiresAt > Date.now() && safeEqual(device.accessTokenHash, tokenHash));
    }
    const cookie = String(request.headers.cookie || "").split(";").map((item) => item.trim()).find((item) =>
      item.startsWith(`${BROWSER_COOKIE}=`) || item.startsWith(`${INSECURE_BROWSER_COOKIE}=`));
    if (!cookie) return false;
    const tokenHash = digest(decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)));
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

  consumeTicket(ticketValue, expectedHostId, state = this.state) {
    if (expectedHostId && expectedHostId !== state.hostId) return undefined;
    const ticketHash = digest(ticketValue || "");
    const ticket = state.tickets.find((item) => !item.usedAt && item.expiresAt > Date.now() && safeEqual(item.hash, ticketHash));
    if (ticket) ticket.usedAt = Date.now();
    return ticket;
  }

  async pairBrowser(request, response, body) {
    const browserToken = randomBytes(48).toString("base64url");
    const updated = await updateState(this.options.statePath, (state) => {
      if (!this.consumeTicket(body.ticket, body.hostId, state)) return false;
      state.devices.push({
        id: randomUUID(),
        browserTokenHash: digest(browserToken),
        browserExpiresAt: Date.now() + BROWSER_SESSION_TTL_MS,
        name: String(body.deviceName || request.headers["user-agent"] || "Browser").slice(0, 160),
        createdAt: Date.now(),
      });
      return true;
    });
    this.state = updated.state;
    if (!updated.result) return sendJSON(response, 401, { error: "invalid_or_expired_ticket" });
    const secure = Boolean(request.socket.encrypted) || String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
    const cookieName = secure ? BROWSER_COOKIE : INSECURE_BROWSER_COOKIE;
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": `${cookieName}=${encodeURIComponent(browserToken)}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Strict; Max-Age=${BROWSER_SESSION_TTL_MS / 1000}`,
      "referrer-policy": "no-referrer",
    });
    response.end(JSON.stringify({ ok: true, hostId: this.state.hostId }));
  }

  async createAppHandoff(request, response, body) {
    if (!(await this.authorized(request))) return sendJSON(response, 401, { error: "pairing_required" });
    const requestOrigin = String(request.headers.origin || "");
    if (!requestOrigin || requestOrigin !== body.origin) return sendJSON(response, 403, { error: "invalid_origin" });
    let origin;
    try {
      origin = new URL(requestOrigin);
    } catch {
      return sendJSON(response, 400, { error: "invalid_origin" });
    }
    if (!["http:", "https:"].includes(origin.protocol)) return sendJSON(response, 400, { error: "invalid_origin" });

    const pairing = await createPairingTicket({ statePath: this.options.statePath, ttlSeconds: 60 });
    await this.refreshState();
    const handoff = new URL("dsh://pair");
    handoff.hash = new URLSearchParams({
      v: "1",
      t: pairing.ticket,
      h: pairing.hostId,
      u: origin.origin,
    }).toString();
    return sendJSON(response, 200, { url: handoff.toString(), expiresAt: pairing.expiresAt });
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
    if (request.method === "GET" && url.pathname === "/dsh-network/connect.js") {
      return sendText(response, 200, CONNECT_SCRIPT, "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/dsh-network/app-icon.png") {
      return sendBinary(response, 200, await readFile(APP_ICON_PATH), "image/png");
    }
    if (request.method === "GET" && url.pathname === "/dsh-network/connect") {
      if (!url.searchParams.has("ticket")) {
        response.setHeader("content-security-policy", "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
        return sendText(response, 200, CONNECT_PAGE, "text/html; charset=utf-8");
      }
      // Backward compatibility for QR codes generated before fragment pairing.
      const address = request.socket.remoteAddress || "unknown";
      if (!this.canAttemptPair(address)) return sendJSON(response, 429, { error: "too_many_attempts" });
      await this.refreshState();
      const legacyResponse = {
        writeHead: (status, headers) => response.writeHead(303, { ...headers, location: "/" }),
        end: () => response.end(),
      };
      return this.pairBrowser(request, legacyResponse, {
        ticket: url.searchParams.get("ticket"),
        hostId: url.searchParams.get("hostId"),
      });
    }
    if (request.method === "POST" && url.pathname === "/dsh-network/pair/browser") {
      const address = request.socket.remoteAddress || "unknown";
      if (!this.canAttemptPair(address)) return sendJSON(response, 429, { error: "too_many_attempts" });
      return this.pairBrowser(request, response, await readJSON(request));
    }
    if (request.method === "POST" && url.pathname === "/dsh-network/pair") {
      const address = request.socket.remoteAddress || "unknown";
      if (!this.canAttemptPair(address)) return sendJSON(response, 429, { error: "too_many_attempts" });
      const body = await readJSON(request);
      const accessToken = randomBytes(32).toString("base64url");
      const refreshToken = randomBytes(48).toString("base64url");
      const accessExpiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
      const updated = await updateState(this.options.statePath, (state) => {
        if (!this.consumeTicket(body.ticket, body.hostId, state)) return false;
        state.devices.push({
          id: randomUUID(),
          accessTokenHash: digest(accessToken),
          accessExpiresAt,
          refreshTokenHash: digest(refreshToken),
          name: String(body.deviceName || "iOS").slice(0, 160),
          createdAt: Date.now(),
        });
        return true;
      });
      this.state = updated.state;
      if (!updated.result) return sendJSON(response, 401, { error: "invalid_or_expired_ticket" });
      return sendJSON(response, 200, { ...this.info(), accessToken, accessExpiresAt, refreshToken });
    }
    if (request.method === "POST" && url.pathname === "/dsh-network/handoff/ios") {
      return this.createAppHandoff(request, response, await readJSON(request));
    }
    if (request.method === "POST" && url.pathname === "/dsh-network/refresh") {
      const body = await readJSON(request);
      const refreshHash = digest(body.refreshToken || "");
      const accessToken = randomBytes(32).toString("base64url");
      const refreshToken = randomBytes(48).toString("base64url");
      const accessExpiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
      const updated = await updateState(this.options.statePath, (state) => {
        const device = state.devices.find((item) => !item.revokedAt && safeEqual(item.refreshTokenHash, refreshHash));
        if (!device) return false;
        device.accessTokenHash = digest(accessToken);
        device.accessExpiresAt = accessExpiresAt;
        device.refreshTokenHash = digest(refreshToken);
        device.refreshedAt = Date.now();
        return true;
      });
      this.state = updated.state;
      if (!updated.result) return sendJSON(response, 401, { error: "invalid_refresh_token" });
      return sendJSON(response, 200, { accessToken, accessExpiresAt, refreshToken });
    }
    if (!(await this.authorized(request))) return sendJSON(response, 401, { error: "pairing_required" });
    await this.proxy(request, response);
  }

  async proxy(request, response, retry = true) {
    await this.ensureUpstreamSession();
    const headers = this.upstreamHeaders(request);
    const send = this.options.upstreamProtocol === "https:" ? httpsRequest : httpRequest;
    const upstream = send({
      host: this.options.upstreamHost,
      port: this.options.upstreamPort,
      method: request.method,
      path: request.url,
      headers,
    }, (upstreamResponse) => {
      const bodyless = request.method === "GET" || request.method === "HEAD";
      if (retry && bodyless && upstreamResponse.statusCode === 401 && this.upstreamSession !== null) {
        // The cached upstream session was rejected (expired or rotated): exchange
        // once more and replay. Bodyless requests can be re-issued safely.
        upstreamResponse.resume();
        this.upstreamSession = null;
        this.upstreamSessionExpiresAt = 0;
        this.proxy(request, response, false).catch((error) => {
          if (!response.headersSent) sendJSON(response, 502, { error: "dsh_unavailable" });
          else response.destroy();
          this.options.logger?.warn?.(error);
        });
        return;
      }
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) sendJSON(response, 502, { error: "dsh_unavailable" });
      else response.destroy();
    });
    if (request.method === "GET" || request.method === "HEAD") upstream.end();
    else request.pipe(upstream);
  }

  async handleUpgrade(request, socket, head) {
    if (!(await this.authorized(request))) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    await this.ensureUpstreamSession();
    const upstream = connectTcp(this.options.upstreamPort, this.options.upstreamHost, () => {
      const rewritten = this.upstreamHeaders(request);
      const headers = Object.entries(rewritten)
        .filter(([name]) => !["host", "cookie"].includes(name.toLowerCase()))
        .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`);
      headers.push(`host: ${this.options.upstreamHost}:${this.options.upstreamPort}`);
      if (this.upstreamSession) headers.push(`cookie: ${this.upstreamSession}`);
      upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    const pair = { socket, upstream };
    this.upgrades.add(pair);
    const forget = () => {
      if (socket.destroyed && upstream.destroyed) this.upgrades.delete(pair);
    };
    socket.once("close", forget);
    upstream.once("close", forget);
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  }

  async close() {
    if (!this.server) return;
    const pairs = [...this.upgrades];
    // Register every close listener before destroying anything, so quiescence
    // is observed rather than assumed.
    const sockets = [...this.connections, ...pairs.flatMap((pair) => [pair.socket, pair.upstream])];
    const closed = sockets.map((socket) => new Promise((resolve) => {
      if (socket.destroyed) {
        resolve();
        return;
      }
      socket.once("close", resolve);
    }));
    const serverClosed = new Promise((resolve) => this.server.close(resolve));
    this.server.closeAllConnections();
    // closeAllConnections() skips upgraded sockets, so every tracked socket is
    // destroyed explicitly and its close event is awaited above.
    for (const socket of [...this.connections]) socket.destroy();
    for (const pair of pairs) {
      pair.socket.destroy();
      pair.upstream.destroy();
    }
    await Promise.all([serverClosed, ...closed]);
    this.upgrades.clear();
  }
}
