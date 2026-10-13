"use client";
import {useState} from "react";
import {parseTrading212Csv,type Trading212CsvTrade} from "@/domain/brokerage/trading212-csv";

/**
 * Imported brokerage data stays in the browser and never reaches Wealtharr until the user
 * explicitly selects an individual fill and confirms the existing ledger-entry form.
 * The source export may include unrelated holdings: those are NEVER ingested automatically.
 */
export function Trading212CsvAssistant({onSelect}:{onSelect:(fill:Trading212CsvTrade)=>void}){
  const [trades,setTrades]=useState<Trading212CsvTrade[]>([]);
  const [query,setQuery]=useState("");
  const [message,setMessage]=useState("");
  const visible=trades.filter(t=>(t.ticker+" "+t.isin).toLowerCase().includes(query.toLowerCase())).slice(0,75);
  return <details className="glass form-card">
    <summary>Trading 212 CSV — choose only this strategy&apos;s trades</summary>
    <p className="help">Optional local-only statement preview. Your complete CSV stays in your browser; nothing is uploaded and unrelated holdings are not added to Wealtharr. You must explicitly select each trade, confirm its exchange and timezone, and record the broker fill yourself.</p>
    <label className="field">Trading 212 transaction-history export (.csv)
      <input type="file" accept=".csv,text/csv" onChange={async event=>{
        setTrades([]);setMessage("");setQuery("");
        const file=event.currentTarget.files?.[0];
        if(!file)return;
        try{
          if(file.size>2_500_000)throw new Error("File exceeds the 2.5 MB local preview limit.");
          const rows=parseTrading212Csv(await file.text());
          setTrades(rows);
          setMessage(rows.length+" buy/sell rows parsed locally. Nothing was added to any strategy.");
        }catch(error){setMessage(error instanceof Error?error.message:"Unable to read CSV; no transactions were imported.");}
      }}/>
    </label>
    {message&&<p role="status" className="help">{message}</p>}
    {trades.length>0&&<>
      <label className="field">Find trade by ticker or ISIN
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search within local CSV"/>
      </label>
      <div style={{maxHeight:300,overflowY:"auto"}}>
        {visible.map(t=><div key={t.id} className="why-row">
          <div><strong>{t.side} {t.quantity} {t.ticker}</strong>
            <small style={{display:"block"}}>{t.time} · {t.price} {t.currency} · {t.isin} · ID {t.id}</small></div>
          <button type="button" className="button" aria-label={"Use explicitly selected broker trade "+t.id}
            onClick={()=>{onSelect(t);setMessage("Trade "+t.id+" copied into the confirmation form. Verify exchange, time offset, account and any fees before recording.");}}>
            Use this trade
          </button>
        </div>)}
      </div>
      <p className="help">Showing up to 75 matching rows. A matching ticker alone never assigns shares to your strategy. The CSV time may lack a timezone; confirm the actual ISO timestamp with your broker.</p>
      <button className="button" type="button" onClick={()=>{setTrades([]);setQuery("");setMessage("Local CSV preview cleared.");}}>Clear local preview</button>
    </>}
  </details>;
}
