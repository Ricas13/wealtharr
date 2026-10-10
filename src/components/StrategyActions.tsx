"use client";
import { Field } from "@/components/Field";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus } from "lucide-react";

type AccountOption={id:string;name:string;wrapper:string;currency:string;brokerName?:string|null;role:string;ledgerEventCount?:number;openingSnapshotComplete?:boolean};

function AccountSelect({accounts}:{accounts:AccountOption[]}){
  const selectId=useId();
  if(accounts.length<=1)return null;
  return <div className="field full"><label htmlFor={selectId}>Account</label><select id={selectId} name="accountId" defaultValue={accounts.find((account)=>account.role==="PRIMARY")?.id??accounts[0]?.id}>{accounts.map((account)=><option key={account.id} value={account.id}>{account.name} · {account.wrapper}{account.brokerName?" · "+account.brokerName:""}</option>)}</select></div>;
}


export function AddLinkedAccountForm({id,currency,wrappers}:{id:string;currency:string;wrappers:string[]}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const options=wrappers.length?wrappers:["ISA","SIPP","GIA"];

  return <form className="form-grid linked-account-form" onSubmit={async(e)=>{
    e.preventDefault();setBusy(true);setMessage("");
    const form=e.currentTarget;
    const f=new FormData(form);
    const response=await fetch("/api/strategies/"+id+"/accounts",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        name:String(f.get("name")||""),
        wrapper:String(f.get("wrapper")||""),
        broker:String(f.get("broker")||"")||null,
        currency
      })
    });
    const body=await response.json();setBusy(false);
    if(!response.ok)return setMessage(body.error??"Could not add this account.");
    setMessage(body.recalculationPending?"Account linked. Recalculation needs attention.":"Account linked.");
    form.reset();
    router.refresh();
  }}>
    <div className="field"><label htmlFor={"linked-account-name-"+id}>Account name</label><input id={"linked-account-name-"+id} name="name" maxLength={80} placeholder="e.g. SIPP at InvestEngine" required/></div>
    <div className="field"><label htmlFor={"linked-account-wrapper-"+id}>Account type</label><select id={"linked-account-wrapper-"+id} name="wrapper" required>{options.map((wrapper)=><option key={wrapper} value={wrapper}>{wrapper}</option>)}</select></div>
    <div className="field full"><label htmlFor={"linked-account-broker-"+id}>Broker (optional)</label><input id={"linked-account-broker-"+id} name="broker" maxLength={80} placeholder="Broker name"/></div>
    <div className="field full linked-account-currency"><span>Uses strategy currency</span><strong>{currency}</strong></div>
    <div className="field full"><button className="button" disabled={busy}><Plus size={15}/>{busy?"Adding…":"Add linked account"}</button>{message&&<span className={message.includes("Recalculation needs attention")?"attention-message":message.startsWith("Account linked")?"success":"error"}>{message}</span>}</div>
  </form>;
}

export function RecalculateButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button className="button" disabled={busy} onClick={async () => {
    setBusy(true);
    await fetch("/api/strategies/" + id + "/calculate", { method: "POST" });
    setBusy(false);
    router.refresh();
  }}>Recalculate</button>;
}

export function ExecuteAction({ action }: { action: { id: string; actionType: string } }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [recalculationPending,setRecalculationPending]=useState(false);
  const needsPrice = ["BUY", "SELL"].includes(action.actionType);

  if (completed) {
    return <div className="action-complete" role="status" aria-live="polite">
      <span className="action-complete-icon"><CheckCircle2 size={20}/></span>
      <span><strong>{needsPrice ? "Trade recorded." : "Review completed."}</strong><small>{recalculationPending?"Saved safely. The strategy needs attention before the next action is ready.":"Recalculating what comes next…"}</small></span>
    </div>;
  }

  return <form className="inline" onSubmit={async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const localTime=String(f.get("executedAt")||"");
    const when=localTime?new Date(localTime):null;
    if(when&&!Number.isFinite(when.getTime())){setBusy(false);setError("Choose a valid execution date and time.");return;}
    const response = await fetch("/api/actions/" + action.id + "/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ price: f.get("price") || undefined, quantity: f.get("quantity") || undefined, fee: f.get("fee") || "0", partial:Boolean(f.get("partial")),executedAt:when?.toISOString() })
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) return setError(body.error ?? "Could not complete action.");
    setRecalculationPending(Boolean(body.recalculationPending));
    setCompleted(true);
    window.setTimeout(() => router.refresh(), 550);
  }}>
    {needsPrice && <>
      <input name="price" type="number" min="0" step="0.000001" placeholder="Execution price" aria-label="Actual execution price" required />
      <input name="quantity" type="number" min="0" step="0.00000001" placeholder="Actual quantity" aria-label="Actual quantity" required />
      <input name="fee" type="number" min="0" step="0.01" defaultValue="0" placeholder="Fee" aria-label="Trading fee"/>
      <label className="trade-execution-when">Broker execution date &amp; time
        <input name="executedAt" type="datetime-local" aria-label="Broker execution date and time"/>
        <small>Optional. Leave blank for now, or enter the actual local time shown by your broker.</small>
      </label>
      <label className="partial-fill"><input name="partial" type="checkbox"/><span>I only completed part of this trade</span></label>
    </>}
    <button className="button primary" disabled={busy}>{busy ? "Recording…" : needsPrice ? "Mark trade completed" : "Mark reviewed"}</button>
    {error && <span className="error" role="alert">{error}</span>}
  </form>;
}

