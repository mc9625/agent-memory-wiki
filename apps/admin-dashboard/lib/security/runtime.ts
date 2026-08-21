import { randomBytes } from "node:crypto";

import { createLaunchGate } from "./session";

const launchCode = randomBytes(24).toString("base64url");

export const localSessionGate = createLaunchGate(launchCode);

export const getLaunchCode = (): string => launchCode;
