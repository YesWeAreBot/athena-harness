import { Context, Service } from "cordis";

export abstract class CortexService extends Service {
  static inject = ["life"];

  constructor(ctx: Context, name: string) {
    super(ctx, name);
  }

  *[Service.init]() {
    yield this.ctx.life.bind(this);
  }
}
