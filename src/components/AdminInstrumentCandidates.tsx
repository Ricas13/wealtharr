"use client";
import { Field } from "@/components/Field";
import { InlineMessage } from "@/components/InlineMessage";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CHECKLIST_ITEMS, MIN_VERIFICATION_NOTE_LENGTH } from "@/domain/instrument-promotion";
import { isValidIsin } from "@/domain/instrument-import";
import { ISA_ELIGIBILITY_BASES, validateInstrumentEvidence } from "@/domain/instrument-evidence";

export type CandidateView = {
  id: string; economicExposure: string; leverage: string; direction: string; country: string; wrapper: string;
  tradingLineId: string; ticker: string; exchange: string; currency: string; isin: string | null; instrumentName: string;
  providerSymbol: string | null;
  broker?: string | null;
};

type Draft = { isin: string; providerSymbol: string; note: string; checks: Record<string, boolean>; ev: Record<string, string> };
const emptyDraft = (c: CandidateView): Draft => ({ isin: c.isin ?? "", providerSymbol: c.providerSymbol ?? "", note: "", checks: {}, ev: { brokerName: c.broker ?? "" } });

const EVIDENCE_TEXT_KEYS = ["kidUrl", "kidRetrievedAt", "kidSha256", "factsheetUrl", "factsheetRetrievedAt", "factsheetSha256", "distributionPolicy", "domicile", "replicationMethod", "ter"] as const;