export function ContributionForm({ id, accounts=[] }: { id: string; accounts?:AccountOption[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy,setBusy]=useState(false);
  const requestKey=useRef<string|null>(null);
  return <form className="form-grid" onSubmit={async (e) => {
    e.preventDefault();setBusy(true);setMessage("");
    const form=e.currentTarget;
    const mutationKey=requestKey.current??crypto.randomUUID();
    requestKey.current=mutationKey;
    const f = new FormData(form);
    const value = String(f.get("when") || "");
    const occurredAt = value ? new Date(value).toISOString() : undefined;
    try{
      const r = await fetch("/api/strategies/" + id + "/contributions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: String(f.get("amount")), occurredAt, accountId:f.get("accountId")||undefined, requestKey:mutationKey })
      });
      const body=await r.json().catch(()=>({}));
      setMessage(r.ok ? (body.recalculationPending?"Contribution recorded. Recalculation needs attention.":"Contribution recorded as cash.") : body.error??"Could not record contribution.");
      if (r.ok) {
        requestKey.current=null;
        form.reset();
        router.refresh();
      }
    }catch{
      setMessage("Connection interrupted. Try again — the same request will be reused safely.");
    }finally{
      setBusy(false);
    }
  }}>
    <AccountSelect accounts={accounts}/><Field label="Contribution"><input name="amount" type="number" min="0.01" step="0.01" required /></Field>
    <Field label="Date & time"><input name="when" type="datetime-local" /></Field>
    <div className="field full"><button className="button" disabled={busy}>{busy?"Recording…":"Record contribution"}</button>{message && <div className={message.includes("Recalculation needs attention")?"attention-message":message.startsWith("Contribution recorded") ? "success" : "error"}>{message}</div>}</div>
  </form>;
}

export function ReconcileForm({ id, expected, accounts=[] }: { id: string; expected?: number | null; accounts?:AccountOption[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy,setBusy]=useState(false);
  const requestKey=useRef<string|null>(null);
  return <form className="form-grid" onSubmit={async (e) => {
    e.preventDefault();setBusy(true);setMessage("");
    const mutationKey=requestKey.current??crypto.randomUUID();
    requestKey.current=mutationKey;
    const f = new FormData(e.currentTarget);
    try{
      const r = await fetch("/api/strategies/" + id + "/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedValue: String(f.get("expected")),
          brokerValue: String(f.get("broker")),
          reason: f.get("reason") || undefined,
          affectsCash: Boolean(f.get("affectsCash")),
          accountId: f.get("accountId") || undefined,
          requestKey: mutationKey
        })
      });
      const b = await r.json().catch(()=>({}));
      setMessage(r.ok
        ? (b.recalculationPending
          ? "Reconciliation saved. Recalculation needs attention."
          : b.strategyResolved
            ? "Reconciliation resolved."
            : b.resolved
              ? "This account is matched, but another linked account still needs attention."
              : "Reconciliation recorded, but the strategy remains blocked until the discrepancy is resolved.")
        : b.error??"Could not reconcile strategy.");
      if (r.ok) {requestKey.current=null;router.refresh();}
    }catch{
      setMessage("Connection interrupted. Try again — the same reconciliation will be reused safely.");
    }finally{
      setBusy(false);
    }
  }}>
    <AccountSelect accounts={accounts}/><Field label="Expected value"><input name="expected" type="number" min="0" step="0.01" defaultValue={expected ?? undefined} required />{accounts.length>1&&<div className="help">Enter the expected value for the selected account only, not the combined strategy value.</div>}</Field>
    <Field label="Broker reported value"><input name="broker" type="number" min="0" step="0.01" required /></Field>
    <Field className="field full" label="Reason"><select name="reason"><option value="">Unknown adjustment</option><option>Broker fee</option><option>FX cost</option><option>Tax</option><option>Financing cost</option><option>Interest</option><option>Other</option></select></Field>
    <div className="field full">
      <label><input name="affectsCash" type="checkbox" /> This difference definitely changes available cash</label>
      <div className="help">Use this for a fee, tax, financing or FX cash charge. Leave it off for an unexplained valuation difference; actions stay blocked instead of treating unknown drift as spendable cash.</div>
    </div>
    <div className="field full"><button className="button" disabled={busy}>{busy?"Reconciling…":"Reconcile"}</button>{message && <div className={message.includes("Recalculation needs attention")?"attention-message":message.includes("resolved") ? "success" : "error"}>{message}</div>}</div>
  </form>;
}


