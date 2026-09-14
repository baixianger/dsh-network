import assert from "node:assert/strict";
import test from "node:test";
import { trimHistoryChunks, isTrustedApiRequest, isLoopbackHostname } from "../lib/history-trim.js";

function chunk(seq, turn, step, type, text = "") {
  return { event: { seq, type: "assistant/chunk", time: 1, data: { turn, step, chunk: { type, text } } } };
}
function message(seq, turn, step) {
  return { event: { seq, type: "assistant/message", time: 2, data: { turn, step, message: { id: "m", content: [] } } } };
}
function other(seq, type) {
  return { event: { seq, type, time: 1, data: {} } };
}

test("trimHistoryChunks drops chunks of settled steps, keeps structure", () => {
  const events = [
    other(1, "user/message"),
    chunk(2, 0, 0, "block-start"),
    chunk(3, 0, 0, "text-delta", "hel"),
    chunk(4, 0, 0, "text-delta", "lo"),
    message(5, 0, 0),
    other(6, "turn/end"),
  ];
  const out = trimHistoryChunks(events);
  // user/message + turn/end kept; only the first text-delta of the settled step kept
  assert.deepEqual(out.map((e) => e.event.type), ["user/message", "assistant/chunk", "assistant/message", "turn/end"]);
  assert.equal(out[1].event.data.chunk.text, "hel");
});

test("trimHistoryChunks keeps the tail partial (step never settles in page)", () => {
  const events = [
    other(1, "turn/start"),
    chunk(2, 1, 0, "block-start"),
    chunk(3, 1, 0, "text-delta", "part"),
    chunk(4, 1, 0, "reasoning-delta", "thinking"),
    // no assistant/message for turn 1 step 0 in this page
  ];
  const out = trimHistoryChunks(events);
  assert.equal(out.length, 4); // everything kept
});

test("trimHistoryChunks keeps only first token-delta per settled step", () => {
  const events = [
    chunk(1, 0, 0, "text-delta", "a"),
    chunk(2, 0, 0, "text-delta", "b"),
    chunk(3, 0, 0, "reasoning-delta", "r1"),
    chunk(4, 0, 1, "text-delta", "x"),
    message(5, 0, 0),
    message(6, 0, 1),
  ];
  const out = trimHistoryChunks(events);
  assert.deepEqual(out.map((e) => e.event.data.chunk?.text).filter(Boolean), ["a", "x"]);
});

test("trimHistoryChunks ignores non-array input", () => {
  assert.equal(trimHistoryChunks(undefined), undefined);
  assert.equal(trimHistoryChunks(null), null);
});

test("isLoopbackHostname covers localhost, ::1, and 127/8", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("[::1]"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("127.255.0.7"), true);
  assert.equal(isLoopbackHostname("128.0.0.1"), false);
  assert.equal(isLoopbackHostname("192.168.1.5"), false);
});

function req(host, extra = {}) {
  return { headers: { host, ...extra } };
}

test("fence accepts loopback Host", () => {
  assert.equal(isTrustedApiRequest(req("127.0.0.1:3080")), true);
  assert.equal(isTrustedApiRequest(req("localhost:3080")), true);
});

test("fence rejects non-loopback Host without trustedHosts", () => {
  assert.equal(isTrustedApiRequest(req("192.168.1.5:3080")), false);
  assert.equal(isTrustedApiRequest(req("evil.example")), false);
});

test("fence accepts declared trusted authorities", () => {
  assert.equal(isTrustedApiRequest(req("192.168.1.5:3080"), ["192.168.1.5:3080"]), true);
  assert.equal(isTrustedApiRequest(req("192.168.1.5:9999"), ["192.168.1.5"]), true);
  assert.equal(isTrustedApiRequest(req("192.168.1.6:3080"), ["192.168.1.5:3080"]), false);
});

test("fence refuses cross-site markers and foreign origins", () => {
  assert.equal(isTrustedApiRequest(req("127.0.0.1:3080", { "sec-fetch-site": "cross-site" })), false);
  assert.equal(isTrustedApiRequest(req("127.0.0.1:3080", { origin: "https://evil.example" })), false);
  assert.equal(isTrustedApiRequest(req("127.0.0.1:3080", { origin: "http://127.0.0.1:3080" })), true);
  assert.equal(isTrustedApiRequest({ headers: {} }), false);
  assert.equal(isTrustedApiRequest(null), false);
});

