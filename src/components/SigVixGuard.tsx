"use client";
import {useEffect,useMemo,useState} from "react";
import {classifySheet107Vix,sheet107HalfRiskPositions,sheet107VixChoices,type HeldRiskLine,type VixChoice} from "@/domain/strategy/sig-sheet-107";

type Observation={available:boolean;value?:string;closeDate?:string;source?:string;reason?:string};
const CHOICES:ReadonlyArray<{value:VixChoice;label:string}>= [
  {value:"DO_NOTHING",label:"Do nothing — follow the normal quarterly signal"},
  {value:"SETTLE_EARLY",label:"Consider early settlement to the SIG line"},
  {value:"REBALANCE_EARLY",label:"Consider an early 60/40 reset"},
  {value:"SELL_HALF",label:"Preview selling half of held risk shares"}
];

export function SigVixGuard({id,riskLines,riskHoldingsComplete}:{id:string;riskLines:HeldRiskLine[];riskHoldingsComplete:boolean}){
  const [observation,setObservation]=useState<Observation|null>(null);
  const [scenarioValue,setScenarioValue]=useState("");
  const [usingScenario,setUsingScenario]=useState(false);
  const [busy,setBusy]=useState(false);
  const [choice,setChoice]=useState<VixChoice>("DO_NOTHING");
  // Load a completed-close indicator on entry; a red warning is displayed
  // automatically when a rights-cleared feed exists. Never place any order.
  useEffect(()=>{
    let active=true;
    void fetch("/api/strategies/"+id+"/vix",{cache:"no-store"})
      .then(async response=>{
        const body=await response.json().catch(()=>({}));
        return response.ok?body:{available:false,reason:body.error??"VIX feed unavailable."};
      }).then(body=>{if(active)setObservation(body);})
      .catch(()=>{if(active)setObservation({available:false,reason:"VIX feed unavailable."});});
    return ()=>{active=false;};
  },[id]);
  const value=usingScenario?scenarioValue:observation?.available?observation.value??"":"";
  const regime=useMemo(()=>{
    if(!value)return null;
    try{return classifySheet107Vix(value);}catch{return null;}
  },[value]);
  const choices=regime?sheet107VixChoices(value,true):["DO_NOTHING"] as VixChoice[];
  const half=useMemo(()=>{
    try{return {lines:sheet107HalfRiskPositions(riskLines),error:null};}
    catch{return {lines:[],error:"Your holdings need reconciliation before a half-position can be calculated."};}
  },[riskLines]);
  const verifiedFear=!usingScenario&&observation?.available===true&&regime==="FEAR";
  return <details className={"glass adaptive-vix-panel "+(verifiedFear?"fear":"")} aria-label="Optional VIX risk overlay">
    <summary className="adaptive-vix-summary">
      <span className="adaptive-vix-name"><strong>VIX risk indicator</strong><small>Optional · no automatic trades</small></span>
      <span className={"adaptive-vix-regime "+(verifiedFear?"fear":"")}>
        {verifiedFear?"● Fear · VIX "+value:usingScenario?"What-if scenario":regime?regime==="CALM"?"Calm":"Normal":observation?.available===false?"Data unavailable":"Checking…"}
      </span>
      <span aria-hidden="true" className="adaptive-vix-chevron">⌄</span>
    </summary>
    <div className="adaptive-vix-content">
      {verifiedFear&&<p className="attention-message" role="status"><strong>VIX closed above 30.</strong> You have optional responses to review; no trade will be placed automatically.</p>}
      <p className="help">VIX measures expected S&amp;P 500 volatility. This separately labelled scenario is not part of the original 9Sig signal and never places an order automatically.</p>
    <div className="inline">
      <button type="button" className="button" disabled={busy} onClick={async()=>{
        setBusy(true);setUsingScenario(false);setChoice("DO_NOTHING");
        try{
          const response=await fetch("/api/strategies/"+id+"/vix",{cache:"no-store"});
          const body=await response.json().catch(()=>({}));
          setObservation(response.ok?body:{available:false,reason:body.error??"VIX quote unavailable."});
        }catch{setObservation({available:false,reason:"VIX feed unavailable."});}
        finally{setBusy(false);}
      }}>{busy?"Checking…":"Check last verified VIX close"}</button>
      <span>Calm: below 15 · Normal: 15–30 · Fear: above 30</span>
    </div>
    <div className="field">
      <label htmlFor={"sig-vix-scenario-"+id}>Alternatively, enter a VIX number for an unverified what-if simulation</label>
      <div className="inline">
        <input id={"sig-vix-scenario-"+id} type="number" min="0" max="150" step="0.01"
          value={scenarioValue} placeholder="e.g. 32.80" onChange={e=>{setScenarioValue(e.target.value);setUsingScenario(true);setChoice("DO_NOTHING");}}/>
        <button className="button" type="button" onClick={()=>{setUsingScenario(false);setChoice("DO_NOTHING");}}>Use verified feed</button>
      </div>
    </div>
    {usingScenario?<p className="help" role="status">Scenario only — {regime?"not a verified current VIX close.":"enter a value from 0 to 150."} No live market conclusion is inferred.</p>:
     observation?.available?<p className="help" role="status">Daily-close observation: {observation.value} on {observation.closeDate} via {observation.source}. No intraday triggers.</p>:
     <p className="help" role="status">{observation?.reason??"Select Check to request a completed VIX close from the configured rights-cleared data provider."}</p>}
    {regime&&<div className="kpi"><span>Volatility regime</span><strong>{regime==="FEAR"?"🔴 Fear":regime==="CALM"?"🟢 Calm":"⚪ Normal"}</strong></div>}
    {regime==="FEAR"&&<p className="help">The red light only presents choices. A VIX close above 30 does not prove prices will fall afterward or that selling improves long-term performance.</p>}
    <div className="field">
      <label htmlFor={"sig-vix-option-"+id}>Optional response</label>
      <select id={"sig-vix-option-"+id} value={choices.includes(choice)?choice:"DO_NOTHING"}
        onChange={e=>setChoice(e.target.value as VixChoice)}>
        {CHOICES.filter(o=>choices.includes(o.value)).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
    {regime==="FEAR"&&choice==="SELL_HALF"&&<div className="stack">
      <strong>Half-position scenario (not a trade)</strong>
      {!riskHoldingsComplete?<p className="attention-message">Some held instruments do not have a unique current trading line. Resolve the mapping before sizing a half-position.</p>:half.error?<p className="attention-message">{half.error}</p>:!half.lines.length?
        <p className="help">No uniquely identified risk positions with positive broker-recorded shares were found. Reconcile your holdings first.</p>:
        half.lines.map(line=><div className="why-row" key={line.accountId+"|"+line.instrumentId}>
          <span>{line.ticker} · {line.exchange} · account {line.accountId.slice(0,8)}</span>
          <b>Hold {line.heldQuantity} → sell {line.indicativeSellQuantity} → keep {line.residualQuantity}{!line.exactHalf?" (rounded down)":""}</b>
        </div>)}
      <p className="help">Actual trading quantities, fees, exchange eligibility and fractional-share support depend on your broker. If you choose to sell, place the order yourself and record the confirmed fill below; Wealtharr will then recalculate from the ledger.</p>
      <a href="#portfolio-update" className="button compact">Record actual broker fill</a>
    </div>}
    {regime==="FEAR"&&choice==="SETTLE_EARLY"&&
      <p className="help">Only consider selling down to the currently applicable SIG line if your verified risk-exposure value exceeds it. This is a hypothetical alternative outside the scheduled review; without fresh holdings and quotes no size is asserted.</p>}
    {regime==="FEAR"&&choice==="REBALANCE_EARLY"&&
      <p className="help">An early reset scenario would target 60% risk and 40% safe value, requiring up-to-date valuations, fees and broker execution. No order or target-state change is created from this choice.</p>}
    {(!regime||regime!=="FEAR"||choice==="DO_NOTHING")&&
      <p className="help">Normal quarterly signals and 30 Down safeguards continue unchanged. VIX scenarios do not amend the investment ledger, the published rule version or the next quarterly target.</p>}
    </div>
  </details>;
}
