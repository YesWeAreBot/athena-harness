import { Schema } from "@athena-ai/core";
import { LifeService } from "@athena-ai/protocol";
import { Context, Service } from "cordis";

class Life extends LifeService {
  public static readonly name = "life";
  public static readonly inject = [];

  public id: string;
  public cortex: Service | null = null;

  constructor(ctx: Context, config: LifeService.Config) {
    super(ctx, "life");
    this.id = config.id;
  }
}

namespace Life {
  export const Config: Schema<LifeService.Config> = Schema.object({
    id: Schema.string().required(),
  });
}

export default Life;
