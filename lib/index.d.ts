export declare const DSH_NETWORK_PROTOCOL_VERSION: 1;
export declare const DSH_NETWORK_STAGE: "secure-gateway";
export declare const name = "dsh-network";
export declare const inject: readonly ["webServer"];
export interface DshNetworkConfig {
  gatewayPort?: number;
  bindHost?: string;
  hostName?: string;
  statePath?: string;
  bonjour?: boolean;
}
export declare function apply(ctx: any, config?: DshNetworkConfig): Promise<void>;
export declare class DshNetworkGateway {
  constructor(options: Record<string, unknown>);
  start(): Promise<this>;
  close(): Promise<void>;
  readonly port: number;
  readonly state: { hostId: string; tickets: unknown[]; devices: unknown[] };
}
export declare function defaultStatePath(): string;
export declare function loadOrCreateState(path?: string): Promise<{ hostId: string; tickets: unknown[]; devices: unknown[] }>;
export declare function createPairingTicket(options?: { statePath?: string; ttlSeconds?: number }): Promise<{ ticket: string; expiresAt: number; hostId: string }>;