test("history trim handler serves the trimmed page in the RPC wire envelope", async () => {
  const { createHistoryTrimHandler } = await import("../lib/history-trim.js");

  // Stub ApiProxy returning a small page with a settled step + a tail partial.
  const events = [
    other(1, "user/message"),
    chunk(2, 0, 0, "block-start"),
    chunk(3, 0, 0, "text-delta", "hel"),
    chunk(4, 0, 0, "text-delta", "lo"),
    message(5, 0, 0),
    chunk(6, 1, 0, "text-delta", "streaming-"),
    chunk(7, 1, 0, "text-delta", "partial"),
  ];
  const apiProxy = {
    sessions: {
      history: async ({ rpcId, payload }) => {
        assert.equal(payload.sessionId, "s-1");
        return { rpcId, result: { ok: true, value: { events, hasMore: false } } };
      },
    },
  };

  const handler = createHistoryTrimHandler({ method: "session.history", apiProxy });

  // Fake request: loopback Host + async-iterable JSON body.
  const body = JSON.stringify({ type: "client-request", rpcId: "rpc-1", method: "session.history", payload: { sessionId: "s-1" } });
  const request = {
    headers: { host: "127.0.0.1:3080", "content-type": "application/json" },
    [Symbol.asyncIterator]() {
      let sent = false;
      return {
        next: async () => {
          if (sent) return { done: true };
          sent = true;
          return { done: false, value: Buffer.from(body) };
        },
      };
    },
  };
  const response = { writeHead() {}, end() {}, on() {}, headersSent: false };
  let wire;
  response.writeHead = (_status, headers) => { response.headers = headers; };
  response.end = (body2) => { wire = JSON.parse(body2.toString()); };

  await handler(request, response);

  assert.equal(wire.type, "server-response");
  assert.equal(wire.rpcId, "rpc-1");
  assert.equal(wire.result.ok, true);
  const served = wire.result.value.events;
  // user/message + first text-delta of settled step + assistant/message + tail partial chunks
  assert.deepEqual(served.map((e) => e.event.type), [
    "user/message", "assistant/chunk", "assistant/message", "assistant/chunk", "assistant/chunk",
  ]);
  assert.equal(served[1].event.data.chunk.text, "hel");      // first token delta kept
  assert.equal(served[3].event.data.chunk.text, "streaming-"); // tail partial kept
  assert.equal(served[4].event.data.chunk.text, "partial");
});

test("history trim handler refuses untrusted hosts and bad envelopes", async () => {
  const { createHistoryTrimHandler } = await import("../lib/history-trim.js");
  const apiProxy = { sessions: { history: async () => { throw new Error("must not be called"); } } };
  const handler = createHistoryTrimHandler({ method: "session.history", apiProxy });

  const untrusted = { headers: { host: "evil.example" }, [Symbol.asyncIterator]() { return { next: async () => ({ done: true }) }; } };
  const r1 = { writeHead() {}, end() {}, headersSent: false };
  let status1 = 0;
  r1.writeHead = (s) => { status1 = s; };
  await handler(untrusted, r1);
  assert.equal(status1, 403);

  const badEnvelope = { headers: { host: "127.0.0.1", "content-type": "application/json" }, [Symbol.asyncIterator]() { let sent = false; return { next: async () => sent ? { done: true } : (sent = true, { done: false, value: Buffer.from("{\"nope\":true}") }) }; } };
  const r2 = { writeHead() {}, end() {}, headersSent: false };
  let wire2;
  r2.writeHead = () => {};
  r2.end = (b) => { wire2 = JSON.parse(b.toString()); };
  await handler(badEnvelope, r2);
  assert.equal(wire2.result.ok, false);
  assert.equal(wire2.result.error.code, "bad-request");
});

function jsonRequest(body, headers = {}) {
  const text = JSON.stringify(body);
  return {
    headers: { host: "127.0.0.1:3080", "content-type": "application/json", ...headers },
    [Symbol.asyncIterator]() {
      let sent = false;
      return {
        next: async () => {
          if (sent) return { done: true };
          sent = true;
          return { done: false, value: Buffer.from(text) };
        },
      };
    },
  };
}

function captureResponse() {
  const listeners = new Map();
  const response = {
    status: 0,
    headersSent: false,
    writableEnded: false,
    body: undefined,
    writeHead(status) { response.status = status; response.headersSent = true; },
    end(body) { response.writableEnded = true; response.body = body; },
    on(event, listener) { listeners.set(event, listener); },
    emit(event) { listeners.get(event)?.(); },
  };
  return response;
}