// Builds the evidence object sent to the server from the typed inputs. Empty inputs are omitted; the
// listing comes from the stored trading line the reviewer is looking at. The server re-validates it all.
function buildEvidence(c: CandidateView, ev: Record<string, string>): Record<string, unknown> {
  const t = (key: string) => (ev[key] ?? "").trim();
  const out: Record<string, unknown> = {};
  for (const key of EVIDENCE_TEXT_KEYS) if (t(key)) out[key] = t(key);
  if (t("hedged")) out.hedged = t("hedged") === "true";
  if (t("isaBasis") || t("isaSourceUrl") || t("isaCheckedAt")) out.isaEligibility = { basis: t("isaBasis"), sourceUrl: t("isaSourceUrl"), checkedAt: t("isaCheckedAt") };
  out.listingEvidence = { exchange: c.exchange, ticker: c.ticker, currency: c.currency, ...(t("sedol") ? { sedol: t("sedol") } : {}) };
  if (t("brokerName") || t("brokerSource") || t("brokerCapturedAt") || t("fractional")) {
    out.brokerSnapshot = { broker: t("brokerName"), source: t("brokerSource"), capturedAt: t("brokerCapturedAt"), ...(t("fractional") ? { fractionalSupported: t("fractional") === "true" } : {}) };
  }
  return out;
}

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
  const evidenceCheck = selected && draft
    ? validateInstrumentEvidence(buildEvidence(selected, draft.ev), { country: selected.country, wrapper: selected.wrapper, broker: selected.broker ?? null, tradingLine: { exchange: selected.exchange, ticker: selected.ticker, currency: selected.currency } })
    : null;
  const evidenceIssues = evidenceCheck && !evidenceCheck.ok ? evidenceCheck.issues : [];
  const ready = allChecked && noteOk && isValidIsin(isin) && evidenceIssues.length === 0;
  const setEv = (key: string, value: string) => { if (draft) setDraft({ ...draft, ev: { ...draft.ev, [key]: value } }); };

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
        <fieldset className="stack"><legend>Evidence {selected.country === "GB" && selected.wrapper.toUpperCase() === "ISA" ? "(required for GB / ISA)" : "(optional for this country and wrapper)"}</legend>
          <p className="help">Record the documents you relied on. A broker-less mapping resolves for every broker but does not prove it can be bought at any of them; only a dated broker snapshot is evidence of that. Listing ({selected.exchange} · {selected.ticker} · {selected.currency}) is taken from the trading line above.</p>
          <div className="form-grid">
            <Field label="KID URL (https)"><input type="url" value={draft.ev.kidUrl ?? ""} onChange={(e) => setEv("kidUrl", e.target.value)} autoComplete="off" /></Field>
            <Field label="KID retrieved on (YYYY-MM-DD)"><input value={draft.ev.kidRetrievedAt ?? ""} onChange={(e) => setEv("kidRetrievedAt", e.target.value)} placeholder="YYYY-MM-DD" autoComplete="off" /></Field>
            <Field label="KID SHA-256 (64 hex characters)"><input value={draft.ev.kidSha256 ?? ""} onChange={(e) => setEv("kidSha256", e.target.value)} autoComplete="off" /></Field>
            <Field label="Factsheet URL (https, if no KID)"><input type="url" value={draft.ev.factsheetUrl ?? ""} onChange={(e) => setEv("factsheetUrl", e.target.value)} autoComplete="off" /></Field>
            <Field label="Factsheet retrieved on (YYYY-MM-DD)"><input value={draft.ev.factsheetRetrievedAt ?? ""} onChange={(e) => setEv("factsheetRetrievedAt", e.target.value)} placeholder="YYYY-MM-DD" autoComplete="off" /></Field>
            <Field label="Factsheet SHA-256 (64 hex characters)"><input value={draft.ev.factsheetSha256 ?? ""} onChange={(e) => setEv("factsheetSha256", e.target.value)} autoComplete="off" /></Field>
            <Field label="ISA eligibility basis"><select value={draft.ev.isaBasis ?? ""} onChange={(e) => setEv("isaBasis", e.target.value)}><option value="">Not recorded</option>{ISA_ELIGIBILITY_BASES.map((b) => <option key={b} value={b}>{b}</option>)}</select></Field>
            <Field label="ISA eligibility source URL (https)"><input type="url" value={draft.ev.isaSourceUrl ?? ""} onChange={(e) => setEv("isaSourceUrl", e.target.value)} autoComplete="off" /></Field>
            <Field label="ISA eligibility checked on (YYYY-MM-DD)"><input value={draft.ev.isaCheckedAt ?? ""} onChange={(e) => setEv("isaCheckedAt", e.target.value)} placeholder="YYYY-MM-DD" autoComplete="off" /></Field>
            <Field label="SEDOL (optional, 7 characters)"><input value={draft.ev.sedol ?? ""} onChange={(e) => setEv("sedol", e.target.value)} maxLength={7} autoComplete="off" /></Field>
            <Field label={"Broker named on the mapping" + (selected.broker ? " (" + selected.broker + ")" : " (none: broker-agnostic)")}><input value={draft.ev.brokerName ?? ""} onChange={(e) => setEv("brokerName", e.target.value)} autoComplete="off" /></Field>
            <Field label="Broker snapshot source (list or page you checked)"><input value={draft.ev.brokerSource ?? ""} onChange={(e) => setEv("brokerSource", e.target.value)} autoComplete="off" /></Field>
            <Field label="Broker snapshot captured on (YYYY-MM-DD)"><input value={draft.ev.brokerCapturedAt ?? ""} onChange={(e) => setEv("brokerCapturedAt", e.target.value)} placeholder="YYYY-MM-DD" autoComplete="off" /></Field>
            <Field label="Fractional shares at that broker"><select value={draft.ev.fractional ?? ""} onChange={(e) => setEv("fractional", e.target.value)}><option value="">Not recorded</option><option value="true">Supported</option><option value="false">Not supported</option></select></Field>
            <Field label="Currency hedged"><select value={draft.ev.hedged ?? ""} onChange={(e) => setEv("hedged", e.target.value)}><option value="">Not recorded</option><option value="true">Hedged</option><option value="false">Not hedged</option></select></Field>
            <Field label="Distribution policy"><select value={draft.ev.distributionPolicy ?? ""} onChange={(e) => setEv("distributionPolicy", e.target.value)}><option value="">Not recorded</option><option value="ACCUMULATING">Accumulating</option><option value="DISTRIBUTING">Distributing</option></select></Field>
            <Field label="Domicile (2-letter country code)"><input value={draft.ev.domicile ?? ""} onChange={(e) => setEv("domicile", e.target.value)} maxLength={2} autoComplete="off" /></Field>
            <Field label="Replication method"><select value={draft.ev.replicationMethod ?? ""} onChange={(e) => setEv("replicationMethod", e.target.value)}><option value="">Not recorded</option><option value="PHYSICAL_FULL">Physical, full</option><option value="PHYSICAL_SAMPLED">Physical, sampled</option><option value="SYNTHETIC">Synthetic</option></select></Field>
            <Field label="TER as a decimal fraction (0.0007 means 0.07%)"><input value={draft.ev.ter ?? ""} onChange={(e) => setEv("ter", e.target.value)} inputMode="decimal" autoComplete="off" /></Field>
          </div>
          {evidenceIssues.length > 0 && <InlineMessage tone="error" id="evidence-issues"><strong>Evidence is not yet complete:</strong><ul>{evidenceIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></InlineMessage>}
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
          <li>Evidence: {draft.ev.kidUrl?.trim() || draft.ev.factsheetUrl?.trim() || "none recorded"}{draft.ev.brokerCapturedAt?.trim() ? "; broker snapshot " + draft.ev.brokerCapturedAt.trim() : "; no broker snapshot (does not prove purchasability at any broker)"}</li>
          <li>Note: {draft.note.trim()}</li>
        </ul>
        <div className="actions">
          <button type="button" className="button primary" disabled={busy} onClick={() => send({ kind: "promote", mappingId: selected.id, isin, providerSymbol: draft.providerSymbol.trim() || null, note: draft.note, subject: subject(selected), evidence: buildEvidence(selected, draft.ev), checklist: Object.fromEntries(CHECKLIST_ITEMS.map((item) => [item.key, draft.checks[item.key] === true])) }, "Mapping verified and promoted to EXACT.")}>Confirm and promote to EXACT</button>{" "}
          <button type="button" className="button" disabled={busy} onClick={() => setReviewing(false)}>Back</button>
        </div>
      </div>}
    </section>}
  </div>;
}
