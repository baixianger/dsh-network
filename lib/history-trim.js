// history-trim.js — optional exact-route shadows for /api/session.history and
// /api/subagents.history that drop redundant assistant/chunk streaming deltas
// from the served page.
//
// Why: a single long turn can emit 95k+ chunk frames, and the history page
// serializes every one of them (a 50-message tail can weigh ~18MB). Yet chunks
// never surface as display rows: a settled step's content is fully replaced by
// its final assistant/message, and only the in-progress step's partial is
// something clients actually consume. Trimming the wire page cuts the payload
// by >99% with zero semantic change for every known client (Web and iOS both
// fold the page the same way).
//
// Kept chunks:
//   1. the tail partial — chunks of a step that has no assistant/message in
//      this page (the currently streaming turn);
//   2. the first token-delta of every other step, so the Web UI's
//      "time to first token" timing keeps its data source.
//
// Pure module: no core imports, so it runs under plain node for tests. The
// Host fence is an inlined mirror of isTrustedApiRequest from
// @deepseek-ai/dsh-client-connection (see isTrustedApiRequest below).

const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** Mirror of dsh-llm isTokenDelta: a chunk that carries visible stream content. */
export function isTokenDeltaLike(chunk) {
  if (!chunk || typeof chunk !== "object") return false;
  switch (chunk.type) {
    case "text-delta":
    case "reasoning-delta":
      return chunk.text !== "";
    case "tool-call-delta":
      return chunk.argumentsDelta !== "" || chunk.name !== undefined;
    default:
      return false;
  }
}

/**
 * Drop assistant/chunk events that are redundant on the wire page.
 * @param events - the history page's events array (each entry { event, view? }).
 * @returns a new array with only the kept events.
 */
export function trimHistoryChunks(events) {
  if (!Array.isArray(events)) return events;
  // Steps that already settled in this page: their chunks are fully replaced
  // by the final assistant/message and only the first token-delta is kept.
  const finalized = new Set();
  for (const entry of events) {
    const event = entry && entry.event;
    if (!event || event.type !== "assistant/message") continue;
    const data = event.data;
    if (data && typeof data.turn === "number" && typeof data.step === "number") {
      finalized.add(`${data.turn}:${data.step}`);
    }
  }
  const firstTokenKept = new Set();
  const trimmed = [];
  for (const entry of events) {
    const event = entry && entry.event;
    if (!event || event.type !== "assistant/chunk") {
      trimmed.push(entry);
      continue;
    }
    const data = event.data || {};
    const key = typeof data.turn === "number" && typeof data.step === "number"
      ? `${data.turn}:${data.step}`
      : null;
    // Tail partial (step never settles in this page) — keep everything.
    if (key === null || !finalized.has(key)) {
      trimmed.push(entry);
      continue;
    }
    // Settled step — keep only the first token-delta (first-token timing).
    if (isTokenDeltaLike(data.chunk) && !firstTokenKept.has(key)) {
      firstTokenKept.add(key);
      trimmed.push(entry);
    }
  }
  return trimmed;
}

// ---- Host fence ----------------------------------------------------------
// Inlined mirror of @deepseek-ai/dsh-client-connection/src/api-request-trust.ts
// (loopback / trusted-authority Host check + cross-site + origin fences).
// Kept in-repo so the shadow route needs no core-package src import; the
// behavior matches isTrustedApiRequest(request, trustedHosts).

function header(headers, name) {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`);
  } catch {
    return undefined;
  }
}

function canonicalAuthority(entry, entryUrl) {
  const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
  return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}

function isTrustedAuthority(hostUrl, trustedHosts) {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry);
    if (entryUrl === undefined) return false;
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host;
  });
}

/** True for localhost, [::1], or any IPv4 address in 127/8. */
export function isLoopbackHostname(hostname) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return parts.length === 4
    && parts[0] === "127"
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * Decide whether one request may reach the trimmed history handler.
 * @param request - Node HTTP request (headers read only).
 * @param trustedHosts - non-loopback authorities this deployment serves
 *   (mirror client-connection's trustedHosts when the web server binds 0.0.0.0).
 * @returns true when the Host is loopback/trusted and browser markers are same-origin.
 */
export function isTrustedApiRequest(request, trustedHosts = []) {
  const headers = request && request.headers;
  if (!headers) return false;
  const host = header(headers, "host");
  if (host === undefined) return false;
  const hostUrl = parseAuthority(host);
  if (hostUrl === undefined) return false;
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
  if (header(headers, "sec-fetch-site") === "cross-site") return false;
  const origin = header(headers, "origin");
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

// ---- HTTP handler --------------------------------------------------------

async function readJSONBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return null;
  return JSON.parse(text);
}

function writeJSON(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  response.end(body);
}

function writeBadRequest(response, rpcId, message) {
  writeJSON(response, 200, {
    type: "server-response",
    rpcId,
    result: { ok: false, error: { code: "bad-request", message, details: { issues: [] } } },
  });
}

function writeForbidden(response) {
  response.writeHead(403);
  response.end("forbidden");
}

/**
 * Build the exact-route handler that shadows one history method on the host
 * web server, trimming redundant chunks from the served page.
 * @param options.method - "session.history" or "subagents.history".
 * @param options.apiProxy - the host ApiProxy service (ctx.apiProxy).
 * @param options.trustedHosts - extra trusted Host authorities for the fence.
 * @param options.logger - optional logger.
 * @returns (req, res) => Promise<void> — a WebRoute handler.
 */
export function createHistoryTrimHandler({ method, apiProxy, trustedHosts = [], logger }) {
  return async function historyTrimHandler(request, response) {
    try {
      if (!isTrustedApiRequest(request, trustedHosts)) {
        writeForbidden(response);
        return;
      }
      let body;
      try {
        body = await readJSONBody(request);
      } catch (error) {
        logger?.warn?.(error);
        writeBadRequest(response, "invalid-request", `invalid request body for ${method}`);
        return;
      }
      const rpcId = body && typeof body.rpcId === "string" ? body.rpcId : "invalid-request";
      if (!body || body.type !== "client-request" || body.method !== method || typeof body.payload !== "object" || body.payload === null) {
        writeBadRequest(response, rpcId, `invalid request for ${method}`);
        return;
      }
      const payload = body.payload;
      if (method === "session.history") {
        if (typeof payload.sessionId !== "string") {
          writeBadRequest(response, rpcId, `invalid payload for ${method}`);
          return;
        }
      } else if (method === "subagents.history") {
        if (typeof payload.parentSessionId !== "string" || typeof payload.childSessionId !== "string") {
          writeBadRequest(response, rpcId, `invalid payload for ${method}`);
          return;
        }
      } else {
        writeBadRequest(response, rpcId, `unsupported method ${method}`);
        return;
      }
      const narrow = await apiProxy[method === "session.history" ? "sessions" : "subagents"]
        .history({ rpcId, payload });
      let result = narrow.result;
      if (result.ok && result.value && typeof result.value === "object") {
        const value = result.value;
        if (Array.isArray(value.events)) {
          result = { ok: true, value: { ...value, events: trimHistoryChunks(value.events) } };
        }
      }
      writeJSON(response, 200, { type: "server-response", rpcId: narrow.rpcId, result });
    } catch (error) {
      logger?.warn?.(error);
      if (!response.headersSent) {
        response.writeHead(500);
        response.end(`handler failure: ${String(error)}`);
      } else {
        response.destroy();
      }
    }
  };
}
