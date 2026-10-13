"use client";
import { Field } from "@/components/Field";
import {Trading212CsvAssistant} from "@/components/Trading212CsvAssistant";
import type {Trading212CsvTrade} from "@/domain/brokerage/trading212-csv";
import {useRef,useState} from "react";
import {useRouter} from "next/navigation";

type Account={id:string;name:string;currency:string;wrapper:string};
export function BrokerTradeForm({strategyId,accounts}:{strategyId:string;accounts:Account[]}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [side,setSide]=useState<"BUY"|"SELL">("BUY");
  const [unitPrice,setUnitPrice]=useState("");
  const [ticker,setTicker]=useState("");
  const [quantity,setQuantity]=useState("");
  const [exchange,setExchange]=useState("");
  const [executedAt,setExecutedAt]=useState("");
  const [note,setNote]=useState("");
  const [quoteNotice,setQuoteNotice]=useState("");
  const [selectedBrokerTrade,setSelectedBrokerTrade]=useState<Trading212CsvTrade|null>(null);
  const [externalAccountRef,setExternalAccountRef]=useState("");
  const [brokerLinkConsent,setBrokerLinkConsent]=useState(false);
  const key=useRef<string|null>(null);
  if(!accounts.length)return null;
  return <><Trading212CsvAssistant onSelect={trade=>{
    setSelectedBrokerTrade(trade);setBrokerLinkConsent(false);
    setSide(trade.side);
    setTicker(trade.ticker);
    setQuantity(trade.quantity);
    setUnitPrice(trade.price);
    // The broker CSV often omits exchange and timezone. Never guess either.
    setExchange("");setExecutedAt("");
    setNote("Trading 212 CSV transaction "+trade.id+" · ISIN "+trade.isin);
  }}/><form className="glass form-card" onSubmit={async(event)=>{
    event.preventDefault();
    setBusy(true);setMessage("");
    const form=event.currentTarget;
    const data=new FormData(form);
    const requestKey=key.current??crypto.randomUUID();
    key.current=requestKey;
    try{
      // The selected ID is evidence for this precise trade, not a blanket permission to
      // allocate everything with the same ticker. Editing the fill requires re-selection.
      if(selectedBrokerTrade){
        const sameTrade=selectedBrokerTrade.side===side&&
          selectedBrokerTrade.ticker.toUpperCase()===String(data.get("ticker")).trim().toUpperCase()&&
          selectedBrokerTrade.quantity===String(data.get("quantity"))&&
          selectedBrokerTrade.price===String(data.get("unitPrice"));
        if(!sameTrade)throw new Error("The fill differs from the selected CSV row. Clear the broker link or reselect that exact trade.");
        if(!externalAccountRef.trim()||!brokerLinkConsent)throw new Error("Enter the broker account reference and confirm this exact trade belongs to your strategy.");
      }
      const response=await fetch("/api/strategies/"+strategyId+"/trades",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({
          accountId:String(data.get("accountId")),ticker:String(data.get("ticker")).trim().toUpperCase(),
          exchange:String(data.get("exchange")).trim().toUpperCase(),
          executedAt:String(data.get("executedAt")).trim(),side,
          quantity:String(data.get("quantity")),unitPrice:String(data.get("unitPrice")),
          fee:String(data.get("fee")||"0"),note:String(data.get("note")||""),
          brokerFillConfirmed:Boolean(data.get("confirmed")),requestKey,
          brokerTrade:selectedBrokerTrade?{
            provider:"TRADING212",externalAccountRef:externalAccountRef.trim(),
            externalTradeId:selectedBrokerTrade.id,consent:brokerLinkConsent
          }:undefined
        })
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||"Trade not recorded.");
      key.current=null;
      setMessage(result.recalculationPending
        ?"Broker fill recorded. Recalculation needs attention."
        :result.duplicate?"This broker fill was already recorded.":"Broker fill recorded in your ledger.");
      form.reset();
      setUnitPrice("");setTicker("");setQuantity("");setExchange("");setExecutedAt("");setNote("");
      setQuoteNotice("");
      setSelectedBrokerTrade(null);setExternalAccountRef("");setBrokerLinkConsent(false);
      router.refresh();
    }catch(error){
      setMessage(error instanceof Error?error.message:"Connection interrupted; retry without changing the form.");
    }finally{setBusy(false);}
  }}>
    <h3>Record a broker trade</h3>
    <p className="help">For past purchases or sales, use the price and quantity on your actual broker confirmation, not the market-price estimate above. A trade will only be accepted if its historical cash and holdings balance. Add the corresponding dated contribution first if necessary.</p>
    <div className="form-grid">
      <Field label="Account"><select name="accountId" required>{accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></Field>
      <Field label="Trade type"><select value={side} onChange={e=>setSide(e.target.value as "BUY"|"SELL")}><option value="BUY">Buy</option><option value="SELL">Sell</option></select></Field>
      <Field label="Ticker"><input name="ticker" placeholder="TQQQ" maxLength={24} value={ticker} onChange={e=>setTicker(e.target.value)} required/></Field>
      <Field label="Exchange"><input name="exchange" placeholder="NASDAQ or LSE" maxLength={24} value={exchange} onChange={e=>setExchange(e.target.value)} required/></Field>
      <Field className="field full" label="Actual execution time with timezone offset"><input name="executedAt" placeholder="2026-11-02T14:00:00-05:00" value={executedAt} onChange={e=>setExecutedAt(e.target.value)} required/></Field>
      <Field label="Executed quantity"><input name="quantity" inputMode="decimal" placeholder="5" value={quantity} onChange={e=>setQuantity(e.target.value)} required/></Field>
      <Field label="Broker fill price per unit"><input name="unitPrice" inputMode="decimal" placeholder="100.12" value={unitPrice} onChange={event=>setUnitPrice(event.target.value)} required/></Field>
      <div className="field full">
        <button type="button" className="button" onClick={async event=>{
          setQuoteNotice("Looking up an indicative reference…");
          const form=event.currentTarget.closest("form");
          if(!form)return;
          const input=new FormData(form);
          try{
            const response=await fetch("/api/market/historical",{
              method:"POST",headers:{"content-type":"application/json"},
              body:JSON.stringify({
                accountId:String(input.get("accountId")),
                ticker:String(input.get("ticker")).trim().toUpperCase(),
                exchange:String(input.get("exchange")).trim().toUpperCase(),
                executedAt:String(input.get("executedAt")).trim()
              })
            });
            const quote=await response.json().catch(()=>({}));
            if(!response.ok)throw new Error(quote.error||"No historical quote is available.");
            setUnitPrice(String(quote.price));
            setQuoteNotice("Indicative "+String(quote.granularity)+" "+String(quote.priceKind)+" from "+String(quote.source)+
              " at "+String(quote.observedAt)+". This is NOT an executed broker fill. Confirm and correct from your broker.");
          }catch(error){
            setQuoteNotice(error instanceof Error?error.message:"No reference quote is available. Enter the broker fill manually.");
          }
        }}>Look up indicative price</button>
        {quoteNotice&&<p className="help" role="status">{quoteNotice}</p>}
      </div>
      {selectedBrokerTrade&&<div className="field full">
        <p className="help">Link selected Trading 212 transaction <strong>{selectedBrokerTrade.id}</strong> to this strategy only. A matching ticker alone never claims any shares.</p>
        <label htmlFor="broker-account-ref">Stable Trading 212 account reference (same reference for every export from this broker account)</label>
        <input id="broker-account-ref" autoComplete="off" required minLength={4} maxLength={120}
          pattern="[A-Za-z0-9._:-]+" value={externalAccountRef}
          onChange={event=>setExternalAccountRef(event.target.value)}
          placeholder="Your actual broker account reference"/>
        <label className="toggle-row"><input type="checkbox" checked={brokerLinkConsent}
          onChange={event=>setBrokerLinkConsent(event.target.checked)} required/>
          <span>I confirm this exact transaction belongs to this strategy. The reference I entered identifies the same Trading 212 account across my strategies.</span></label>
        <button type="button" className="button" onClick={()=>{setSelectedBrokerTrade(null);setBrokerLinkConsent(false);}}>Clear broker trade link — record manually</button>
        <p className="help">The account reference is user supplied, not independently verified with Trading 212. No unrelated CSV rows or account positions are uploaded. This does not connect to the broker or authorise trading.</p>
      </div>}
      <Field label="Fee in account currency"><input name="fee" inputMode="decimal" defaultValue="0" required/></Field>
      <Field className="field full" label="Note (optional)"><input name="note" maxLength={240} value={note} onChange={e=>setNote(e.target.value)}/></Field>
      <label className="field full"><input name="confirmed" type="checkbox" required/> I confirm this price, quantity, currency and timestamp came from my broker fill, not an indicative quote.</label>
    </div>
    <button type="submit" disabled={busy} className="button primary">{busy?"Recording…":"Record broker fill"}</button>
    {message&&<p role="status" className={message.includes("recorded")?"success":"attention-message"}>{message}</p>}
  </form></>;
}