export function OpeningSnapshotForm({ id, accounts=[] }: { id: string; accounts?:AccountOption[] }) {
  const router = useRouter();
  const [savedAccountIds,setSavedAccountIds]=useState<string[]>([]);
  const pendingAccounts=accounts.filter((account)=>(account.ledgerEventCount??0)===0&&!savedAccountIds.includes(account.id));
  const accountSelectId=useId();
  const cashId=useId();
  const [accountId,setAccountId]=useState(pendingAccounts[0]?.id??accounts[0]?.id??"");
  const [cash, setCash] = useState("0");
  const [holdings, setHoldings] = useState([{ ticker: "", exchange: "LSE", quantity: "" }]);
  const [message, setMessage] = useState("");
  const [busy,setBusy]=useState(false);

  function update(index: number, field: "ticker" | "exchange" | "quantity", value: string) {
    setHoldings((rows) => rows.map((row, i) => i === index ? { ...row, [field]: value } : row));
  }

  const accountChoices=pendingAccounts;
  const effectiveAccountId=accountChoices.some((account)=>account.id===accountId)?accountId:(accountChoices[0]?.id??"");
  const selected=accountChoices.find((account)=>account.id===effectiveAccountId)??accountChoices[0];

  return <form className="stack opening-snapshot-form" onSubmit={async (e) => {
    e.preventDefault();
    if(busy||!effectiveAccountId)return;
    setBusy(true);setMessage("");
    try{
    const cleanHoldings = holdings.filter((h) => h.ticker.trim() && h.exchange.trim() && h.quantity.trim());
    const response = await fetch("/api/strategies/" + id + "/opening-snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId:effectiveAccountId||undefined, cash, holdings: cleanHoldings })
    });
    const body = await response.json();setBusy(false);
    if(!response.ok){
      setMessage(body.error ?? "Could not save snapshot.");
      return;
    }
    // A refresh is asynchronous. Retire the saved account immediately so a
    // second submission cannot reuse it while server props are still stale.
    setSavedAccountIds((ids)=>[...ids,effectiveAccountId]);
    setAccountId(pendingAccounts.find((account)=>account.id!==effectiveAccountId)?.id??"");
    setCash("0");
    setHoldings([{ticker:"",exchange:"LSE",quantity:""}]);
    setMessage(body.recalculationPending
      ? "Opening snapshot saved. Recalculation needs attention."
      : body.complete
        ? "Opening snapshot complete. Your strategy can now calculate from today."
        : "Saved for "+(selected?.name??"this account")+". Next: "+(body.pendingAccountNames?.[0]??"the remaining account")+".");
    router.refresh();
    }catch{
      setMessage("Connection interrupted. Refresh to check whether the snapshot was saved before trying again.");
    }finally{
      setBusy(false);
    }
  }}>
    {accountChoices.length>1&&<div className="field">
      <label htmlFor={accountSelectId}>Account to capture</label>
      <select id={accountSelectId} value={effectiveAccountId} onChange={(event)=>{setAccountId(event.target.value);setMessage("")}}>
        {accountChoices.map((account)=><option key={account.id} value={account.id}>{account.name} · {account.wrapper}</option>)}
      </select>
    </div>}
    {selected&&accounts.length>1&&<div className="snapshot-account-progress">
      <span>Starting position for</span><strong>{selected.name}</strong><small>{selected.wrapper} · {selected.currency}</small>
    </div>}
    <div className="field"><label htmlFor={cashId}>Current cash balance</label><input id={cashId} value={cash} onChange={(e) => setCash(e.target.value)} type="number" min="0" step="0.01" /></div>
    {holdings.map((holding, index) => {
      const tickerId="opening-ticker-"+index;
      const exchangeId="opening-exchange-"+index;
      const quantityId="opening-quantity-"+index;
      return <div className="form-grid" key={index}>
        <div className="field"><label htmlFor={tickerId}>Ticker</label><input id={tickerId} value={holding.ticker} onChange={(e) => update(index, "ticker", e.target.value)} placeholder="3QQQ" /></div>
        <div className="field"><label htmlFor={exchangeId}>Exchange</label><input id={exchangeId} value={holding.exchange} onChange={(e) => update(index, "exchange", e.target.value)} placeholder="LSE" /></div>
        <div className="field full"><label htmlFor={quantityId}>Quantity</label><input id={quantityId} value={holding.quantity} onChange={(e) => update(index, "quantity", e.target.value)} type="number" min="0" step="0.00000001" /></div>
      </div>;
    })}
    <div className="inline">
      <button type="button" className="button" onClick={() => setHoldings((rows) => [...rows, { ticker: "", exchange: "LSE", quantity: "" }])}>Add holding</button>
      {holdings.length > 1 && <button type="button" className="button" onClick={() => setHoldings((rows) => rows.slice(0, -1))}>Remove last</button>}
      <button className="button primary" disabled={busy||!effectiveAccountId}>{busy?"Saving…":"Save "+(accounts.length>1?"this account":"opening snapshot")}</button>
    </div>
    <div className="help">This records what you hold now. It does not invent historical trades, cost basis or contributions.</div>
    {accounts.length>1&&pendingAccounts.length>1&&<div className="help">{pendingAccounts.length} linked accounts still need a starting position.</div>}
    {message && <div className={message.includes("Recalculation needs attention")?"attention-message":message.startsWith("Opening snapshot complete")||message.startsWith("Saved for") ? "success" : "error"}>{message}</div>}
  </form>;
}

export function StrategyLifecycleControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClose,setConfirmClose]=useState(false);

  async function change(next: "ACTIVE" | "PAUSED" | "CLOSED") {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/strategies/" + id + "/status", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next })
    });
    const body = await response.json();
    setBusy(false);
    setMessage(response.ok ? (body.recalculationPending?"Strategy status updated. Recalculation needs attention.":"Strategy status updated.") : body.error ?? "Could not update status.");
    if (response.ok) {
      setConfirmClose(false);
      router.refresh();
    }
  }

  return <div className="strategy-lifecycle">
    <div className="inline">
      {status === "ACTIVE" && <button className="button" disabled={busy} onClick={() => change("PAUSED")}>Pause strategy</button>}
      {status === "PAUSED" && <button className="button primary" disabled={busy} onClick={() => change("ACTIVE")}>Resume strategy</button>}
      {status !== "CLOSED" && !confirmClose && <button className="button danger quiet-danger" disabled={busy} onClick={() => setConfirmClose(true)}>Close permanently</button>}
    </div>
    {confirmClose&&<div className="close-confirmation">
      <div><strong>Close this strategy permanently?</strong><span>Your history stays visible, but a closed strategy cannot be reopened.</span></div>
      <div className="inline">
        <button className="button danger" disabled={busy} onClick={()=>change("CLOSED")}>{busy?"Closing…":"Yes, close it"}</button>
        <button className="button quiet" disabled={busy} onClick={()=>setConfirmClose(false)}>Keep strategy</button>
      </div>
    </div>}
    {message && <span className={message.includes("Recalculation needs attention")?"attention-message":message.startsWith("Strategy status updated") ? "success" : "error"}>{message}</span>}
  </div>;
}


