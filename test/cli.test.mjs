import assert from "node:assert/strict";
import test from "node:test";
import { setupModeForChoice } from "../lib/cli.js";

test("maps interactive setup choices to explicit connection modes", () => {
  assert.equal(setupModeForChoice("1"), "lan");
  assert.equal(setupModeForChoice(" 2 "), "tailscale");
  assert.equal(setupModeForChoice("3"), "custom");
  assert.equal(setupModeForChoice(""), undefined);
  assert.equal(setupModeForChoice("4"), undefined);
});
