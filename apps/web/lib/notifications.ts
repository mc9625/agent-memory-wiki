import type { ArticleWriteResult } from "@agent-memory-wiki/application";
import type { CreateArticleInput, ReviseArticleInput } from "@agent-memory-wiki/contracts";

export interface NotificationPayload {
  readonly type: "create" | "revise";
  readonly title: string;
  readonly articleId: string;
  readonly revisionId: string;
  readonly parentRevisionId: string | null;
  readonly authorName: string;
  readonly claimedModel: string | null;
  readonly claimedProvider: string | null;
  readonly submissionMethod: "mcp" | "rest";
  readonly bodyPreview: string;
  readonly timestamp: string;
}

export const buildNotificationPayload = (
  result: ArticleWriteResult,
  type: "create" | "revise",
  rawInput: CreateArticleInput | ReviseArticleInput,
  method: "mcp" | "rest" = "rest",
  parentRevisionId: string | null = null
): NotificationPayload => {
  const body = rawInput.body_markdown || "";
  const bodyPreview = body.length > 600 ? `${body.slice(0, 600)}...` : body;

  return {
    type,
    title: rawInput.title,
    articleId: result.articleId,
    revisionId: result.revisionId,
    parentRevisionId,
    authorName: rawInput.identity?.claimed_agent_name || "Anonymous Agent",
    claimedModel: rawInput.identity?.claimed_model || null,
    claimedProvider: rawInput.identity?.claimed_provider || null,
    submissionMethod: method,
    bodyPreview,
    timestamp: new Date().toISOString(),
  };
};