type VersionInputField={key:string;label:string;type:"text"|"number"|"date"|"select"|"boolean";required?:boolean;help?:string;default?:string|number|boolean;options?:Array<{label:string;value:string}>;min?:string|number;max?:string|number};

function readableConfigKey(key:string){
  return key.replace(/([a-z0-9])([A-Z])/g,"$1 $2").replaceAll("_"," ").replace(/^./,(letter)=>letter.toUpperCase());
}
function conciseConfigValue(value:unknown){
  if(value==null)return "Not set";
  if(typeof value==="boolean")return value?"On":"Off";
  if(typeof value==="string"||typeof value==="number")return String(value);
  const text=JSON.stringify(value);
  return text.length>90?text.slice(0,87)+"…":text;
}

export function StrategyVersionUpgrade({
  id,currentVersion,targetVersionId,targetVersion,releaseNotes,upgradePolicy,inputSchema,currentSettings,currentConfig,targetConfig
}:{
  id:string;currentVersion:string;targetVersionId:string;targetVersion:string;releaseNotes?:string|null;upgradePolicy:string;
  inputSchema:VersionInputField[];currentSettings:Record<string,unknown>;currentConfig:Record<string,unknown>;targetConfig:Record<string,unknown>;
}){
  const router=useRouter();
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState(false);
  const[previewBusy,setPreviewBusy]=useState(false);
  const[previewError,setPreviewError]=useState("");
  const[preview,setPreview]=useState<null|{actionType:string;title:string;instruction:string;confidence:string;amount:string|null;currency:string|null}>(null);

  function collectSettings(form:HTMLFormElement){
    const f=new FormData(form);
    const settings:Record<string,unknown>={};
    for(const field of inputSchema){
      if(field.type==="boolean")settings[field.key]=Boolean(f.get("versionInput:"+field.key));
      else {
        const value=f.get("versionInput:"+field.key);
        if(value!==null&&String(value)!=="")settings[field.key]=String(value);
      }
    }
    return settings;
  }

  async function previewVersion(form:HTMLFormElement){
    setPreviewBusy(true);setPreviewError("");setPreview(null);
    const response=await fetch("/api/strategies/"+id+"/version",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({targetVersionId,settings:collectSettings(form)})
    });
    const body=await response.json();setPreviewBusy(false);
    if(!response.ok)return setPreviewError(body.error??"Could not preview this version.");
    setPreview(body.result.action);
  }

  const changedKeys=[...new Set([...Object.keys(currentConfig),...Object.keys(targetConfig)])]
    .filter((key)=>JSON.stringify(currentConfig[key])!==JSON.stringify(targetConfig[key]));
  return <section className="glass version-upgrade">
    <div className="version-upgrade-main">
      <div>
        <div className={"pill "+(upgradePolicy==="REQUIRED"?"bad":upgradePolicy==="RECOMMENDED"?"warn":"good")}>{upgradePolicy} UPDATE</div>
        <h3>A newer version of your strategy is available.</h3>
        <p>You are on v{currentVersion}. Version {targetVersion} changes future calculations only — your existing history stays exactly where it is.</p>
      </div>
      <div className="version-jump"><span>v{currentVersion}</span><b>→</b><strong>v{targetVersion}</strong></div>
    </div>

    <details className="version-comparison">
      <summary>See what changes</summary>
      <div className="version-comparison-content">
        {releaseNotes&&<div className="release-notes"><span>Release notes</span><p>{releaseNotes}</p></div>}
        {changedKeys.length?<div className="version-change-list">
          {changedKeys.map((key)=><div className="version-change" key={key}>
            <span>{readableConfigKey(key)}</span>
            <div><del>{conciseConfigValue(currentConfig[key])}</del><b>→</b><ins>{conciseConfigValue(targetConfig[key])}</ins></div>
          </div>)}
        </div>:<p className="help">The strategy engine rules are unchanged. This release may contain wording, compatibility or setup improvements.</p>}
        <p className="help">We do not silently move you to a new ruleset. Updating is an explicit, audited choice.</p>
      </div>
    </details>

    <form className="version-upgrade-form" onSubmit={async(e)=>{
      e.preventDefault();setBusy(true);setMessage("");
      const settings=collectSettings(e.currentTarget);
      const response=await fetch("/api/strategies/"+id+"/version",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({targetVersionId,settings})});
      const body=await response.json();setBusy(false);setMessage(response.ok?(body.recalculationPending?"Strategy updated to v"+targetVersion+". Recalculation needs attention.":"Strategy updated to v"+targetVersion+"."):body.error??"Could not update strategy.");
      if(response.ok)router.refresh();
    }}>
      {inputSchema.length>0&&<details className="advanced-details">
        <summary>Review strategy-specific settings</summary>
        <div className="form-grid version-inputs">
          {inputSchema.map((field)=><Field className="field full" key={field.key} label={field.label}>
            {field.type==="select"?<select name={"versionInput:"+field.key} defaultValue={String(currentSettings[field.key]??field.default??"")} required={field.required}>{!field.required&&<option value="">Not set</option>}{field.options?.map((o)=><option key={o.value} value={o.value}>{o.label}</option>)}</select>:
            field.type==="boolean"?<label className="toggle-row"><input name={"versionInput:"+field.key} type="checkbox" defaultChecked={Boolean(currentSettings[field.key]??field.default)}/><span>{field.help??field.label}</span></label>:
            <input name={"versionInput:"+field.key} type={field.type} defaultValue={currentSettings[field.key]==null?(field.default==null?undefined:String(field.default)):String(currentSettings[field.key])} required={field.required} min={field.min==null?undefined:String(field.min)} max={field.max==null?undefined:String(field.max)}/>}
            {field.help&&field.type!=="boolean"&&<div className="help">{field.help}</div>}
          </Field>)}
        </div>
      </details>}
      {preview&&<div className="version-action-preview" role="status">
        <div><span>Today on v{targetVersion}</span><strong>{preview.title}</strong><p>{preview.instruction}</p></div>
        <span className={"pill "+(preview.confidence==="HIGH"?"good":"warn")}>{preview.confidence} confidence</span>
      </div>}
      {previewError&&<div className="error" role="alert">{previewError}</div>}
      <div className="version-upgrade-actions">
        <button type="button" className="button" disabled={busy||previewBusy} onClick={(event)=>event.currentTarget.form&&previewVersion(event.currentTarget.form)}>{previewBusy?"Previewing…":"Preview today’s action"}</button>
        <button className="button primary" disabled={busy||previewBusy}>{busy?"Updating…":"Update to v"+targetVersion}</button>
        {message&&<div className={message.includes("Recalculation needs attention")?"attention-message":message.startsWith("Strategy updated")?"success":"error"}>{message}</div>}
      </div>
    </form>
  </section>;
}

