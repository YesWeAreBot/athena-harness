import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadRuntimeConfig } from "@yesimbot/athena-config";
import { createRuntimeApiServer } from "@yesimbot/athena-runtime-api";
import { RuntimeManager } from "@yesimbot/athena-runtime-manager";

const EXAMPLE_CONFIG = `runtime:
  name: my-athena
  dataDir: ./data

core:
  persistence: jsonl

modes:
  - id: echo
    package: builtin:echo

bodies:
  - id: manual
    package: builtin:manual

lives:
  - id: athena-1
    mode: echo
    bodies: [manual]

api:
  host: 127.0.0.1
  port: 7788
`;

export async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "init":
      await init(rest[0]);
      return;
    case "validate":
      await validate(rest[0]);
      return;
    case "start":
      await start(rest[0]);
      return;
    case "life:list":
      await lifeList(rest[0]);
      return;
    default:
      usage();
  }
}

async function init(dir = "."): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "athena.config.yaml"), EXAMPLE_CONFIG, "utf8");
  console.log(`Created ${join(dir, "athena.config.yaml")}`);
}

async function validate(path: string | undefined): Promise<void> {
  const config = await loadConfig(path);
  console.log(JSON.stringify({ ok: true, name: config.runtime.name, lives: config.lives.length }, null, 2));
}

async function start(path: string | undefined): Promise<void> {
  const config = await loadConfig(path);
  const manager = new RuntimeManager(config);
  await manager.start();
  const server = createRuntimeApiServer({ manager, token: config.api.token });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.api.port, config.api.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  console.log(`Athena Runtime started at http://${config.api.host}:${config.api.port}`);
  await new Promise<void>((resolve) => {
    const shutdown = () => resolve();
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await manager.dispose();
}

async function lifeList(path: string | undefined): Promise<void> {
  const config = await loadConfig(path);
  const manager = new RuntimeManager(config);
  try {
    await manager.start();
    console.log(JSON.stringify(manager.listLives(), null, 2));
  } finally {
    await manager.dispose();
  }
}

async function loadConfig(path = "athena.config.yaml") {
  return loadRuntimeConfig(path);
}

function usage(): void {
  console.log(`Usage:
  athena init [dir]
  athena validate [config]
  athena start [config]
  athena life:list [config]`);
  process.exitCode = 1;
}

export { init, lifeList, loadConfig, start, usage, validate };
