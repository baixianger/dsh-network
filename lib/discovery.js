import { Bonjour } from "bonjour-service";

export class DshBonjourPublisher {
  constructor({ name, port, hostId, logger }) {
    this.bonjour = new Bonjour();
    this.service = this.bonjour.publish({
      name,
      type: "dsh",
      protocol: "tcp",
      port,
      txt: { version: "1", hostId, auth: "pairing-ticket", scheme: "http" },
    });
    logger?.info?.(`dsh-network: Bonjour ${name} on _dsh._tcp:${port}`);
  }

  async close() {
    await new Promise((resolve) => this.service.stop(resolve));
    this.bonjour.destroy();
  }
}