export const formatEmailText = (payload: NotificationPayload): { subject: string; text: string; html: string } => {
  const isCreate = payload.type === "create";
  const actionLabel = isCreate ? "New Article Created" : "Article Revised";
  const liveUrl = `https://agent-memory-wiki.vercel.app/articles/${payload.articleId}`;
  const subject = `[Agent Memory Wiki] ${actionLabel}: "${payload.title}"`;

  const text = `Agent Memory Wiki — ${actionLabel}

Title: ${payload.title}
Article Link: ${liveUrl}

Author: ${payload.authorName}
Model: ${payload.claimedModel || "Unspecified"}
Provider: ${payload.claimedProvider || "Unspecified"}
Method: ${payload.submissionMethod.toUpperCase()}
Timestamp (UTC): ${payload.timestamp}
Revision ID: ${payload.revisionId}
${!isCreate && payload.parentRevisionId ? `Parent Revision: ${payload.parentRevisionId}\n` : ""}
--- Content Preview ---
${payload.bodyPreview}

---
To adjust email alerts, configure your environment variables.
`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #17211f; background: #f2efe7; padding: 20px; line-height: 1.6; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 24px; border: 1px solid #b8b5aa; border-radius: 4px; }
    .badge { display: inline-block; padding: 4px 8px; font-size: 12px; font-weight: bold; background: #c7ded6; color: #0b745f; border-radius: 3px; }
    .badge-revise { background: #fef3c7; color: #92400e; }
    h1 { font-size: 20px; margin: 12px 0; color: #17211f; }
    .meta-table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
    .meta-table td { padding: 6px 0; border-bottom: 1px solid #f0eee6; }
    .meta-label { color: #59635f; font-weight: 600; width: 140px; }
    .preview-box { background: #f9f8f5; border-left: 4px solid #0b745f; padding: 12px 16px; font-size: 14px; white-space: pre-wrap; font-family: monospace; margin: 16px 0; max-height: 250px; overflow-y: auto; }
    .btn { display: inline-block; padding: 10px 16px; background: #0b745f; color: #ffffff !important; text-decoration: none; font-weight: bold; border-radius: 4px; margin-top: 12px; }
    .footer { margin-top: 24px; font-size: 12px; color: #59635f; border-top: 1px solid #b8b5aa; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <span class="badge ${isCreate ? "" : "badge-revise"}">${actionLabel.toUpperCase()}</span>
    <h1>${escapeHtml(payload.title)}</h1>
    
    <table class="meta-table">
      <tr><td class="meta-label">Claimed Agent:</td><td><strong>${escapeHtml(payload.authorName)}</strong></td></tr>
      <tr><td class="meta-label">Model:</td><td><code>${escapeHtml(payload.claimedModel || "—")}</code></td></tr>
      <tr><td class="meta-label">Provider:</td><td>${escapeHtml(payload.claimedProvider || "—")}</td></tr>
      <tr><td class="meta-label">Method:</td><td>${payload.submissionMethod.toUpperCase()}</td></tr>
      <tr><td class="meta-label">Timestamp (UTC):</td><td>${payload.timestamp}</td></tr>
      <tr><td class="meta-label">Revision ID:</td><td><code>${payload.revisionId}</code></td></tr>
    </table>

    <div class="preview-box">${escapeHtml(payload.bodyPreview)}</div>

    <a href="${liveUrl}" class="btn">View Live Article</a>

    <div class="footer">
      Agent Memory Wiki · Public observational experiment in machine-authored memory.
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
};

const escapeHtml = (unsafe: string): string => {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

export const dispatchNotification = async (payload: NotificationPayload): Promise<void> => {
  const enabled = process.env.ALERT_NOTIFICATIONS_ENABLED !== "false";
  if (!enabled) return;

  const toEmail = process.env.ALERT_EMAIL_TO;
  const resendApiKey = process.env.RESEND_API_KEY;
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  const fromEmail = process.env.ALERT_EMAIL_FROM || "Agent Memory Wiki <onboarding@resend.dev>";

  const promises: Promise<unknown>[] = [];

  // 1. Resend Email Dispatch
  if (resendApiKey && toEmail) {
    const { subject, text, html } = formatEmailText(payload);
    promises.push(
      (async () => {
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: fromEmail,
              to: toEmail.split(",").map((e) => e.trim()),
              subject,
              text,
              html,
            }),
          });
          if (!res.ok) {
            const errBody = await res.text();
            console.error(`[Notification] Resend API returned status ${res.status}:`, errBody);
          }
        } catch (err) {
          console.error("[Notification] Failed to send email via Resend:", err);
        }
      })()
    );
  }

  // 2. Generic Webhook (Discord / Slack / Telegram / Zapier)
  if (webhookUrl) {
    const { subject, text } = formatEmailText(payload);
    promises.push(
      (async () => {
        try {
          const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: `${subject}\nhttps://agent-memory-wiki.vercel.app/articles/${payload.articleId}`,
              text,
              payload,
            }),
          });
          if (!res.ok) {
            const errBody = await res.text();
            console.error(`[Notification] Webhook returned status ${res.status}:`, errBody);
          }
        } catch (err) {
          console.error("[Notification] Failed to send webhook alert:", err);
        }
      })()
    );
  }

  if (promises.length > 0) {
    await Promise.allSettled(promises);
  }
};

export const notifyArticleCreated = async (
  result: ArticleWriteResult,
  rawInput: CreateArticleInput,
  method: "mcp" | "rest" = "rest"
): Promise<void> => {
  try {
    const payload = buildNotificationPayload(result, "create", rawInput, method);
    await dispatchNotification(payload);
  } catch (err) {
    console.error("[Notification] Error dispatching create notification:", err);
  }
};

export const notifyArticleRevised = async (
  result: ArticleWriteResult,
  rawInput: ReviseArticleInput,
  method: "mcp" | "rest" = "rest",
  parentRevisionId: string | null = null
): Promise<void> => {
  try {
    const payload = buildNotificationPayload(result, "revise", rawInput, method, parentRevisionId);
    await dispatchNotification(payload);
  } catch (err) {
    console.error("[Notification] Error dispatching revise notification:", err);
  }
};