test("history trim handler forwards the request signal and aborts it on disconnect", async () => {
  const { createHistoryTrimHandler } = await import("../lib/history-trim.js");
  let release;
  let seen;
  const apiProxy = {
    sessions: {
      history: async ({ rpcId }, signal) => {
        seen = signal;
        await new Promise((resolve) => { release = resolve; });
        return { rpcId, result: { ok: true, value: { events: [], hasMore: false } } };
      },
    },
  };
  const handler = createHistoryTrimHandler({ method: "session.history", apiProxy });
  const response = captureResponse();
  const pending = handler(
    jsonRequest({ type: "client-request", rpcId: "rpc-signal", method: "session.history", payload: { sessionId: "s-1" } }),
    response
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen instanceof AbortSignal, true);
  assert.equal(seen.aborted, false);
  // The client goes away before the response ends: the forwarded signal aborts.
  response.emit("close");
  assert.equal(seen.aborted, true);
  release();
  await pending;
  assert.equal(response.status, 200);
});

test("history trim handler prefers a signal supplied by the route", async () => {
  const { createHistoryTrimHandler } = await import("../lib/history-trim.js");
  let seen;
  const apiProxy = {
    sessions: {
      history: async ({ rpcId }, signal) => {
        seen = signal;
        return { rpcId, result: { ok: true, value: { events: [], hasMore: false } } };
      },
    },
  };
  const controller = new AbortController();
  await createHistoryTrimHandler({ method: "session.history", apiProxy })(
    jsonRequest({ type: "client-request", rpcId: "rpc-supplied", method: "session.history", payload: { sessionId: "s-1" } }),
    captureResponse(),
    controller.signal
  );
  assert.equal(seen, controller.signal);
});

test("history trim handler rejects unexpected payload keys and bad modes", async () => {
  const { createHistoryTrimHandler } = await import("../lib/history-trim.js");
  const apiProxy = {
    sessions: { history: async () => { throw new Error("must not be called"); } },
    subagents: { history: async () => { throw new Error("must not be called"); } },
  };

  const sessionResponse = captureResponse();
  await createHistoryTrimHandler({ method: "session.history", apiProxy })(
    jsonRequest({ type: "client-request", rpcId: "rpc-key", method: "session.history", payload: { sessionId: "s-1", unexpected: 1 } }),
    sessionResponse
  );
  const sessionWire = JSON.parse(sessionResponse.body.toString());
  assert.equal(sessionWire.result.ok, false);
  assert.equal(sessionWire.result.error.code, "bad-request");

  const subagentResponse = captureResponse();
  await createHistoryTrimHandler({ method: "subagent.history", apiProxy })(
    jsonRequest({
      type: "client-request",
      rpcId: "rpc-mode",
      method: "subagent.history",
      payload: { parentSessionId: "p-1", childSessionId: "c-1", mode: "bogus" },
    }),
    subagentResponse
  );
  assert.equal(JSON.parse(subagentResponse.body.toString()).result.error.code, "bad-request");
});

test("history trim handler accepts the schema-valid subagent payload", async () => {
  const { createHistoryTrimHandler } = await import("../lib/history-trim.js");
  let forwarded;
  const apiProxy = {
    subagents: {
      history: async ({ rpcId, payload }) => {
        forwarded = payload;
        return { rpcId, result: { ok: true, value: { events: [], hasMore: false } } };
      },
    },
  };
  const response = captureResponse();
  await createHistoryTrimHandler({ method: "subagent.history", apiProxy })(
    jsonRequest({
      type: "client-request",
      rpcId: "rpc-ok",
      method: "subagent.history",
      payload: { parentSessionId: "p-1", childSessionId: "c-1", mode: "continuable", maxMessages: 50 },
    }),
    response
  );
  assert.equal(response.status, 200);
  assert.deepEqual(forwarded, { parentSessionId: "p-1", childSessionId: "c-1", mode: "continuable", maxMessages: 50 });
});

test("history trim handler enforces the JSON media type before reading the body", async () => {
  const { createHistoryTrimHandler } = await import("../lib/history-trim.js");
  let called = false;
  const apiProxy = { sessions: { history: async () => { called = true; } } };
  const response = captureResponse();
  await createHistoryTrimHandler({ method: "session.history", apiProxy })(
    jsonRequest({ type: "client-request" }, { "content-type": "text/plain" }),
    response
  );
  assert.equal(response.status, 415);
  assert.equal(called, false);
});
