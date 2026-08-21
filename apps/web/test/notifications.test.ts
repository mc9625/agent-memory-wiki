import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildNotificationPayload,
  formatEmailText,
  dispatchNotification,
  notifyArticleCreated,
  notifyArticleRevised,
} from "../lib/notifications";
import type { ArticleWriteResult } from "@agent-memory-wiki/application";

describe("notifications module", () => {
  const mockResult: ArticleWriteResult = {
    articleId: "11111111-1111-4000-8000-111111111111",
    revisionId: "22222222-2222-4000-8000-222222222222",
    submissionId: "33333333-3333-4000-8000-333333333333",
    replayed: false,
  };

  const rawInput = {
    title: "Test Article Title",
    body_markdown: "# Test Article Body\n\nContent here.",
    identity: {
      claimed_agent_name: "Hermes",
      claimed_model: "Hermes-3-70B",
      claimed_provider: "Lambda",
    },
  };

  it("builds notification payload for create_article", () => {
    const payload = buildNotificationPayload(mockResult, "create", rawInput, "rest");
    expect(payload.type).toBe("create");
    expect(payload.title).toBe("Test Article Title");
    expect(payload.articleId).toBe("11111111-1111-4000-8000-111111111111");
    expect(payload.authorName).toBe("Hermes");
    expect(payload.claimedModel).toBe("Hermes-3-70B");
    expect(payload.submissionMethod).toBe("rest");
    expect(payload.bodyPreview).toContain("Test Article Body");
  });

  it("builds notification payload for revise_article with parent revision", () => {
    const payload = buildNotificationPayload(
      mockResult,
      "revise",
      {
        ...rawInput,
        parent_revision_id: "00000000-0000-4000-8000-000000000001",
      },
      "mcp",
      "00000000-0000-4000-8000-000000000001"
    );
    expect(payload.type).toBe("revise");
    expect(payload.submissionMethod).toBe("mcp");
    expect(payload.parentRevisionId).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("formats email text and html properly", () => {
    const payload = buildNotificationPayload(mockResult, "create", rawInput, "rest");
    const { subject, text, html } = formatEmailText(payload);

    expect(subject).toBe('[Agent Memory Wiki] New Article Created: "Test Article Title"');
    expect(text).toContain("Title: Test Article Title");
    expect(text).toContain("Author: Hermes");
    expect(text).toContain("Model: Hermes-3-70B");
    expect(html).toContain("NEW ARTICLE CREATED");
    expect(html).toContain("Test Article Title");
    expect(html).toContain("Hermes-3-70B");
  });

  describe("dispatchNotification", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      vi.restoreAllMocks();
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("does nothing when notifications are disabled", async () => {
      process.env.ALERT_NOTIFICATIONS_ENABLED = "false";
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

      const payload = buildNotificationPayload(mockResult, "create", rawInput, "rest");
      await dispatchNotification(payload);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("dispatches to Resend and Webhook when configured", async () => {
      process.env.ALERT_NOTIFICATIONS_ENABLED = "true";
      process.env.RESEND_API_KEY = "mock-resend-api-key";
      process.env.ALERT_EMAIL_TO = "test@example.com";
      process.env.ALERT_WEBHOOK_URL = "https://webhook.example.com/alert";

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

      const payload = buildNotificationPayload(mockResult, "create", rawInput, "rest");
      await dispatchNotification(payload);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer mock-resend-api-key",
          }),
        })
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://webhook.example.com/alert",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    it("handles network failure gracefully without throwing", async () => {
      process.env.RESEND_API_KEY = "mock-resend-api-key";
      process.env.ALERT_EMAIL_TO = "test@example.com";

      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network offline"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const payload = buildNotificationPayload(mockResult, "create", rawInput, "rest");
      await expect(dispatchNotification(payload)).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe("fail-safe callers", () => {
    it("calls notifyArticleCreated and notifyArticleRevised without throwing", () => {
      expect(() => notifyArticleCreated(mockResult, rawInput, "rest")).not.toThrow();
      expect(() =>
        notifyArticleRevised(
          mockResult,
          {
            ...rawInput,
            parent_revision_id: "00000000-0000-4000-8000-000000000001",
          },
          "mcp",
          "00000000-0000-4000-8000-000000000001"
        )
      ).not.toThrow();
    });
  });
});
