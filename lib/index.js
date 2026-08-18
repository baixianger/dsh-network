import { hostname } from "node:os";
import { DshBonjourPublisher } from "./discovery.js";
import { DshNetworkGateway } from "./gateway.js";

export const DSH_NETWORK_PROTOCOL_VERSION = 1;
export const DSH_NETWORK_STAGE = "secure-gateway";
export const name = "dsh-network";
export const inject = ["webServer"];

export async function apply(ctx, config = {}) {
  const gateway = await new DshNetworkGateway({
    upstreamPort: ctx.webServer.port,
    gatewayPort: config.gatewayPort ?? 3081,
    bindHost: config.bindHost ?? "0.0.0.0",
    hostName: config.hostName ?? hostname(),
    statePath: config.statePath,
    logger: ctx.logger,
  }).start();
  const publisher = config.bonjour === false ? undefined : new DshBonjourPublisher({
    name: config.hostName ?? hostname(),
    port: gateway.port,
    hostId: gateway.state.hostId,
    logger: ctx.logger,
  });

  ctx.accessor("dshNetwork", { get: () => gateway });
  ctx.effect(() => async () => {
    await publisher?.close();
    await gateway.close();
  }, "dsh-network.gateway");
}

export { DshNetworkGateway, createPairingTicket, loadOrCreateState, defaultStatePath } from "./gateway.js";
