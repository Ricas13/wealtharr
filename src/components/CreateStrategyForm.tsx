"use client";
import { Field } from "@/components/Field";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Play, RotateCcw, Sparkles } from "lucide-react";

type InputField={key:string;label:string;type:"text"|"number"|"date"|"select"|"boolean";required?:boolean;help?:string;default?:string|number|boolean;options?:Array<{label:string;value:string}>;min?:string|number;max?:string|number};
type Strategy={key:string;name:string;family:string;description:string;version:string;inputSchema:InputField[];supportedWrappers:string[];supportedMarkets:string[]};

function StrategyFields({fields}:{fields:InputField[]}){
  if(!fields.length)return null;
  return <div className="setup-section">
    <div className="setup-section-title"><span>Strategy setup</span><small>Only the settings this strategy needs</small></div>
    <div className="form-grid">
      {fields.map((field)=><Field className="field full" key={field.key} label={field.label}>
        {field.type==="select"?<select name={"strategyInput:"+field.key} defaultValue={String(field.default??"")} required={field.required}>{!field.required&&<option value="">Not set</option>}{field.options?.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:
        field.type==="boolean"?<label className="toggle-row"><input name={"strategyInput:"+field.key} type="checkbox" defaultChecked={Boolean(field.default)}/><span>{field.help??field.label}</span></label>:
        <input name={"strategyInput:"+field.key} type={field.type} defaultValue={field.default==null?undefined:String(field.default)} required={field.required} min={field.min==null?undefined:String(field.min)} max={field.max==null?undefined:String(field.max)}/>}
        {field.help&&field.type!=="boolean"&&<div className="help">{field.help}</div>}
      </Field>)}
    </div>
  </div>;
}

export function CreateStrategyForm({strategies,baseCurrency,brand}:{strategies:Strategy[];baseCurrency:string;brand:string}) {
  const router=useRouter();
  const [step,setStep]=useState(0);
  const [mode,setMode]=useState<"START_NEW"|"RESUME">("START_NEW");
  const [selectedKey,setSelectedKey]=useState(strategies[0]?.key??"");
  const [error,setError]=useState("");
  const [upgradeRequired,setUpgradeRequired]=useState(false);
  const [busy,setBusy]=useState(false);
  const pendingRequest=useRef<{payload:string;key:string}|null>(null);
  const [regularContribution,setRegularContribution]=useState(false);
  const selected=useMemo(()=>strategies.find((s)=>s.key===selectedKey)??strategies[0],[strategies,selectedKey]);
  const wrappers=selected?.supportedWrappers.length?selected.supportedWrappers:["ISA","SIPP","TAXABLE"];

  if(!strategies.length)return <div className="empty">There are no strategies available to start right now.</div>;

  return <form className="onboarding-shell" onSubmit={async(e)=>{
    e.preventDefault();
    if(busy)return;
    setBusy(true);setError("");setUpgradeRequired(false);
    const f=new FormData(e.currentTarget);
    const settings:Record<string,unknown>={};
    for(const field of selected?.inputSchema??[]){
      if(field.type==="boolean")settings[field.key]=Boolean(f.get("strategyInput:"+field.key));
      else {const value=f.get("strategyInput:"+field.key);if(value!==null&&String(value)!=="")settings[field.key]=String(value);}
    }
    const payload={
      strategyKey:selectedKey,name:f.get("name"),wrapper:f.get("wrapper"),broker:f.get("broker")||null,currency:f.get("currency"),onboardingMode:mode,
      startingCash:f.get("startingCash")||undefined,approximateValue:f.get("approximateValue")||undefined,settings,
      executionConstraints:{
        fractionalShares:Boolean(f.get("fractionalShares")),
        minimumTradeAmount:String(f.get("minimumTradeAmount")||"0"),
        cashBufferAmount:String(f.get("cashBufferAmount")||"0"),
        flatFee:String(f.get("flatFee")||"0"),
        allowSelling:Boolean(f.get("allowSelling"))
      },
      contributionPlan:{
        enabled:regularContribution,
        amount:regularContribution?String(f.get("regularContributionAmount")||"0"):"0",
        frequency:String(f.get("contributionFrequency")||"MONTHLY"),
        nextDate:regularContribution&&f.get("nextContributionDate")?String(f.get("nextContributionDate")):null
      }
    };
    const serialized=JSON.stringify(payload);
    if(!pendingRequest.current||pendingRequest.current.payload!==serialized)
      pendingRequest.current={payload:serialized,key:crypto.randomUUID()};
    try {
      const response=await fetch("/api/strategies",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...payload,requestKey:pendingRequest.current.key})});
      const body=await response.json();
      if(!response.ok){setUpgradeRequired(Boolean(body.upgrade));return setError(body.error??"Could not add strategy.");}
      router.push("/app/strategies/"+body.id);
    } catch {
      setError("The connection was interrupted. Retry with the same details to recover your setup safely.");
    } finally {setBusy(false);}
  }}>
    <div className="stepper" aria-label="Setup progress">
      {["Strategy","Starting point","Set up"].map((label,index)=><div className={"step "+(index===step?"active":index<step?"complete":"")} key={label}>
        <span>{index<step?<Check size={13}/>:index+1}</span><b>{label}</b>
      </div>)}
    </div>

    <section className="glass onboarding-card">
      {step===0&&<>
        <div className="onboarding-intro">
          <div className="welcome-orb small"><Sparkles size={20}/></div>
          <div><div className="eyebrow">Step 1 of 3</div><h2>Choose your strategy.</h2><p>Pick the set of rules you want to follow. You can explore the details later.</p></div>
        </div>
        <div className="choice-grid strategy-choice-grid">
          {strategies.map((strategy)=><button type="button" className={"choice-card "+(strategy.key===selectedKey?"selected":"")} onClick={()=>setSelectedKey(strategy.key)} key={strategy.key}>
            <span className="choice-check">{strategy.key===selectedKey?<Check size={14}/>:null}</span>
            <span className="choice-kicker">{strategy.family.replaceAll("_"," ")}</span>
            <strong>{strategy.name}</strong>
            <p>{strategy.description}</p>
            <small>Version {strategy.version}</small>
            <small>{strategy.supportedMarkets.length?"Verified markets: "+strategy.supportedMarkets.join(", "):"Not yet available in any verified market"}</small>
          </button>)}
        </div>
      </>}

      {step===1&&<>
        <div className="onboarding-intro">
          <div><div className="eyebrow">Step 2 of 3</div><h2>Where are you starting?</h2><p>This lets us meet you where you are instead of forcing you to rebuild your history.</p></div>
        </div>
        <div className="choice-grid mode-choice-grid">
          <button type="button" className={"choice-card mode-card "+(mode==="START_NEW"?"selected":"")} onClick={()=>setMode("START_NEW")}>
            <span className="mode-icon"><Play size={20}/></span>
            <strong>Starting fresh</strong>
            <p>I am beginning this strategy now with cash or a new contribution.</p>
            <span className="choice-action">Start from today <ArrowRight size={14}/></span>
          </button>
          <button type="button" className={"choice-card mode-card "+(mode==="RESUME"?"selected":"")} onClick={()=>setMode("RESUME")}>
            <span className="mode-icon"><RotateCcw size={20}/></span>
            <strong>Already following it</strong>
            <p>I already hold investments and want {brand} to pick up from where I am.</p>
            <span className="choice-action">Resume my journey <ArrowRight size={14}/></span>
          </button>
        </div>
        {mode==="RESUME"&&<div className="resume-note"><Check size={16}/><span>You will not need to recreate every old transaction. After setup, enter your current holdings and cash as an opening snapshot.</span></div>}
      </>}

      {step===2&&<>
        <div className="onboarding-intro">
          <div><div className="eyebrow">Step 3 of 3</div><h2>Just the essentials.</h2><p>{mode==="START_NEW"?"Tell us what you are starting with.":"Give us a rough starting point; your holdings snapshot comes next."}</p></div>
        </div>

        <div className="setup-section">
          <div className="setup-section-title"><span>{selected?.name}</span><small>{mode==="START_NEW"?"New strategy":"Resume existing strategy"}</small></div>
          <div className="form-grid">
            <div className="field full"><label htmlFor="strategy-name">What should we call it?</label><input id="strategy-name" name="name" placeholder={selected?.name+" · My account"} required autoFocus/></div>
            {mode==="START_NEW"?<div className="field full"><label htmlFor="starting-cash">How much are you starting with?</label><div className="money-input"><span>{baseCurrency}</span><input id="starting-cash" name="startingCash" type="number" min="0" step="0.01" placeholder="5000"/></div><div className="help">We record this as cash first. You confirm any purchase separately.</div></div>:
            <div className="field full"><label htmlFor="approximate-value">Rough account value <span className="optional">optional</span></label><div className="money-input"><span>{baseCurrency}</span><input id="approximate-value" name="approximateValue" type="number" min="0" step="0.01" placeholder="31816"/></div><div className="help">This is only an orientation value. Your current holdings snapshot becomes the real starting record.</div></div>}
          </div>
          <div className="preference-divider"/>
          <label className="toggle-row contribution-toggle"><input type="checkbox" checked={regularContribution} onChange={(e)=>setRegularContribution(e.target.checked)}/><span><b>I plan to add money regularly</b><small>Optional. This creates a reminder only — money is counted only after you record the real deposit.</small></span></label>
          {regularContribution&&<div className="form-grid contribution-plan-fields">
            <div className="field"><label htmlFor="regular-contribution-amount">Usual amount</label><div className="money-input"><span>{baseCurrency}</span><input id="regular-contribution-amount" name="regularContributionAmount" type="number" min="0.01" step="0.01" placeholder="500" required/></div></div>
            <div className="field"><label htmlFor="contribution-frequency">How often?</label><select id="contribution-frequency" name="contributionFrequency" defaultValue="MONTHLY"><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option></select></div>
            <div className="field full"><label htmlFor="next-contribution-date">Next contribution date <span className="optional">optional</span></label><input id="next-contribution-date" name="nextContributionDate" type="date"/><div className="help">Leave blank and we will schedule the first reminder one period from today.</div></div>
          </div>}
        </div>

        <StrategyFields fields={selected?.inputSchema??[]}/>

        <details className="advanced-details">
          <summary>Account details</summary>
          <p className="help">Defaults are usually enough. Change these only if they apply to you.</p>
          <div className="form-grid">
            <div className="field"><label htmlFor="account-wrapper">Account type</label><select id="account-wrapper" name="wrapper" key={selectedKey} defaultValue={wrappers[0]}>{wrappers.map((wrapper)=><option key={wrapper}>{wrapper}</option>)}</select></div>
            <div className="field"><label htmlFor="account-currency">Currency</label><select id="account-currency" name="currency" defaultValue={baseCurrency}>{!["GBP","USD","EUR"].includes(baseCurrency)&&<option>{baseCurrency}</option>}<option>GBP</option><option>USD</option><option>EUR</option></select></div>
            <div className="field full"><label htmlFor="account-broker">Broker <span className="optional">optional</span></label><input id="account-broker" name="broker" placeholder="e.g. Trading 212"/></div>
          </div>
          <div className="preference-divider"/>
          <div className="setup-section-title"><span>Trade preferences</span><small>Optional — sensible defaults are already selected</small></div>
          <div className="stack">
            <label className="toggle-row"><input type="checkbox" name="fractionalShares" defaultChecked/><span><b>My broker supports fractional shares</b><small>Turn this off if orders must use whole shares.</small></span></label>
            <div className="form-grid">
              <Field label="Minimum trade"><input name="minimumTradeAmount" type="number" min="0" step="0.01" defaultValue="0"/></Field>
              <Field label="Cash buffer"><input name="cashBufferAmount" type="number" min="0" step="0.01" defaultValue="0"/></Field>
              <Field className="field full" label="Estimated fee per trade"><input name="flatFee" type="number" min="0" step="0.01" defaultValue="0"/></Field>
            </div>
            <label className="toggle-row"><input type="checkbox" name="allowSelling" defaultChecked/><span><b>Allow sell recommendations</b><small>Turn this off if you prefer to correct allocations with new money when the strategy permits.</small></span></label>
          </div>
        </details>
      </>}

      {error&&<div className={"onboarding-error "+(upgradeRequired?"plan-inline-error":"error")}>
        <span>{error}</span>
        {upgradeRequired&&<Link className="button compact primary" href="/app/settings#plan">See plan options <ArrowRight size={14}/></Link>}
      </div>}

      <div className="onboarding-footer">
        {step>0?<button type="button" className="button quiet" onClick={()=>{setError("");setStep(step-1)}}><ArrowLeft size={16}/>Back</button>:<span/>}
        {step<2?<button type="button" className="button primary" onClick={()=>{setError("");setStep(step+1)}}>Continue <ArrowRight size={16}/></button>:
        <button className="button primary finish-button" disabled={busy}>{busy?"Setting things up…":mode==="START_NEW"?"Start my strategy":"Resume my strategy"} <ArrowRight size={16}/></button>}
      </div>
    </section>

    <p className="onboarding-trust">You stay in control. {brand} calculates and explains actions; it does not place trades for you.</p>
  </form>;
}
