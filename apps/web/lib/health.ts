export interface ReadinessProbe {
  probe(): Promise<{ readonly migrationsCompatible: boolean; readonly readOnly: boolean | null }>;
}

const response = (body: unknown, status: number): Response =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export const liveness = (): Response => response({ status: "live" }, 200);

export const readiness = async (dependencies: ReadinessProbe): Promise<Response> => {
  try {
    const state = await dependencies.probe();
    if (!state.migrationsCompatible || state.readOnly === null) {
      return response({ status: "unavailable" }, 503);
    }
    return response({ status: "ready" }, 200);
  } catch {
    return response({ status: "unavailable" }, 503);
  }
};