export function CashEventForm({id,accounts=[]}:{id:string;accounts?:AccountOption[]}){
  const router=useRouter();const[message,setMessage]=useState("");const[busy,setBusy]=useState(false);
  const requestKey=useRef<string|null>(null);
  return <form className="form-grid" onSubmit={async(e)=>{
    e.preventDefault();setBusy(true);setMessage("");const form=e.currentTarget;const f=new FormData(form);const when=String(f.get("when")||"");
    const mutationKey=requestKey.current??crypto.randomUUID();requestKey.current=mutationKey;
    try{
      const response=await fetch("/api/strategies/"+id+"/ledger-events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        eventType:f.get("eventType"),amount:String(f.get("amount")),occurredAt:when?new Date(when).toISOString():undefined,note:f.get("note")||undefined,accountId:f.get("accountId")||undefined,requestKey:mutationKey
      })});
      const body=await response.json().catch(()=>({}));
      setMessage(response.ok?(body.recalculationPending?"Cash event recorded. Recalculation needs attention.":"Cash event recorded."):body.error??"Could not record cash event.");
      if(response.ok){requestKey.current=null;form.reset();router.refresh();}
    }catch{
      setMessage("Connection interrupted. Try again — the same cash event will be reused safely.");
    }finally{
      setBusy(false);
    }
  }}>
    <AccountSelect accounts={accounts}/><Field label="Event"><select name="eventType"><option>WITHDRAWAL</option><option>DIVIDEND</option><option>DISTRIBUTION</option><option>INTEREST</option><option>FEE</option><option>TAX</option></select></Field>
    <Field label="Amount"><input name="amount" type="number" min="0.01" step="0.01" required/></Field>
    <Field label="Date & time"><input name="when" type="datetime-local"/></Field>
    <Field label="Note (optional)"><input name="note" maxLength={240}/></Field>
    <div className="field full"><button className="button" disabled={busy}>{busy?"Recording…":"Record cash event"}</button><div className="help">Withdrawals, fees and tax reduce cash; dividends, distributions and interest increase cash. The original ledger history remains append-only.</div>{message&&<div className={message.includes("Recalculation needs attention")?"attention-message":message.startsWith("Cash event recorded")?"success":"error"}>{message}</div>}</div>
  </form>;
}


export function ReverseLedgerEventButton({strategyId,eventId}:{strategyId:string;eventId:string}){
  const router=useRouter();
  const[open,setOpen]=useState(false);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState("");
  if(!open)return <button type="button" className="button compact quiet correction-trigger" onClick={()=>{setOpen(true);setError("")}}>Correct</button>;
  return <form className="correction-inline" onSubmit={async(e)=>{
    e.preventDefault();const f=new FormData(e.currentTarget);const reason=String(f.get("reason")||"").trim();
    if(!reason)return setError("Add a short reason.");
    setBusy(true);setError("");
    const response=await fetch("/api/strategies/"+strategyId+"/ledger-events/"+eventId+"/correct",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason})});
    const body=await response.json();setBusy(false);
    if(!response.ok)return setError(body.error??"Could not correct entry.");
    setOpen(false);router.refresh();
  }}>
    <input name="reason" maxLength={240} placeholder="What was wrong?" autoFocus/>
    <button className="button compact" disabled={busy}>{busy?"Saving…":"Reverse"}</button>
    <button type="button" className="button compact quiet" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button>
    {error&&<span className="error">{error}</span>}
  </form>;
}

