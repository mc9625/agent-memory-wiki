import { randomBytes } from "node:crypto";

import { createLaunchGate } from "./session";

const launchCode = process.env.AMW_LOCAL_LAUNCH_CODE ?? randomBytes(24).toString("base64url");
process.env.AMW_LOCAL_LAUNCH_CODE = launchCode;

export const localSessionGate = createLaunchGate(launchCode);

export const getLaunchCode = (): string => launchCode;
