import { randomBytes } from "node:crypto";

import { createLaunchGate } from "./session";

const launchCode = process.env.AMW_LOCAL_LAUNCH_CODE ?? randomBytes(24).toString("base64url");
process.env.AMW_LOCAL_LAUNCH_CODE = launchCode;

type LaunchGate = ReturnType<typeof createLaunchGate>;

const sharedRuntime = globalThis as typeof globalThis & {
  __agentMemoryWikiLocalRuntime?: { readonly gate: LaunchGate; readonly launchCode: string };
};

const runtime = sharedRuntime.__agentMemoryWikiLocalRuntime ?? {
  gate: createLaunchGate(launchCode),
  launchCode,
};
sharedRuntime.__agentMemoryWikiLocalRuntime = runtime;

export const localSessionGate = runtime.gate;

export const getLaunchCode = (): string => runtime.launchCode;
