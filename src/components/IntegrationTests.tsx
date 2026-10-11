"use client";
import {useState} from "react";
export function IntegrationTests(){
 const [symbol,setSymbol]=useState("TQQQ");
 const [historyDate,setHistoryDate]=useState("");
 const [historyCurrency,setHistoryCurrency]=useState("USD");
 const [busy,setBusy]=useState("");
 const [results,setResults]=useState<Record<string,string>>({});
 const [setupMessage,setSetupMessage]=useState("");
 const [setupBusy,setSetupBusy]=useState(false);
 async function connectStripe(){
  setSetupBusy(true);setSetupMessage("");
  try{
   const r=await fetch("/api/admin/operations/connect-stripe",{method:"POST"});
   const response=await r.json().catch(()=>({}));
   setSetupMessage(r.ok?"Stripe webhook registered and its signing secret saved securely.":response.error??"Stripe setup failed.");
  }catch{setSetupMessage("Could not reach the Stripe configuration service.");}
  finally{setSetupBusy(false);}
 }
 async function run(service:"STRIPE"|"EMAIL"|"MARKET_DATA"|"MARKET_DATA_HISTORY"|"TELEGRAM"){
  setBusy(service);
  try{
   const r=await fetch("/api/admin/operations/test-connection",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({service,
       ...(service==="MARKET_DATA"?{symbol}:{}),
       ...(service==="MARKET_DATA_HISTORY"?{symbol,date:historyDate,currency:historyCurrency}: {})
     })});
   const v=await r.json().catch(()=>({}));
   setResults(old=>({...old,[service]:v.message??v.error??"Unable to test connection."}));
  }catch{setResults(old=>({...old,[service]:"Connection test failed."}));}
  finally{setBusy("");}
 }
 return <section className="glass form-card"><h3>Test provider connections</h3><p className="help">These actions contact configured providers. Stripe checks authentication, email sends to your admin address, market data tests current and adjusted historical observations, and Telegram verifies the bot and registers its secure webhook. Secrets are never returned.</p>
 <div className="stack"><p className="help">After saving your Stripe API key, this action creates a new webhook at the public Wealtharr URL and stores the signing secret encrypted. If a webhook already exists, it will not create a duplicate or replace its secret automatically.</p><button type="button" className="button" disabled={setupBusy} onClick={connectStripe}>{setupBusy?"Registering…":"Create and connect Stripe webhook"}</button>{setupMessage&&<p role="status" className="help">{setupMessage}</p>}</div>
 {(["STRIPE","EMAIL","MARKET_DATA","MARKET_DATA_HISTORY","TELEGRAM"] as const).map(service=><div key={service} style={{marginTop:12}}>
  <div className="why-row"><span>{service==="MARKET_DATA_HISTORY"?"Historical adjusted prices":service==="MARKET_DATA"?"Current market prices":service==="EMAIL"?"Email":service==="TELEGRAM"?"Telegram":"Stripe"}</span><button className="button" type="button" disabled={Boolean(busy)} onClick={()=>run(service)}>{busy===service?"Testing…":service==="TELEGRAM"?"Verify bot & register webhook":"Test connection"}</button></div>
  {(service==="MARKET_DATA"||service==="MARKET_DATA_HISTORY")&&<div className="field"><label htmlFor={"test-symbol-"+service}>Provider symbol</label>
    <input id={"test-symbol-"+service} value={symbol} onChange={e=>setSymbol(e.target.value)} maxLength={32}/></div>}
  {service==="MARKET_DATA_HISTORY"&&<div className="form-grid">
    <div className="field"><label htmlFor="test-history-date">Historical trading day</label>
      <input id="test-history-date" type="date" value={historyDate} onChange={e=>setHistoryDate(e.target.value)}/></div>
    <div className="field"><label htmlFor="test-history-currency">Expected currency</label>
      <input id="test-history-currency" value={historyCurrency} maxLength={3}
        onChange={e=>setHistoryCurrency(e.target.value.toUpperCase())}/></div>
    <p className="help">Choose a real past trading day for the symbol (no date is preselected). Passing checks the returned bar format only, not data licensing or complete history.</p>
  </div>}
  {results[service]&&<p role="status" className="help">{results[service]}</p>}
 </div>)}
 </section>;
}
