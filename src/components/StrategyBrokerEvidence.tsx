import {brokerClaimPresentation,type StrategyBrokerClaim} from "@/domain/brokerage/strategy-evidence";

export function StrategyBrokerEvidence({rows,total}:{
 rows:StrategyBrokerClaim[];total:number
}){
 return <section className="drawer-section" aria-labelledby="strategy-broker-evidence-heading">
  <h3 id="strategy-broker-evidence-heading">Linked broker trade evidence</h3>
  <p className="help">Only transactions explicitly assigned to this strategy appear here. These are user-confirmed CSV/ledger links, not an independent live broker connection or automatically verified holdings. Other trades, positions and broker cash are excluded.</p>
  <p className="help">{total} explicitly linked trade{total===1?"":"s"} for this strategy.</p>
  {rows.length?<div className="table-wrap" role="region" tabIndex={0} aria-label="Strategy-only linked broker trades">
   <table><thead><tr>
    <th scope="col">Broker / trade ID</th><th scope="col">Action</th><th scope="col">Quantity</th><th scope="col">Date (UTC)</th>
   </tr></thead><tbody>{rows.map((claim,i)=>{
    const row=brokerClaimPresentation(claim);
    return <tr key={claim.externalTradeId+":"+i}>
     <td>{row.provider}<small style={{display:"block"}}>{row.tradeId}</small></td>
     <td>{row.direction}</td><td>{row.quantity} units</td>
     <td>{row.occurredAt.toLocaleString("en-GB",{timeZone:"UTC"})} UTC</td>
    </tr>;
   })}</tbody></table></div>:<p className="help">No trades from a broker statement have been explicitly linked to this strategy. Manual strategy tracking still works.</p>}
  {total>rows.length&&<p className="help">Showing the {rows.length} newest records only; older links remain in the immutable ledger.</p>}
  <p className="help">Matching broker ticker symbols never automatically attributes a holding to this strategy. Review any quantity discrepancy manually; this panel cannot place trades, edit assignments or modify the ledger.</p>
 </section>;
}
