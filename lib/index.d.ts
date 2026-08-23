export declare const DSH_NETWORK_PROTOCOL_VERSION: 1;
export declare const DSH_NETWORK_STAGE: "secure-gateway";
export declare const name = "dsh-network";
export declare const inject: readonly ["webServer"];
export interface DshNetworkConfig {
  gatewayPort?: number;
  bindHost?: string;
  hostName?: string;
  statePath?: string;
  iosAppDownloadURL?: string;
  /**
   * Trim redundant assistant/chunk streaming deltas from
   * session.history / subagents.history responses. A long turn can emit 95k+
   * chunk frames that settle into one assistant/message; removing them cuts
   * the wire page by >99% with no semantic change (the in-progress partial and
   * per-step first token-delta are kept). Default true.
   */
  historyChunkTrim?: boolean;
  /**
   * Extra trusted Host authorities for the trimmed-history route fence.
   * Mirror client-connection's trustedHosts when the web server binds 0.0.0.0
   * and clients reach it directly by LAN address. Default [] (loopback only).
   */
  historyTrustedHosts?: string[];
}
export declare function apply(ctx: any, config?: DshNetworkConfig): Promise<void>;
export declare class DshNetworkGateway {
  constructor(options: Record<string, unknown>);
  start(): Promise<this>;
  close(): Promise<void>;
  readonly port: number;
  readonly state: { hostId: string; tickets: unknown[]; devices: unknown[] };
  info(): { protocolVersion: number; hostId: string; name: string; requiresPairing: boolean };
  status(): { protocolVersion: number; hostId: string; name: string; requiresPairing: boolean; gatewayPort: number; bindHost: string; pairedDevices: number };
}
export declare function defaultStatePath(): string;
export declare function lanURL(port: number): string;
export declare function loadOrCreateState(path?: string): Promise<{ hostId: string; tickets: unknown[]; devices: unknown[] }>;
export declare function createPairingTicket(options?: { statePath?: string; ttlSeconds?: number }): Promise<{ ticket: string; expiresAt: number; hostId: string }>;
