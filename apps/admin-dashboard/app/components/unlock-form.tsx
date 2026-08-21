"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

export function UnlockForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/session/unlock", {
        body: JSON.stringify({ code }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Unlock code unavailable or already used.");
      router.push("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unlock unavailable.");
    } finally {
      setSubmitting(false);
      setCode("");
    }
  };

  return (
    <form className="stack" onSubmit={unlock}>
      <label htmlFor="unlock-code">One-time unlock code</label>
      <input autoComplete="off" id="unlock-code" onChange={(event) => setCode(event.target.value)} required value={code} />
      <button disabled={submitting} type="submit">{submitting ? "Unlocking…" : "Unlock dashboard"}</button>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </form>
  );
}
