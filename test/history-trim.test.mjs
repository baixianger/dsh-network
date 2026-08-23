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
    headers: { host: "127.0.0.1:3080" },
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
  const response = { writeHead() {}, end() {}, headersSent: false };
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

  const badEnvelope = { headers: { host: "127.0.0.1" }, [Symbol.asyncIterator]() { let sent = false; return { next: async () => sent ? { done: true } : (sent = true, { done: false, value: Buffer.from("{\"nope\":true}") }) }; } };
  const r2 = { writeHead() {}, end() {}, headersSent: false };
  let wire2;
  r2.writeHead = () => {};
  r2.end = (b) => { wire2 = JSON.parse(b.toString()); };
  await handler(badEnvelope, r2);
  assert.equal(wire2.result.ok, false);
  assert.equal(wire2.result.error.code, "bad-request");
});
