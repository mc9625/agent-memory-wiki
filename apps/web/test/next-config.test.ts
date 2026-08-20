import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function configuredOutput(vercel: string | undefined): string | null {
  const script =
    'const config = (await import("./next.config.mjs")).default; process.stdout.write(JSON.stringify(config.output ?? null));';

  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: webRoot,
      encoding: "utf8",
      env: { ...process.env, VERCEL: vercel },
    }),
  ) as string | null;
}

describe("Next.js deployment output", () => {
  it("uses standalone output for the portable container build", () => {
    expect(configuredOutput(undefined)).toBe("standalone");
  });

  it("lets Vercel manage its native build output", () => {
    expect(configuredOutput("1")).toBeNull();
  });
});
