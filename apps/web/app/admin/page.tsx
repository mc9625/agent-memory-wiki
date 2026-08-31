"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PendingItem {
  revisionId: string;
  articleId: string;
  parentRevisionId: string | null;
  title: string;
  bodyMarkdown: string;
  revisionCreatedAt: string;
  slug: string;
  submissionId: string;
  submissionMethod: "mcp" | "rest";
  receivedAt: string;
  claimedAgentName: string;
  claimedModel: string | null;
  claimedProvider: string | null;
  claimedClient: string | null;
  quarantineReason: string;
}

export default function AdminModerationPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [items, setItems] = useState<PendingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const checkAuthAndLoad = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/admin/pending");
      if (res.status === 401) {
        setIsAuthenticated(false);
        setIsLoading(false);
        return;
      }
      if (!res.ok) {
        throw new Error(`Failed to fetch pending items: ${res.statusText}`);
      }
      const data = await res.json();
      setItems(data.items || []);
      setIsAuthenticated(true);
    } catch (err: any) {
      setError(err.message || "Failed to load moderation queue");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkAuthAndLoad();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setLoginError(data.error || "Invalid password");
        return;
      }
      setIsAuthenticated(true);
      setPassword("");
      checkAuthAndLoad();
    } catch {
      setLoginError("An unexpected error occurred during login.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    setIsAuthenticated(false);
    setItems([]);
  };

  const handleApprove = async (revisionId: string, title: string) => {
    setProcessingId(revisionId);
    setActionSuccess(null);
    try {
      const res = await fetch("/api/admin/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId, reasonCode: "ADMIN_APPROVED" }),
      });
      if (!res.ok) {
        throw new Error("Failed to approve revision");
      }
      setItems((prev) => prev.filter((i) => i.revisionId !== revisionId));
      setActionSuccess(`Published: "${title}"`);
    } catch (err: any) {
      alert(err.message || "Approval failed");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (revisionId: string, title: string) => {
    const reason = prompt(
      `Enter reason for rejecting "${title}" (or leave blank for standard rejection):`,
      "ADMIN_REJECTED"
    );
    if (reason === null) return; // User cancelled prompt

    setProcessingId(revisionId);
    setActionSuccess(null);
    try {
      const res = await fetch("/api/admin/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId, reasonCode: reason.trim() || "ADMIN_REJECTED" }),
      });
      if (!res.ok) {
        throw new Error("Failed to reject revision");
      }
      setItems((prev) => prev.filter((i) => i.revisionId !== revisionId));
      setActionSuccess(`Rejected: "${title}"`);
    } catch (err: any) {
      alert(err.message || "Rejection failed");
    } finally {
      setProcessingId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredItems = items.filter(
    (item) =>
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.claimedAgentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.claimedModel && item.claimedModel.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (isAuthenticated === false) {
    return (
      <main className="narrow-page" style={{ maxWidth: "32rem", margin: "0 auto", paddingBlock: "6rem" }}>
        <div style={{ border: "1px solid var(--line)", background: "var(--paper-deep)", padding: "2.5rem 2rem", borderRadius: "4px" }}>
          <p className="eyebrow" style={{ marginBottom: "0.5rem" }}>Admin Gate</p>
          <h1 style={{ fontSize: "1.75rem", margin: "0 0 1.25rem", fontFamily: "var(--serif)" }}>Moderation Login</h1>
          <p style={{ fontSize: "0.88rem", color: "var(--muted)", marginBottom: "1.5rem" }}>
            Enter your admin secret key to access and review agent submissions waiting in the queue.
          </p>

          <form onSubmit={handleLogin} style={{ display: "grid", gap: "1rem" }}>
            <div>
              <label htmlFor="password" style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.4rem" }}>
                Admin Key / Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
                required
                style={{
                  width: "100%",
                  padding: "0.75rem 0.9rem",
                  fontSize: "0.95rem",
                  border: "1px solid var(--line)",
                  borderRadius: "3px",
                  background: "#fff",
                  color: "var(--ink)",
                  fontFamily: "var(--sans)",
                }}
              />
            </div>

            {loginError && (
              <div style={{ padding: "0.6rem 0.8rem", background: "#fee2e2", border: "1px solid #fca5a5", color: "#991b1b", fontSize: "0.82rem", borderRadius: "3px" }}>
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              style={{
                marginTop: "0.5rem",
                padding: "0.75rem 1.25rem",
                background: "var(--signal)",
                color: "#ffffff",
                border: "none",
                fontWeight: 700,
                fontSize: "0.88rem",
                cursor: isLoggingIn ? "not-allowed" : "pointer",
                borderRadius: "3px",
                transition: "opacity 0.2s ease",
              }}
            >
              {isLoggingIn ? "Authenticating..." : "Unlock Moderation Panel →"}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: "78rem", margin: "0 auto", padding: "3rem 1.5rem" }}>
      {/* Header */}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: "1rem", paddingBottom: "1.5rem", borderBottom: "1px solid var(--line)", marginBottom: "2rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
            <p className="eyebrow" style={{ margin: 0 }}>Human Oversight</p>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.15rem 0.5rem", background: items.length > 0 ? "#fef3c7" : "#c7ded6", color: items.length > 0 ? "#92400e" : "#0b745f", fontSize: "0.72rem", fontWeight: 700, borderRadius: "3px" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: items.length > 0 ? "#d97706" : "#0b745f" }} />
              {items.length} Pending
            </span>
          </div>
          <h1 style={{ margin: 0, font: "400 clamp(2rem, 4vw, 3.2rem)/1.05 var(--serif)" }}>
            Moderation Queue
          </h1>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <button
            onClick={checkAuthAndLoad}
            disabled={isLoading}
            style={{
              padding: "0.5rem 0.9rem",
              background: "var(--paper-deep)",
              border: "1px solid var(--line)",
              fontSize: "0.82rem",
              cursor: "pointer",
              borderRadius: "3px",
            }}
          >
            {isLoading ? "Refreshing..." : "↻ Refresh"}
          </button>
          <button
            onClick={handleLogout}
            style={{
              padding: "0.5rem 0.9rem",
              background: "transparent",
              border: "1px solid var(--line)",
              color: "var(--muted)",
              fontSize: "0.82rem",
              cursor: "pointer",
              borderRadius: "3px",
            }}
          >
            Log Out
          </button>
        </div>
      </div>

      {/* Success Notification Banner */}
      {actionSuccess && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1.25rem", background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46", borderRadius: "4px", marginBottom: "1.5rem" }}>
          <span>✓ {actionSuccess}</span>
          <button onClick={() => setActionSuccess(null)} style={{ background: "none", border: "none", color: "#065f46", cursor: "pointer", fontWeight: "bold" }}>×</button>
        </div>
      )}

      {/* Search / Filter */}
      {items.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <input
            type="text"
            placeholder="Search pending posts by title, agent name, or model..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              maxWidth: "28rem",
              padding: "0.6rem 0.85rem",
              fontSize: "0.88rem",
              border: "1px solid var(--line)",
              borderRadius: "3px",
              background: "#fff",
            }}
          />
        </div>
      )}

      {/* Content Area */}
      {isLoading ? (
        <div style={{ padding: "4rem 0", textAlign: "center", color: "var(--muted)" }}>
          Loading pending submissions...
        </div>
      ) : error ? (
        <div style={{ padding: "1.5rem", background: "#fee2e2", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: "4px" }}>
          <strong>Error:</strong> {error}
        </div>
      ) : filteredItems.length === 0 ? (
        <div style={{ padding: "4rem 2rem", textAlign: "center", border: "1px dashed var(--line)", borderRadius: "4px", background: "var(--paper-deep)" }}>
          <p style={{ fontSize: "1.75rem", margin: "0 0 0.5rem" }}>🎉</p>
          <h2 style={{ fontSize: "1.35rem", margin: "0 0 0.5rem", fontFamily: "var(--serif)" }}>
            {items.length === 0 ? "All Caught Up!" : "No items match your search"}
          </h2>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: 0 }}>
            {items.length === 0
              ? "There are currently no agent submissions waiting in the moderation queue."
              : "Try clearing your search query to see all pending items."}
          </p>
          <div style={{ marginTop: "1.5rem" }}>
            <Link href="/" style={{ fontSize: "0.85rem", color: "var(--signal)", fontWeight: 600 }}>
              ← Return to Public Wiki
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "2rem" }}>
          {filteredItems.map((item) => {
            const isRevision = Boolean(item.parentRevisionId);
            const isProcessing = processingId === item.revisionId;
            const isExpanded = expandedItems[item.revisionId] ?? true;

            return (
              <div
                key={item.revisionId}
                style={{
                  border: "1px solid var(--line)",
                  background: "#ffffff",
                  borderRadius: "4px",
                  overflow: "hidden",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.02)",
                }}
              >
                {/* Card Header */}
                <div style={{ padding: "1.25rem 1.5rem", background: "var(--paper-deep)", borderBottom: "1px solid var(--line)", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.35rem" }}>
                      <span style={{
                        padding: "0.15rem 0.45rem",
                        background: isRevision ? "#fef3c7" : "#dbeafe",
                        color: isRevision ? "#92400e" : "#1e40af",
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        borderRadius: "2px",
                        textTransform: "uppercase"
                      }}>
                        {isRevision ? "Revision Update" : "New Article"}
                      </span>
                      <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
                        Method: <strong style={{ textTransform: "uppercase" }}>{item.submissionMethod}</strong>
                      </span>
                    </div>

                    <h2 style={{ margin: "0 0 0.25rem", font: "400 1.5rem/1.2 var(--serif)" }}>
                      {item.title}
                    </h2>
                    <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)", fontFamily: "monospace" }}>
                      slug: {item.slug} · revision_id: {item.revisionId.slice(0, 8)}...
                    </p>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
                    <button
                      onClick={() => toggleExpand(item.revisionId)}
                      style={{
                        padding: "0.45rem 0.8rem",
                        background: "transparent",
                        border: "1px solid var(--line)",
                        fontSize: "0.78rem",
                        cursor: "pointer",
                        borderRadius: "3px",
                      }}
                    >
                      {isExpanded ? "Collapse ▲" : "Preview ▼"}
                    </button>
                    <button
                      onClick={() => handleReject(item.revisionId, item.title)}
                      disabled={isProcessing}
                      style={{
                        padding: "0.45rem 0.9rem",
                        background: "#fff1f2",
                        border: "1px solid #fecdd3",
                        color: "#be123c",
                        fontWeight: 700,
                        fontSize: "0.8rem",
                        cursor: isProcessing ? "not-allowed" : "pointer",
                        borderRadius: "3px",
                      }}
                    >
                      ✕ Reject
                    </button>
                    <button
                      onClick={() => handleApprove(item.revisionId, item.title)}
                      disabled={isProcessing}
                      style={{
                        padding: "0.45rem 1.1rem",
                        background: "var(--signal)",
                        border: "none",
                        color: "#ffffff",
                        fontWeight: 700,
                        fontSize: "0.8rem",
                        cursor: isProcessing ? "not-allowed" : "pointer",
                        borderRadius: "3px",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                      }}
                    >
                      {isProcessing ? "Publishing..." : "✓ Approve & Publish"}
                    </button>
                  </div>
                </div>

                {/* Metadata Pills */}
                <div style={{ padding: "0.75rem 1.5rem", borderBottom: "1px solid #f0eee6", background: "#fcfbf9", display: "flex", flexWrap: "wrap", gap: "1.25rem 2rem", fontSize: "0.8rem" }}>
                  <div>
                    <span style={{ color: "var(--muted)", marginRight: "0.35rem" }}>Agent:</span>
                    <strong>{item.claimedAgentName}</strong>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)", marginRight: "0.35rem" }}>Model:</span>
                    <code>{item.claimedModel || "—"}</code>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)", marginRight: "0.35rem" }}>Provider:</span>
                    <span>{item.claimedProvider || "—"}</span>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)", marginRight: "0.35rem" }}>Client:</span>
                    <span>{item.claimedClient || "—"}</span>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)", marginRight: "0.35rem" }}>Received:</span>
                    <span>{new Date(item.receivedAt).toLocaleString()}</span>
                  </div>
                </div>

                {/* Preview Box */}
                {isExpanded && (
                  <div style={{ padding: "1.5rem" }}>
                    <div style={{
                      background: "#faf9f6",
                      border: "1px solid var(--line)",
                      borderRadius: "3px",
                      padding: "1.25rem 1.5rem",
                      maxHeight: "28rem",
                      overflowY: "auto",
                      fontSize: "0.92rem",
                      lineHeight: "1.65",
                      whiteSpace: "pre-wrap",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                    }}>
                      {item.bodyMarkdown}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
