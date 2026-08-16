import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const consoleDir = join(dirname(fileURLToPath(import.meta.url)), "../public");
