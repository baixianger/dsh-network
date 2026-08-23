#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";

import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import qrcode from "qrcode-terminal";
import { createPairingTicket, defaultStatePath, lanURL, loadOrCreateState } from "./gateway.js";

function tailscaleBinary() {
  const candidates = process.platform === "win32"
    ? ["tailscale.exe"]
    : ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale"];
  for (const candidate of candidates) {
    if (!candidate.includes("/") || existsSync(candidate)) {
      try {
        execFileSync(candidate, ["version"], { stdio: "ignore" });
        return candidate;
      } catch {}
    }
  }
  throw new Error("Tailscale CLI was not found. Install and sign in to Tailscale first.");
}

function run(binary, args, options = {}) {
  const output = execFileSync(binary, args, { encoding: "utf8", ...options });
  return typeof output === "string" ? output.trim() : "";
}

function option(args, name) {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
}

function showQR({ url, ticket, hostId, expiresAt }) {
  if (!url) throw new Error("A pairing URL is required. Pass --url, or use `dsh-network setup` for Tailscale.");
  const payloadURL = new URL("/dsh-network/connect", url);
  payloadURL.hash = new URLSearchParams({ v: "1", t: ticket, h: hostId }).toString();
  const payload = payloadURL.toString();
  qrcode.generate(payload, { small: true });
  console.log(`Pairing ticket expires: ${new Date(expiresAt).toLocaleString()}`);
  if (url) console.log(`Host URL: ${url}`);
}

async function pair(args) {
  const ttlSeconds = Number(option(args, "--ttl") || 300);
  const url = option(args, "--url");
  showQR({ ...(await createPairingTicket({ ttlSeconds })), url });
}

export function setupModeForChoice(choice) {
  return ({ "1": "lan", "2": "tailscale", "3": "custom" })[String(choice).trim()];
}

async function ask(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("No setup mode was provided in a non-interactive shell. Use `setup lan`, `setup tailscale`, or `setup custom --url <url>`.");
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await prompt.question(question)).trim();
  } finally {
    prompt.close();
  }
}

async function chooseSetupMode() {
  console.log("Choose a connection method / 选择连接方式:");
  console.log("  1. LAN / 家庭或局域网");
  console.log("  2. Tailscale / Tailnet");
  console.log("  3. Custom address / 自定义地址");
  const choice = await ask("Select 1, 2, or 3: ");
  const mode = setupModeForChoice(choice);
  if (!mode) throw new Error("Invalid selection. Choose 1, 2, or 3.");
  return mode;
}

async function setup(args) {
  const mode = args[0] && !args[0].startsWith("--") ? args.shift() : await chooseSetupMode();
  const gatewayPort = Number(option(args, "--gateway-port") || 3081);
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) throw new Error("invalid gateway port");
  if (mode === "lan") {
    const url = option(args, "--url") || lanURL(gatewayPort);
    return showQR({ ...(await createPairingTicket()), url });
  }
  if (mode === "custom") {
    const url = option(args, "--url") || await ask("Host URL (for example https://dsh.example.com): ");
    return showQR({ ...(await createPairingTicket()), url });
  }
  if (mode !== "tailscale") throw new Error("Setup mode must be `lan`, `tailscale`, or `custom`.");
  const binary = tailscaleBinary();
  const status = JSON.parse(run(binary, ["status", "--json"]));
  const dnsName = String(status.Self?.DNSName || "").replace(/\.$/, "");
  if (!dnsName) throw new Error("This host has no Tailscale MagicDNS name.");
  run(binary, ["serve", "--bg", String(gatewayPort)], { stdio: "inherit" });
  showQR({ ...(await createPairingTicket()), url: `https://${dnsName}` });
}

async function main() {
  const [command = "status", ...args] = process.argv.slice(2);
  if (command === "setup") return setup(args);
  if (command === "pair") return pair(args);
  if (command === "status") {
    const state = await loadOrCreateState(defaultStatePath());
    console.log(JSON.stringify({ hostId: state.hostId, pairedDevices: state.devices.filter((item) => !item.revokedAt).length }, null, 2));
    return;
  }
  throw new Error("Usage: dsh-network setup [lan|tailscale|custom] [--url <url>] | pair --url <url> | status");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`dsh-network: ${error.message}`);
    process.exitCode = 1;
  });
}
