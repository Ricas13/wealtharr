/** Local-only Trading 212 CSV transaction preview. Never auto-create ledger rows.
 * Trading 212 changes currency-labelled/optional columns by export period; use header names, not positions.
 */
export type Trading212CsvTrade={id:string;side:"BUY"|"SELL";ticker:string;isin:string;quantity:string;price:string;currency:string;time:string};
/** Parse exported wall-clock timestamps without silently rolling invalid calendar dates.
 * The trade-confirmation form still requires the exchange and timezone.
 */
function validBrokerCsvTime(value:string):boolean{
  const m=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?$/.exec(value);
  if(!m)return false;
  const [y,mo,d,h,mi,sec]=m.slice(1,7).map(Number);
  if(y<2000||mo<1||mo>12||d<1||h>23||mi>59||sec>59)return false;
  const day=new Date(Date.UTC(y,mo-1,d));
  return day.getUTCFullYear()===y&&day.getUTCMonth()===mo-1&&day.getUTCDate()===d;
}
export function parseTrading212Csv(text:string):Trading212CsvTrade[]{
  if(text.length>2_500_000)throw new Error("BROKER_CSV_TOO_LARGE");
  const records:string[][]=[];
  let row:string[]=[],field="",quoted=false;
  const source=text.replace(/^\uFEFF/,"");
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(c==='"'){
      if(quoted&&source[i+1]==='"'){field+='"';i++;}
      else if(!quoted&&field==="")quoted=true;
      else if(quoted)quoted=false;
      else throw new Error("BROKER_CSV_INVALID_QUOTE");
    }else if(quoted)field+=c;
    else if(c===","){row.push(field);field="";}
    else if(c==="\n"){row.push(field.replace(/\r$/,""));records.push(row);row=[];field="";if(records.length>20000)throw new Error("BROKER_CSV_TOO_MANY_ROWS");}
    else field+=c;
  }
  if(quoted)throw new Error("BROKER_CSV_UNCLOSED_QUOTE");
  if(field||row.length){row.push(field.replace(/\r$/,""));records.push(row);}
  if(records.length<2)throw new Error("BROKER_CSV_MISSING_ROWS");
  const head=records[0].map(s=>s.trim().replace(/^\uFEFF/,""));
  const idx=(name:string)=>head.findIndex(h=>h.toLowerCase()===name.toLowerCase());
  const required=["Action","Time","ISIN","Ticker","No. of shares","Price / share","ID"];
  if(required.some(k=>idx(k)<0))throw new Error("BROKER_CSV_UNSUPPORTED_HEADERS");
  const read=(r:string[],key:string)=>r[idx(key)]?.trim()??"";
  const priceCurrency=idx("Currency (Price / share)");
  const seen=new Set<string>();
  const out:Trading212CsvTrade[]=[];
  for(const r of records.slice(1)){
    if(r.length===1&&!r[0])continue;
    if(r.length!==head.length)throw new Error("BROKER_CSV_MALFORMED_ROW");
    const action=read(r,"Action").toLowerCase();
    if(!/^(market|limit|stop) (buy|sell)$/.test(action))continue;
    const side=action.endsWith("buy")?"BUY":"SELL";
    const id=read(r,"ID"),isin=read(r,"ISIN"),ticker=read(r,"Ticker");
    const quantity=read(r,"No. of shares"),price=read(r,"Price / share");
    const time=read(r,"Time"),currency=priceCurrency>=0?r[priceCurrency].trim():"";
    if(!id||id.length>200||!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin.toUpperCase())||!ticker||ticker.length>100||!validBrokerCsvTime(time)||
       (currency!==""&&!/^[A-Za-z]{3}$/.test(currency))||!/^[0-9]+(?:\.[0-9]{1,12})?$/.test(quantity)||
       !/^[0-9]+(?:\.[0-9]{1,10})?$/.test(price)||!Number.isFinite(Number(quantity))||
       Number(quantity)<=0||Number(price)<=0)throw new Error("BROKER_CSV_AMBIGUOUS_TRADE");
    if(seen.has(id))throw new Error("BROKER_CSV_DUPLICATE_ID");
    seen.add(id);
    out.push({id,side,ticker,isin,quantity,price,currency,time});
  }
  return out;
}
