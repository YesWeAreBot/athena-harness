import { Context, Service } from "cordis";

export abstract class Cortex extends Service {
  static inject = ["life"];

  constructor(ctx: Context, name: string) {
    super(ctx, name);
  }

  *[Service.init]() {
    const unbind = this.ctx.life.bind(this);
    yield unbind;
  }
}