export function ExecutionConstraintsForm({id,constraints}:{id:string;constraints?:Record<string,unknown>|null}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const value=constraints??{};
  return <form className="stack execution-preferences" onSubmit={async(e)=>{
    e.preventDefault();setBusy(true);setMessage("");
    const f=new FormData(e.currentTarget);
    const response=await fetch("/api/strategies/"+id+"/execution-constraints",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        fractionalShares:Boolean(f.get("fractionalShares")),
        minimumTradeAmount:String(f.get("minimumTradeAmount")||"0"),
        cashBufferAmount:String(f.get("cashBufferAmount")||"0"),
        flatFee:String(f.get("flatFee")||"0"),
        allowSelling:Boolean(f.get("allowSelling"))
      })
    });
    const body=await response.json();setBusy(false);
    if(!response.ok)return setMessage(body.error??"Could not save trade preferences.");
    setMessage(body.recalculationPending?"Saved. Recalculation needs attention.":"Saved. Your next action has been recalculated.");
    router.refresh();
  }}>
    <label className="toggle-row"><input type="checkbox" name="fractionalShares" defaultChecked={value.fractionalShares!==false}/><span><b>Fractional shares</b><small>Turn off if your broker only allows whole shares.</small></span></label>
    <div className="form-grid">
      <Field label="Minimum trade"><input name="minimumTradeAmount" type="number" min="0" step="0.01" defaultValue={String(value.minimumTradeAmount??"0")}/></Field>
      <Field label="Keep as cash"><input name="cashBufferAmount" type="number" min="0" step="0.01" defaultValue={String(value.cashBufferAmount??"0")}/></Field>
      <Field className="field full" label="Estimated fee per trade"><input name="flatFee" type="number" min="0" step="0.01" defaultValue={String(value.flatFee??"0")}/></Field>
    </div>
    <label className="toggle-row"><input type="checkbox" name="allowSelling" defaultChecked={value.allowSelling!==false}/><span><b>Allow sell recommendations</b><small>Turn off if you want new contributions to do the work wherever the strategy permits.</small></span></label>
    <div className="inline"><button className="button" disabled={busy}>{busy?"Saving…":"Save trade preferences"}</button>{message&&<span className={message.includes("Recalculation needs attention")?"attention-message":message.startsWith("Saved")?"success":"error"}>{message}</span>}</div>
  </form>;
}


export function ContributionPlanForm({id,plan}:{id:string;plan?:Record<string,unknown>|null}){
  const router=useRouter();
  const value=plan??{};
  const [enabled,setEnabled]=useState(value.enabled===true);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  return <form className="stack contribution-plan-form" onSubmit={async(e)=>{
    e.preventDefault();setBusy(true);setMessage("");
    const f=new FormData(e.currentTarget);
    const response=await fetch("/api/strategies/"+id+"/contribution-plan",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        enabled,
        amount:enabled?String(f.get("amount")||"0"):"0",
        frequency:String(f.get("frequency")||"MONTHLY"),
        nextDate:enabled&&f.get("nextDate")?String(f.get("nextDate")):null
      })
    });
    const body=await response.json();setBusy(false);
    if(!response.ok)return setMessage(body.error??"Could not save contribution plan.");
    setMessage(enabled?"Saved. We will use this only as a reminder.":"Regular contribution reminders are off.");
    router.refresh();
  }}>
    <label className="toggle-row"><input type="checkbox" checked={enabled} onChange={(e)=>setEnabled(e.target.checked)}/><span><b>Regular contribution reminder</b><small>Your portfolio cash changes only when you record an actual contribution.</small></span></label>
    {enabled&&<div className="form-grid">
      <Field label="Usual amount"><input name="amount" type="number" min="0.01" step="0.01" defaultValue={String(value.amount??"")||undefined} required/></Field>
      <Field label="Frequency"><select name="frequency" defaultValue={String(value.frequency??"MONTHLY")}><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option></select></Field>
      <Field className="field full" label="Next date"><input name="nextDate" type="date" defaultValue={value.nextDate?String(value.nextDate):undefined}/></Field>
    </div>}
    <div className="inline"><button className="button" disabled={busy}>{busy?"Saving…":"Save contribution plan"}</button>{message&&<span className="success">{message}</span>}</div>
  </form>;
}


type StrategySwitchOption={
  key:string;
  name:string;
  version:string;
  inputSchema:VersionInputField[];
};

