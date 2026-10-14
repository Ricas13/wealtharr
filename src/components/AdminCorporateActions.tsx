"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import { Field } from "@/components/Field";
import { InlineMessage } from "@/components/InlineMessage";
import {
  MIN_CORPORATE_ACTION_NOTE_LENGTH, MIN_POWER_OF_TEN_NOTE_LENGTH, MINOR_UNIT_CURRENCIES, PENDING_ACTION_DAYS,
  POWER_OF_TEN_NOTE_PATTERN, isPowerOfTenRatio, requiresSecondAdmin
} from "@/domain/corporate-action-input";

export type CorporateActionView = {
  id: string; instrumentId: string; instrumentName: string; ratioTo: number; ratioFrom: number;
  effectiveDate: string; sourceUrl: string; retrievedAt: string; confirmedAt: string; status: string;
  createdBy: string | null; expiresAt: string | null;
};
export type InstrumentOption = { id: string; name: string; currencies: string[] };
export type RejectionView = {
  instrumentId: string; instrumentName: string; line: string; currency: string;
  referencePrice: string | null; rejectedPrice: string; rejectedObservedAt: string;
  /** Recent accepted observations, newest first (ISO UTC timestamps). */
  history: Array<{ price: string; observedAt: string }>;
};

const TOLERANCE = new Decimal("0.05");

// The same reference the market worker uses: the latest ACCEPTED observation strictly before the
// effective date 00:00 UTC. Without an effective date yet, the latest observation is shown.
function referenceFor(rejection: RejectionView, effectiveDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return rejection.referencePrice;
  const startMs = Date.parse(effectiveDate + "T00:00:00.000Z");
  const found = rejection.history.find((h) => Date.parse(h.observedAt) < startMs);
  return found ? found.price : null;
}

// Expected price after the split, with the same formula and tolerance the market worker uses
// (reference x from / to, within 5%). Null when the inputs are not usable.
function expectedBand(reference: string | null, to: number, from: number) {
  try {
    if (!reference || !(to >= 1) || !(from >= 1)) return null;
    const expected = new Decimal(reference).mul(from).div(to);
    if (!expected.isFinite() || expected.lte(0)) return null;
    return { expected, low: expected.mul(new Decimal(1).minus(TOLERANCE)), high: expected.mul(new Decimal(1).plus(TOLERANCE)) };
  } catch { return null; }
}

