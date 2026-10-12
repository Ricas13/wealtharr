"use client";
import { Field } from "@/components/Field";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CHECKLIST_ITEMS, MIN_VERIFICATION_NOTE_LENGTH } from "@/domain/instrument-promotion";
import { isValidIsin } from "@/domain/instrument-import";

export type CandidateView = {
  id: string; economicExposure: string; leverage: string; direction: string; country: string; wrapper: string;
  tradingLineId: string; ticker: string; exchange: string; currency: string; isin: string | null; instrumentName: string;
  providerSymbol: string | null;
};

type Draft = { isin: string; providerSymbol: string; note: string; checks: Record<string, boolean> };
const emptyDraft = (c: CandidateView): Draft => ({ isin: c.isin ?? "", providerSymbol: c.providerSymbol ?? "", note: "", checks: {} });

// Nothing is verified automatically: the reviewer ticks every item, writes a note, reviews a summary
// and confirms. The server re-validates all of it and refuses on any mismatch.
export function InstrumentCandidates({ candidates }: { candidates: CandidateView[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const selected = candidates.find((c) => c.id === selectedId) ?? null;

  function open(c: CandidateView) { setSelectedId(c.id); setDraft(emptyDraft(c)); setReviewing(false); setConfirmingReject(false); setMessage(""); setFailed(false); }
  function close() { setSelectedId(null); setDraft(null); setReviewing(false); setConfirmingReject(false); }

  const isin = draft?.isin.trim().toUpperCase() ?? "";
  const allChecked = CHECKLIST_ITEMS.every((item) => draft?.checks[item.key] === true);
  const noteOk = (draft?.note.trim().length ?? 0) >= MIN_VERIFICATION_NOTE_LENGTH;
  const ready = allChecked && noteOk && isValidIsin(isin);

  async function send(payload: unknown, done: string) {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const response = await fetch("/api/admin/instruments", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setFailed(true); setMessage(body.error ?? "The request was refused."); return; }
      setMessage(done); close(); router.refresh();
    } catch {
      setFailed(true); setMessage("Could not reach the server. Nothing was changed; try again.");
    } finally { setBusy(false); }
  }

  const subject = (c: CandidateView) => ({ economicExposure: c.economicExposure, leverage: c.leverage, direction: c.direction, country: c.country, wrapper: c.wrapper, tradingLineId: c.tradingLineId });

  return <div>
    <div aria-live="polite" role="status">{message && <div className={failed ? "error" : "success"}>{message}</div>}</div>
    {candidates.length ? <div className="table-wrap" tabIndex={0} role="region" aria-label="Candidates awaiting verification"><table><thead><tr><th>Exposure</th><th>Leverage</th><th>Country</th><th>Wrapper</th><th>Ticker · exchange · currency</th><th>ISIN on file</th><th>Source</th><th>Action</th></tr></thead><tbody>
      {candidates.map((c) => <tr key={c.id}><td>{c.economicExposure}</td><td>{c.leverage}x {c.direction}</td><td>{c.country}</td><td>{c.wrapper}</td><td>{c.ticker} · {c.exchange} · {c.currency}</td><td>{c.isin ?? "—"}</td><td>CSV import candidate</td><td><button type="button" className="button" aria-label={"Verify " + c.economicExposure + " " + c.country + " " + c.wrapper + " " + c.ticker} onClick={() => open(c)}>Verify</button></td></tr>)}
    </tbody></table></div> : <div className="empty">No candidates are waiting. Import candidates with scripts/import-instruments.ts; nothing becomes tradable until a person verifies it here.</div>}
    {selected && draft && <section className="glass form-card" aria-labelledby="verify-heading" style={{ marginTop: 18 }}>
      <h3 id="verify-heading">Verify {selected.economicExposure} · {selected.country} · {selected.wrapper}</h3>
      <p>{selected.instrumentName}: {selected.ticker} on {selected.exchange} ({selected.currency}), {selected.leverage}x {selected.direction}. Verifying makes this mapping eligible to drive real trade instructions.</p>
      {!reviewing ? <form onSubmit={(e) => { e.preventDefault(); if (ready) setReviewing(true); }}>
        <fieldset className="stack"><legend>Verification checklist (every item is required)</legend>
          {CHECKLIST_ITEMS.map((item) => <div className="field" key={item.key}><label><input type="checkbox" checked={draft.checks[item.key] === true} onChange={(e) => setDraft({ ...draft, checks: { ...draft.checks, [item.key]: e.target.checked } })} /> {item.label}</label></div>)}
        </fieldset>
        <div className="form-grid">
          <Field label="ISIN (ISO 6166)"><input value={draft.isin} onChange={(e) => setDraft({ ...draft, isin: e.target.value })} required maxLength={12} autoComplete="off" aria-invalid={isin !== "" && !isValidIsin(isin)} /></Field>
          <Field label="Provider symbol (optional)"><input value={draft.providerSymbol} onChange={(e) => setDraft({ ...draft, providerSymbol: e.target.value })} maxLength={64} autoComplete="off" /></Field>
          <Field className="field full" label={"Verification note (at least " + MIN_VERIFICATION_NOTE_LENGTH + " characters: which documents you checked)"}><textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} rows={3} required /></Field>
        </div>
        <div className="actions" style={{ marginTop: 16 }}>
          <button type="submit" className="button primary" disabled={!ready}>Review verification</button>{" "}
          <button type="button" className="button" onClick={close}>Cancel</button>{" "}
          <button type="button" className="button" disabled={busy || !noteOk} onClick={() => setConfirmingReject(true)}>Reject candidate</button>
        </div>
      </form> : confirmingReject ? <div>
        <h4>Confirm rejection</h4>
        <p>Reject {selected.economicExposure} · {selected.country} · {selected.wrapper} ({selected.ticker})? It will be disabled and can no longer be promoted. Note: {draft.note.trim()}</p>
        <div className="actions">
          <button type="button" className="button primary" disabled={busy} onClick={() => send({ kind: "reject", mappingId: selected.id, note: draft.note }, "Candidate rejected.")}>Confirm rejection</button>{" "}
          <button type="button" className="button" disabled={busy} onClick={() => setConfirmingReject(false)}>Back</button>
        </div>
      </div> : <div>
        <h4>Confirm verification</h4>
        <ul>
          <li>Mapping: {selected.economicExposure}, {selected.leverage}x {selected.direction}, {selected.country} / {selected.wrapper}</li>
          <li>Trading line: {selected.ticker} · {selected.exchange} · {selected.currency}</li>
          <li>ISIN: {isin}</li>
          <li>Provider symbol: {draft.providerSymbol.trim() || "unchanged"}</li>
          <li>Note: {draft.note.trim()}</li>
        </ul>
        <div className="actions">
          <button type="button" className="button primary" disabled={busy} onClick={() => send({ kind: "promote", mappingId: selected.id, isin, providerSymbol: draft.providerSymbol.trim() || null, note: draft.note, subject: subject(selected), checklist: Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.key, draft.checks[item.key] === true])) }, "Mapping verified and promoted to EXACT.")}>Confirm and promote to EXACT</button>{" "}
          <button type="button" className="button" disabled={busy} onClick={() => setReviewing(false)}>Back</button>
        </div>
      </div>}
    </section>}
  </div>;
}