export function StrategySwitchControl({id,options=[]}:{id:string;options?:StrategySwitchOption[]}){
  const router=useRouter();
  const [key,setKey]=useState(options[0]?.key??"");
  const [preview,setPreview]=useState<null|{targetStrategy:{key:string;name:string;version:string};action:{title:string;instruction:string;confidence:string}}>(null);
  const [settings,setSettings]=useState<Record<string,unknown>>({});
  const [busy,setBusy]=useState(false);
  const [applying,setApplying]=useState(false);
  const [confirm,setConfirm]=useState(false);
  const [error,setError]=useState("");
  const selected=options.find((option)=>option.key===key)??options[0];

  if(!selected)return <p className="help">No other compatible strategy is available on your current plan.</p>;

  function collect(form:HTMLFormElement){
    const f=new FormData(form);
    const next:Record<string,unknown>={};
    for(const field of selected.inputSchema){
      if(field.type==="boolean")next[field.key]=Boolean(f.get("switchLifecycle:"+field.key));
      else{
        const value=f.get("switchLifecycle:"+field.key);
        if(value!==null&&String(value)!=="")next[field.key]=String(value);
      }
    }
    return next;
  }

  async function previewSwitch(form:HTMLFormElement){
    setBusy(true);setError("");setPreview(null);setConfirm(false);
    const nextSettings=collect(form);
    const response=await fetch("/api/strategies/"+id+"/preview",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({type:"STRATEGY_SWITCH",targetStrategyKey:key,settings:nextSettings})
    });
    const body=await response.json();setBusy(false);
    if(!response.ok)return setError(body.error??"Could not preview this strategy.");
    setSettings(nextSettings);
    setPreview({targetStrategy:body.result.scenario.targetStrategy,action:body.result.action});
  }

  async function applySwitch(){
    if(!preview)return;
    setApplying(true);setError("");
    const response=await fetch("/api/strategies/"+id+"/switch",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({targetStrategyKey:preview.targetStrategy.key,settings})
    });
    const body=await response.json();setApplying(false);
    if(!response.ok)return setError(body.error??"Could not switch strategies.");
    router.push("/app/strategies/"+body.newStrategyInstanceId);
    router.refresh();
  }

  return <form className="strategy-switch-control" onSubmit={(event)=>{event.preventDefault();previewSwitch(event.currentTarget)}}>
    <Field label="Switch to"><select value={key} onChange={(event)=>{setKey(event.target.value);setPreview(null);setConfirm(false);setError("")}}>{options.map((option)=><option key={option.key} value={option.key}>{option.name} · v{option.version}</option>)}</select></Field>
    {selected.inputSchema.length>0&&<div className="form-grid">{selected.inputSchema.map((field)=><Field className="field full" key={field.key} label={field.label}>
      {field.type==="select"?<select name={"switchLifecycle:"+field.key} defaultValue={String(field.default??"")} required={field.required}>{!field.required&&<option value="">Not set</option>}{field.options?.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:
      field.type==="boolean"?<label className="toggle-row"><input name={"switchLifecycle:"+field.key} type="checkbox" defaultChecked={Boolean(field.default)}/><span>{field.help??field.label}</span></label>:
      <input name={"switchLifecycle:"+field.key} type={field.type} defaultValue={field.default==null?undefined:String(field.default)} required={field.required} min={field.min==null?undefined:String(field.min)} max={field.max==null?undefined:String(field.max)}/>}
      {field.help&&field.type!=="boolean"&&<div className="help">{field.help}</div>}
    </Field>)}</div>}
    {!preview&&<button className="button" disabled={busy}>{busy?"Checking…":"Preview switch"}</button>}
    {preview&&<div className="lifecycle-switch-preview">
      <div><span>New strategy would say today</span><strong>{preview.action.title}</strong><p>{preview.action.instruction}</p></div>
      {!confirm?<button type="button" className="button" onClick={()=>setConfirm(true)}>Switch to {preview.targetStrategy.name}</button>:<div className="switch-confirmation">
        <div><strong>Close this journey and start {preview.targetStrategy.name} from today’s portfolio?</strong><span>Your old strategy history remains available and no historical trades are rewritten.</span></div>
        <div className="inline"><button type="button" className="button primary" disabled={applying} onClick={applySwitch}>{applying?"Switching…":"Confirm switch"}</button><button type="button" className="button quiet" disabled={applying} onClick={()=>setConfirm(false)}>Cancel</button></div>
      </div>}
    </div>}
    {error&&<div className="error" role="alert">{error}</div>}
  </form>;
}

type WhatIfResult={
  scenario:{
    type:"CONTRIBUTION"|"WITHDRAWAL"|"EXECUTION_CONSTRAINTS"|"STRATEGY_SWITCH";
    amount?:string;
    currency:string;
    constraints?:{
      fractionalShares:boolean;
      minimumTradeAmount:string;
      cashBufferAmount:string;
      flatFee:string;
      allowSelling:boolean;
    };
    targetStrategy?:{key:string;name:string;version:string};
  };
  portfolioValueAfter:string;
  action:{actionType:string;title:string;instruction:string;amount:string|null;currency:string|null;confidence:string;explanation:Array<{label:string;value:string;kind?:string}>};
};

