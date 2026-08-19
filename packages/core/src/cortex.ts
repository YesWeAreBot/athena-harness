import { Context, Service } from "cordis";

export abstract class Cortex extends Service {
  static inject = ["life"];

  constructor(ctx: Context, name: string) {
    super(ctx, name);
  }

  *[Service.init]() {
    this.ctx.life.registerCortex(this);
    yield () => this.ctx.life.unregisterCortex(this);
  }
}