// Confirming a split is what lets the market worker accept a split-sized quote for every user, so the
// form shows the quote it must explain, asks for the evidence, and the server re-validates all of it.
// Users' own split records never do this. High-risk ratios are only PROPOSED here and need a
// different admin to approve them.
export function AdminCorporateActions({ actions, instruments, rejections, currentAdminId, adminCount }: {
  actions: CorporateActionView[]; instruments: InstrumentOption[]; rejections: RejectionView[]; currentAdminId: string; adminCount: number;
}) {
  const router = useRouter();
  const [instrumentId, setInstrumentId] = useState("");
  const [ratioTo, setRatioTo] = useState("2");
  const [ratioFrom, setRatioFrom] = useState("1");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [retrievedAt, setRetrievedAt] = useState("");
  const [note, setNote] = useState("");
  const [powerOfTen, setPowerOfTen] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(payload: unknown, done: string) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/admin/corporate-actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage({ tone: "error", text: body.error ?? "The request was refused." }); return; }
      setMessage({ tone: "success", text: body.status === "PENDING" ? "Proposed. A different admin must approve it within " + PENDING_ACTION_DAYS + " days." : done });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server. Nothing was changed; try again." });
    } finally { setBusy(false); }
  }

  const to = Number(ratioTo);
  const from = Number(ratioFrom);
  const wholeRatio = Number.isInteger(to) && Number.isInteger(from) && to >= 1 && from >= 1 && to <= 1000 && from <= 1000 && to !== from;
  const risky = wholeRatio && isPowerOfTenRatio(to, from);
  const needsSecond = wholeRatio && requiresSecondAdmin(to, from);
  const selected = instruments.find((i) => i.id === instrumentId);
  const minorUnit = Boolean(selected?.currencies.some((c) => MINOR_UNIT_CURRENCIES.includes(c)));
  const observed = rejections.filter((r) => r.instrumentId === instrumentId);
  const noteLength = note.trim().length;
  const noteOk = noteLength >= MIN_CORPORATE_ACTION_NOTE_LENGTH &&
    (!risky || (noteLength >= MIN_POWER_OF_TEN_NOTE_LENGTH && POWER_OF_TEN_NOTE_PATTERN.test(note)));
  const ready = instrumentId !== "" && wholeRatio && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) && sourceUrl.trim().startsWith("https://") &&
    /^\d{4}-\d{2}-\d{2}$/.test(retrievedAt) && noteOk && (!risky || powerOfTen);
  const pending = actions.filter((a) => a.status === "PENDING");
  const confirmed = actions.filter((a) => a.status === "CONFIRMED");
  const revoked = actions.filter((a) => a.status === "REVOKED");

  return <div>
    {message && <InlineMessage tone={message.tone}>{message.text}</InlineMessage>}
    <h3>Rejected quotes awaiting an explanation</h3>
    {rejections.length
      ? <div className="table-wrap" tabIndex={0} role="region" aria-label="Currently rejected quotes"><table><thead><tr><th>Instrument</th><th>Trading line</th><th>Last accepted price</th><th>Rejected price</th><th>Rejected at</th></tr></thead><tbody>
        {rejections.map((r) => <tr key={r.instrumentId + r.line}><td>{r.instrumentName}</td><td>{r.line} ({r.currency})</td><td>{r.referencePrice ?? "none"}</td><td>{r.rejectedPrice}</td><td>{r.rejectedObservedAt}</td></tr>)}
      </tbody></table></div>
      : <div className="empty">No quote is currently rejected. A split can also be confirmed after the fact when an accepted post-split quote matches its ratio.</div>}

    <h3 style={{ marginTop: 18 }}>Pending approval</h3>
    {pending.length > 0 && adminCount < 2 && <InlineMessage tone="warning">This installation has only one admin account. A high-risk split needs a second admin to approve it, so it stays pending (and no quote is accepted for it) until one exists.</InlineMessage>}
    {pending.length
      ? <div className="table-wrap" tabIndex={0} role="region" aria-label="Corporate actions awaiting approval"><table><thead><tr><th>Instrument</th><th>Split</th><th>Effective date</th><th>Lapses</th><th>Source</th><th>Decision</th></tr></thead><tbody>
        {pending.map((a) => {
          const mine = a.createdBy === currentAdminId;
          const reason = reasons[a.id] ?? "";
          return <tr key={a.id}>
            <td>{a.instrumentName}</td><td>{a.ratioTo} for {a.ratioFrom}</td><td>{a.effectiveDate}</td><td>{a.expiresAt ?? "—"}</td><td>{a.sourceUrl}</td>
            <td>
              {mine ? <span>You proposed this; a different admin must approve it. </span>
                : <button type="button" className="button primary" disabled={busy} onClick={() => send({ action: "approve", id: a.id }, "Corporate action approved.")}>Approve</button>}{" "}
              <label htmlFor={"reject-" + a.id} className="sr-only">Reason for rejecting the {a.instrumentName} split</label>
              <input id={"reject-" + a.id} value={reason} onChange={(e) => setReasons({ ...reasons, [a.id]: e.target.value })} placeholder="Reason (20+ characters)" autoComplete="off" />{" "}
              <button type="button" className="button" disabled={busy || reason.trim().length < MIN_CORPORATE_ACTION_NOTE_LENGTH}
                onClick={() => send({ action: "revoke", id: a.id, reason }, "Proposal rejected.")}>Reject</button>
            </td>
          </tr>;
        })}
      </tbody></table></div>
      : <div className="empty">No proposal is waiting for approval.</div>}

    <h3 style={{ marginTop: 18 }}>Confirmed</h3>
    {confirmed.length
      ? <div className="table-wrap" tabIndex={0} role="region" aria-label="Confirmed corporate actions"><table><thead><tr><th>Instrument</th><th>Split</th><th>Effective date</th><th>Source</th><th>Retrieved</th><th>Revoke</th></tr></thead><tbody>
        {confirmed.map((a) => <tr key={a.id}>
          <td>{a.instrumentName}</td><td>{a.ratioTo} for {a.ratioFrom}</td><td>{a.effectiveDate}</td>
          <td>{a.sourceUrl}</td><td>{a.retrievedAt}</td>
          <td><span>
            <label htmlFor={"revoke-" + a.id} className="sr-only">Reason for revoking the {a.instrumentName} split</label>
            <input id={"revoke-" + a.id} value={reasons[a.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [a.id]: e.target.value })} placeholder="Reason (20+ characters)" autoComplete="off" />{" "}
            <button type="button" className="button" disabled={busy || (reasons[a.id] ?? "").trim().length < MIN_CORPORATE_ACTION_NOTE_LENGTH}
              onClick={() => send({ action: "revoke", id: a.id, reason: reasons[a.id] }, "Corporate action revoked. The quotes it explained were removed.")}>Revoke</button>
          </span></td>
        </tr>)}
      </tbody></table></div>
      : <div className="empty">No corporate actions are confirmed. Until one is, a split-sized provider quote stays rejected.</div>}
    {revoked.length > 0 && <p className="help">{revoked.length} earlier action(s) were revoked, rejected or lapsed.</p>}

    <section className="glass form-card" aria-labelledby="corporate-action-heading" style={{ marginTop: 18 }}>
      <h3 id="corporate-action-heading">Confirm a stock split</h3>
      <p className="help">Only confirm a split you have verified from the issuer or exchange. The effective date is the first trading day at post-split prices, as a UTC date (markets whose session crosses UTC midnight are not supported). Quotes explained by it are accepted for every user, and every admin is notified.</p>
      {minorUnit && <InlineMessage tone="warning">This instrument has a trading line quoted in minor units ({selected?.currencies.filter((c) => MINOR_UNIT_CURRENCIES.includes(c)).join(", ")}). A x100 quote is more likely a pence-versus-pounds error than a split: check the unit before confirming.</InlineMessage>}
      {needsSecond && <InlineMessage tone="info">A {to} for {from} ratio is high risk: it will only be proposed here, and a different admin must approve it within {PENDING_ACTION_DAYS} days{adminCount < 2 ? ". This installation has only one admin, so it would stay pending." : "."}</InlineMessage>}
      <form onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void send({ action: "create", instrumentId, ratioTo: to, ratioFrom: from, effectiveDate, confirmPowerOfTenRisk: risky ? powerOfTen : undefined, evidence: { sourceUrl: sourceUrl.trim(), retrievedAt, note: note.trim() } }, "Corporate action confirmed."); }}>
        <div className="form-grid">
          <Field label="Instrument"><select value={instrumentId} onChange={(e) => setInstrumentId(e.target.value)} required><option value="">Choose an instrument</option>{instruments.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
          <Field label="New units"><input type="number" min={1} max={1000} step={1} value={ratioTo} onChange={(e) => setRatioTo(e.target.value)} required /></Field>
          <Field label="For every old units"><input type="number" min={1} max={1000} step={1} value={ratioFrom} onChange={(e) => setRatioFrom(e.target.value)} required /></Field>
          <Field label="Effective date (first post-split trading day, UTC)"><input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required /></Field>
          <Field label="Source URL (https)"><input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} required autoComplete="off" /></Field>
          <Field label="Source retrieved on"><input type="date" value={retrievedAt} onChange={(e) => setRetrievedAt(e.target.value)} required /></Field>
          <Field className="field full" label={"Note (at least " + MIN_CORPORATE_ACTION_NOTE_LENGTH + " characters: what you checked)"}><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} required /></Field>
        </div>
        {instrumentId !== "" && <div aria-live="polite">
          {observed.length === 0
            ? <p className="help">No rejected quote is recorded for this instrument right now.</p>
            : observed.map((r) => {
              const reference = referenceFor(r, effectiveDate);
              const band = wholeRatio ? expectedBand(reference, to, from) : null;
              const matches = band ? new Decimal(r.rejectedPrice).gte(band.low) && new Decimal(r.rejectedPrice).lte(band.high) : false;
              return <p key={r.line} className="help">{r.line}: reference {reference ?? "none before that date"}, rejected {r.rejectedPrice}.{band ? " Expected after a " + to + " for " + from + " split: " + band.expected.toDecimalPlaces(4).toString() + " (accepted band " + band.low.toDecimalPlaces(4).toString() + " to " + band.high.toDecimalPlaces(4).toString() + "). " + (matches ? "The rejected price is inside the band." : "The rejected price is outside the band, so the server will refuse this ratio.") : ""}</p>;
            })}
        </div>}
        {risky && <fieldset className="stack">
          <legend>Power-of-ten ratio</legend>
          <InlineMessage tone="warning">{to} for {from} has the shape of a pence/pounds or decimal-place error. The note must be at least {MIN_POWER_OF_TEN_NOTE_LENGTH} characters and say how you checked the currency or unit.</InlineMessage>
          <div className="field"><label><input type="checkbox" checked={powerOfTen} onChange={(e) => setPowerOfTen(e.target.checked)} /> I checked the currency and unit and this is a real split</label></div>
        </fieldset>}
        <div className="actions" style={{ marginTop: 16 }}><button type="submit" className="button primary" disabled={!ready || busy}>{needsSecond ? "Propose split" : "Confirm split"}</button></div>
      </form>
    </section>
  </div>;
}