export function WhatIfPreview({
  id,currency,switchOptions=[]
}:{
  id:string;
  currency:string;
  switchOptions?:StrategySwitchOption[];
}){
  const [type,setType]=useState<"CONTRIBUTION"|"WITHDRAWAL"|"EXECUTION_CONSTRAINTS"|"STRATEGY_SWITCH">("CONTRIBUTION");
  const [switchKey,setSwitchKey]=useState(switchOptions[0]?.key??"");
  const [result,setResult]=useState<WhatIfResult|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const selectedSwitch=switchOptions.find((option)=>option.key===switchKey)??switchOptions[0];



  return <div className="what-if">
    <form className="what-if-form" onSubmit={async(e)=>{
      e.preventDefault();setBusy(true);setError("");setResult(null);
      const f=new FormData(e.currentTarget);
      let payload:Record<string,unknown>;
      if(type==="EXECUTION_CONSTRAINTS"){
        payload={
          type,
          constraints:{
            fractionalShares:Boolean(f.get("fractionalShares")),
            minimumTradeAmount:String(f.get("minimumTradeAmount")||"0"),
            cashBufferAmount:String(f.get("cashBufferAmount")||"0"),
            flatFee:String(f.get("flatFee")||"0"),
            allowSelling:Boolean(f.get("allowSelling"))
          }
        };
      }else if(type==="STRATEGY_SWITCH"){
        const settings:Record<string,unknown>={};
        for(const field of selectedSwitch?.inputSchema??[]){
          if(field.type==="boolean")settings[field.key]=Boolean(f.get("switchInput:"+field.key));
          else {
            const value=f.get("switchInput:"+field.key);
            if(value!==null&&String(value)!=="")settings[field.key]=String(value);
          }
        }
        payload={type,targetStrategyKey:switchKey,settings};
      }else{
        payload={type,amount:String(f.get("amount")||"")};
      }

      const response=await fetch("/api/strategies/"+id+"/preview",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)
      });
      const body=await response.json();setBusy(false);
      if(!response.ok)return setError(body.error??"Could not preview that scenario.");
      setResult(body.result);
    }}>
      <div className={"scenario-switch "+(switchOptions.length?"four":"three")} role="group" aria-label="Scenario type">
        <button type="button" className={type==="CONTRIBUTION"?"active":""} onClick={()=>{setType("CONTRIBUTION");setResult(null)}}>Add money</button>
        <button type="button" className={type==="WITHDRAWAL"?"active":""} onClick={()=>{setType("WITHDRAWAL");setResult(null)}}>Withdraw</button>
        <button type="button" className={type==="EXECUTION_CONSTRAINTS"?"active":""} onClick={()=>{setType("EXECUTION_CONSTRAINTS");setResult(null)}}>Trade settings</button>
        {switchOptions.length>0&&<button type="button" className={type==="STRATEGY_SWITCH"?"active":""} onClick={()=>{setType("STRATEGY_SWITCH");setResult(null)}}>Switch strategy</button>}
      </div>

      {type==="EXECUTION_CONSTRAINTS"?<div className="preview-settings">
        <label className="toggle-row"><input type="checkbox" name="fractionalShares" defaultChecked/><span><b>Fractional shares</b><small>Turn off to preview whole-share-only execution.</small></span></label>
        <div className="form-grid">
          <Field label="Minimum trade"><input name="minimumTradeAmount" type="number" min="0" step="0.01" defaultValue="0"/></Field>
          <Field label="Keep as cash"><input name="cashBufferAmount" type="number" min="0" step="0.01" defaultValue="0"/></Field>
          <Field className="field full" label="Estimated fee"><input name="flatFee" type="number" min="0" step="0.01" defaultValue="0"/></Field>
        </div>
        <label className="toggle-row"><input type="checkbox" name="allowSelling" defaultChecked/><span><b>Allow sell recommendations</b><small>Preview how the next action changes if sells are unavailable.</small></span></label>
        <button className="button primary" disabled={busy}>{busy?"Previewing…":"Preview trade settings"}</button>
      </div>:type==="STRATEGY_SWITCH"&&selectedSwitch?<div className="preview-settings strategy-switch-preview-form">
        <Field label="Try another strategy">
          <select value={switchKey} onChange={(event)=>{setSwitchKey(event.target.value);setResult(null)}}>
            {switchOptions.map((option)=><option key={option.key} value={option.key}>{option.name} · v{option.version}</option>)}
          </select>
        </Field>
        {selectedSwitch.inputSchema.length>0&&<div className="form-grid">
          {selectedSwitch.inputSchema.map((field)=><Field className="field full" key={field.key} label={field.label}>
            {field.type==="select"?<select name={"switchInput:"+field.key} defaultValue={String(field.default??"")} required={field.required}>{!field.required&&<option value="">Not set</option>}{field.options?.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:
            field.type==="boolean"?<label className="toggle-row"><input name={"switchInput:"+field.key} type="checkbox" defaultChecked={Boolean(field.default)}/><span>{field.help??field.label}</span></label>:
            <input name={"switchInput:"+field.key} type={field.type} defaultValue={field.default==null?undefined:String(field.default)} required={field.required} min={field.min==null?undefined:String(field.min)} max={field.max==null?undefined:String(field.max)}/>}
            {field.help&&field.type!=="boolean"&&<div className="help">{field.help}</div>}
          </Field>)}
        </div>}
        <button className="button primary" disabled={busy||!switchKey}>{busy?"Previewing…":"Preview "+selectedSwitch.name}</button>
      </div>:<div className="what-if-input">
        <span>{currency}</span>
        <input name="amount" type="number" min="0.01" step="0.01" placeholder={type==="CONTRIBUTION"?"1000":"5000"} required/>
        <button className="button primary" disabled={busy}>{busy?"Previewing…":"Preview"}</button>
      </div>}

      <p className="help">Preview only. This does not change holdings, cash, settings, strategy version, history, actions or notifications.</p>
      {error&&<div className="error" role="alert">{error}</div>}
    </form>

    {result&&<div className="what-if-result">
      <div className="preview-badge">PREVIEW · NOT APPLIED</div>
      <div className="what-if-value">
        <span>{["EXECUTION_CONSTRAINTS","STRATEGY_SWITCH"].includes(result.scenario.type)?"Portfolio value stays":"Portfolio after scenario"}</span>
        <strong>{new Intl.NumberFormat("en-GB",{style:"currency",currency:result.scenario.currency,maximumFractionDigits:0}).format(Number(result.portfolioValueAfter))}</strong>
      </div>
      {result.scenario.type==="STRATEGY_SWITCH"&&result.scenario.targetStrategy&&<div className="switch-preview-target">
        <div><span>Previewing</span><strong>{result.scenario.targetStrategy.name} · v{result.scenario.targetStrategy.version}</strong></div>
        <small>Preview only. Apply a real switch under Strategy settings & rules → Lifecycle.</small>
      </div>}
      <div className="what-if-action">
        <span>What the strategy would say</span>
        <h3>{result.action.title}</h3>
        <p>{result.action.instruction}</p>
      </div>
      {result.scenario.type==="EXECUTION_CONSTRAINTS"&&result.scenario.constraints&&<div className="preview-constraint-summary">
        <span>{result.scenario.constraints.fractionalShares?"Fractions allowed":"Whole shares only"}</span>
        <span>Min {currency} {result.scenario.constraints.minimumTradeAmount}</span>
        <span>Cash buffer {currency} {result.scenario.constraints.cashBufferAmount}</span>
        <span>{result.scenario.constraints.allowSelling?"Sells allowed":"No sells"}</span>
      </div>}
      {result.action.explanation.length>0&&<details><summary>Why?</summary><div>{result.action.explanation.slice(0,6).map((row,index)=><div className="why-row" key={index}><span>{row.label}</span><b>{row.value}</b></div>)}</div></details>}
    </div>}
  </div>;
}
