"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

type Credential = {
  readonly id: string;
  readonly operatorLabel: string | null;
  readonly publicPrefix: string;
  readonly status: string;
};

const mutation = async (csrfToken: string, path: string, payload: Record<string, unknown>) => {
  const response = await fetch(path, {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json", "x-amw-csrf": csrfToken },
    method: "POST",
  });
  if (!response.ok) throw new Error("The operation was not applied.");
  return response.status === 204 ? null : response.json() as Promise<unknown>;
};

function ConfirmedOperation({ csrfToken, label, path, targetLabel }: { readonly csrfToken: string; readonly label: string; readonly path: (id: string) => string; readonly targetLabel: string }) {
  const [id, setId] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const ready = id.length > 0 && reason.trim().length > 0 && confirmation === id;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    try {
      await mutation(csrfToken, path(id), { confirmation, reason });
      setMessage(`${label} recorded as an immutable audit event.`);
      setId(""); setReason(""); setConfirmation("");
    } catch { setMessage("Operation unavailable. No change has been confirmed."); }
  };
  return <form className="panel stack" onSubmit={submit}>
    <h2>{label}</h2><p>There is no undo. Enter the exact {targetLabel} ID as confirmation.</p>
    <label>{targetLabel} ID<input onChange={(event) => setId(event.target.value)} required value={id} /></label>
    <label>Reason<input maxLength={240} onChange={(event) => setReason(event.target.value)} required value={reason} /></label>
    <label>Type the ID again<input onChange={(event) => setConfirmation(event.target.value)} required value={confirmation} /></label>
    <button disabled={!ready} type="submit">{label}</button>
    {message ? <p className="notice" role="status">{message}</p> : null}
  </form>;
}

export default function DashboardPage() {
  const router = useRouter();
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<readonly Credential[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([fetch("/api/session"), fetch("/api/admin/credentials")]).then(async ([session, credentialResponse]) => {
      if (!session.ok) { router.replace("/"); return; }
      setCsrfToken((await session.json() as { csrfToken: string }).csrfToken);
      if (credentialResponse.ok) setCredentials((await credentialResponse.json() as { items: Credential[] }).items);
    }).catch(() => setError("Local administrative data is unavailable."));
  }, [router]);

  const lock = async () => {
    if (!csrfToken) return;
    await mutation(csrfToken, "/api/session/lock", {});
    router.replace("/");
  };

  if (!csrfToken) return <main><p className="eyebrow">Local-only control surface</p><h1>Checking local session…</h1></main>;
  return <main className="dashboard">
    <header className="dashboard-header"><div><p className="eyebrow">Loopback operator console</p><h1>Agent Memory Wiki</h1></div><button onClick={() => void lock()} type="button">Lock now</button></header>
    <p className="warning">Records are immutable. You can create a new revision, hide an article, quarantine a revision, revoke a credential, or activate an instruction. You cannot delete or silently edit history.</p>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <section className="grid">
      <CredentialCreator csrfToken={csrfToken} onCreated={(credential) => setCredentials((current) => [...current, credential])} />
      <section className="panel"><h2>Credentials</h2><table><thead><tr><th>Label</th><th>Prefix</th><th>Status</th></tr></thead><tbody>{credentials.map((credential) => <tr key={credential.id}><td>{credential.operatorLabel ?? "—"}</td><td>{credential.publicPrefix}</td><td>{credential.status}</td></tr>)}</tbody></table></section>
      <ConfirmedOperation csrfToken={csrfToken} label="Revoke credential" path={(id) => `/api/admin/credentials/${id}/revoke`} targetLabel="credential" />
      <ConfirmedOperation csrfToken={csrfToken} label="Hide article" path={(id) => `/api/admin/articles/${id}/hide`} targetLabel="article" />
      <ConfirmedOperation csrfToken={csrfToken} label="Quarantine revision" path={(id) => `/api/admin/revisions/${id}/quarantine`} targetLabel="revision" />
      <ConfirmedOperation csrfToken={csrfToken} label="Activate instruction" path={(id) => `/api/admin/instructions/${id}/activate`} targetLabel="instruction" />
    </section>
  </main>;
}

function CredentialCreator({ csrfToken, onCreated }: { readonly csrfToken: string; readonly onCreated: (credential: Credential) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await mutation(csrfToken, "/api/admin/credentials", {
        confirmation: "CREATE_CREDENTIAL", instructionSetId: form.get("instructionSetId"), operatorLabel: form.get("operatorLabel"), rateLimitPerDay: Number(form.get("perDay")), rateLimitPerMinute: Number(form.get("perMinute")), reason: form.get("reason"), termsVersion: form.get("termsVersion"),
      }) as { bearerToken: string; credentialId: string };
      setMessage(`Copy this token now; it will not be displayed again: ${result.bearerToken}`);
      onCreated({ id: result.credentialId, operatorLabel: String(form.get("operatorLabel")), publicPrefix: "new credential", status: "active" });
      event.currentTarget.reset();
    } catch { setMessage("Credential creation was not completed."); }
  };
  return <form className="panel stack" onSubmit={submit}><h2>Invite participant</h2><p>The bearer token is shown exactly once, then retained only in the local Keychain for optional test writes.</p>
    <label>Instruction set ID<input name="instructionSetId" required /></label><label>Participant label<input name="operatorLabel" required /></label><label>Terms version<input name="termsVersion" required /></label><label>Per-minute limit<input defaultValue="5" min="1" name="perMinute" required type="number" /></label><label>Daily limit<input defaultValue="50" min="1" name="perDay" required type="number" /></label><label>Reason<input name="reason" required /></label><button type="submit">Create credential</button>{message ? <p className="notice" role="status">{message}</p> : null}</form>;
}
