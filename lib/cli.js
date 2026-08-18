#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import qrcode from "qrcode-terminal";
import { createPairingTicket, defaultStatePath, loadOrCreateState } from "./gateway.js";

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

function lanURL(port) {
  const addresses = Object.values(networkInterfaces()).flat().filter((entry) =>
    entry && !entry.internal && (entry.family === "IPv4" || entry.family === 4) &&
    (/^10\./.test(entry.address) || /^192\.168\./.test(entry.address) || /^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)));
  if (!addresses.length) throw new Error("No private LAN IPv4 address was found. Pass --url http://HOST:PORT explicitly.");
  return `http://${addresses[0].address}:${port}`;
}

function showQR({ url, ticket, hostId, expiresAt }) {
  if (!url) throw new Error("A pairing URL is required. Pass --url, or use `dsh-network setup` for Tailscale.");
  const payloadURL = new URL("/dsh-network/connect", url);
  payloadURL.hash = new URLSearchParams({ v: "1", t: ticket, h: hostId }).toString();
  const payload = payloadURL.toString();
  qrcode.generate(payload, { small: true });
  console.log(`Pairing ticket expires: ${new Date(expiresAt).toLocaleString()}`);
  if (url) console.log(`Server URL: ${url}`);
}

async function pair(args) {
  const ttlSeconds = Number(option(args, "--ttl") || 300);
  const url = option(args, "--url");
  showQR({ ...(await createPairingTicket({ ttlSeconds })), url });
}

async function setup(args) {
  const mode = args[0] && !args[0].startsWith("--") ? args.shift() : "tailscale";
  const gatewayPort = Number(option(args, "--gateway-port") || 3081);
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) throw new Error("invalid gateway port");
  if (mode === "lan") {
    const url = option(args, "--url") || lanURL(gatewayPort);
    return showQR({ ...(await createPairingTicket()), url });
  }
  if (mode !== "tailscale") throw new Error("Setup mode must be `lan` or `tailscale`.");
  const binary = tailscaleBinary();
  const status = JSON.parse(run(binary, ["status", "--json"]));
  const dnsName = String(status.Self?.DNSName || "").replace(/\.$/, "");
  if (!dnsName) throw new Error("This device has no Tailscale MagicDNS name.");
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
  throw new Error("Usage: dsh-network setup [lan|tailscale] | pair --url <url> | status");
}

main().catch((error) => {
  console.error(`dsh-network: ${error.message}`);
  process.exitCode = 1;
});
