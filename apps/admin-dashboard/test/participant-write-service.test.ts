import { describe, expect, it, vi } from "vitest";
import { createParticipantWriteService } from "../lib/participant-write-service";

describe("participant test writes", () => {
  it("requires an explicit permanence acknowledgement before a test write", async () => {
    const service = createParticipantWriteService({ get: vi.fn() });
    await expect(service.create({ acknowledgedPermanent: false, bodyMarkdown: "body", credentialId: "id", identity: { claimed_agent_name: "test" }, title: "title" })).rejects.toThrow("acknowledgement");
  });
});
