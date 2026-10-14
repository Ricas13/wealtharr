"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/Field";
import { InlineMessage } from "@/components/InlineMessage";
import { MIN_CORPORATE_ACTION_NOTE_LENGTH } from "@/domain/corporate-action-input";

export type CorporateActionView = {
  id: string; instrumentId: string; instrumentName: string; ratioTo: number; ratioFrom: number;
  effectiveDate: string; sourceUrl: string; retrievedAt: string; confirmedAt: string; status: string;
};
export type InstrumentOption = { id: string; name: string };

// Confirming a split is what lets the market worker accept a split-sized quote for every user, so the
// form asks for the evidence and the server re-validates it. Users' own split records never do this.
export function AdminCorporateActions({ actions, instruments }: { actions: CorporateActionView[]; instruments: InstrumentOption[] }) {
  const router = useRouter();
  const [instrumentId, setInstrumentId] = useState("");
  const [ratioTo, setRatioTo] = useState("2");
  const [ratioFrom, setRatioFrom] = useState("1");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [retrievedAt, setRetrievedAt] = useState("");
  const [note, setNote] = useState("");
  const [revokeReason, setRevokeReason] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(payload: unknown, done: string) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/admin/corporate-actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage({ tone: "error", text: body.error ?? "The request was refused." }); return; }
      setMessage({ tone: "success", text: done });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server. Nothing was changed; try again." });
    } finally { setBusy(false); }
  }

  const ready = instrumentId !== "" && Number(ratioTo) >= 1 && Number(ratioFrom) >= 1 && Number(ratioTo) !== Number(ratioFrom) &&
    /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) && sourceUrl.trim().startsWith("https://") && /^\d{4}-\d{2}-\d{2}$/.test(retrievedAt) &&
    note.trim().length >= MIN_CORPORATE_ACTION_NOTE_LENGTH;

  return <div>
    {message && <InlineMessage tone={message.tone}>{message.text}</InlineMessage>}
    {actions.length
      ? <div className="table-wrap" tabIndex={0} role="region" aria-label="Confirmed corporate actions"><table><thead><tr><th>Instrument</th><th>Split</th><th>Effective date</th><th>Source</th><th>Retrieved</th><th>Status</th><th>Revoke</th></tr></thead><tbody>
        {actions.map((a) => <tr key={a.id}>
          <td>{a.instrumentName}</td><td>{a.ratioTo} for {a.ratioFrom}</td><td>{a.effectiveDate}</td>
          <td>{a.sourceUrl}</td><td>{a.retrievedAt}</td><td>{a.status}</td>
          <td>{a.status === "CONFIRMED" ? <span>
            <label htmlFor={"revoke-" + a.id} className="sr-only">Reason for revoking the {a.instrumentName} split</label>
            <input id={"revoke-" + a.id} value={revokeReason[a.id] ?? ""} onChange={(e) => setRevokeReason({ ...revokeReason, [a.id]: e.target.value })} placeholder="Reason (20+ characters)" autoComplete="off" />{" "}
            <button type="button" className="button" disabled={busy || (revokeReason[a.id] ?? "").trim().length < MIN_CORPORATE_ACTION_NOTE_LENGTH}
              onClick={() => send({ action: "revoke", id: a.id, reason: revokeReason[a.id] }, "Corporate action revoked.")}>Revoke</button>
          </span> : "—"}</td>
        </tr>)}
      </tbody></table></div>
      : <div className="empty">No corporate actions are confirmed. Until one is, a split-sized provider quote stays rejected.</div>}
    <section className="glass form-card" aria-labelledby="corporate-action-heading" style={{ marginTop: 18 }}>
      <h3 id="corporate-action-heading">Confirm a stock split</h3>
      <p className="help">Only confirm a split you have verified from the issuer or exchange. The effective date is the first trading day at post-split prices. Quotes explained by it are accepted for every user.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void send({ action: "create", instrumentId, ratioTo: Number(ratioTo), ratioFrom: Number(ratioFrom), effectiveDate, evidence: { sourceUrl: sourceUrl.trim(), retrievedAt, note: note.trim() } }, "Corporate action confirmed."); }}>
        <div className="form-grid">
          <Field label="Instrument"><select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} required><option value="">Choose an instrument</option>{instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
          <Field label="New units"><input type="number" min={1} max={1000} step={1} value={ratioTo} onChange={(e) => setRatioTo(e.target.value)} required /></Field>
          <Field label="For every old units"><input type="number" min={1} max={1000} step={1} value={ratioFrom} onChange={(e) => setRatioFrom(e.target.value)} required /></Field>
          <Field label="Effective date (first post-split trading day)"><input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required /></Field>
          <Field label="Source URL (https)"><input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} required autoComplete="off" /></Field>
          <Field label="Source retrieved on"><input type="date" value={retrievedAt} onChange={(e) => setRetrievedAt(e.target.value)} required /></Field>
          <Field className="field full" label={"Note (at least " + MIN_CORPORATE_ACTION_NOTE_LENGTH + " characters: what you checked)"}><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} required /></Field>
        </div>
        <div className="actions" style={{ marginTop: 16 }}><button type="submit" className="button primary" disabled={!ready || busy}>Confirm split</button></div>
      </form>
    </section>
  </div>;
}
