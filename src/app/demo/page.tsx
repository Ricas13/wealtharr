import Link from "next/link";
import { PerformanceChart } from "@/components/PerformanceChart";

const demo=Array.from({length:24},(_,i)=>({date:new Date(Date.UTC(2024,i,1)).toISOString().slice(0,10),actual:10000+i*610+Math.sin(i/2)*700,model:10000+i*650,benchmark:10000+i*430}));

export default function DemoPage(){
  return <main><div className="container"><nav className="public-nav"><Link href="/" className="brand"><span className="brand-mark"/>{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</Link><div className="pill warn">Fictional demo data</div></nav>
  <div className="page-title"><div><div className="eyebrow">Demo workspace</div><h1>9Sig — Example ISA</h1><p>Nothing on this page belongs to a real person or account.</p></div><Link className="button primary" href="/register">Start with your own data</Link></div>
  <div className="metrics"><div className="glass metric"><small>Tracked value</small><strong>£31,816</strong></div><div className="glass metric"><small>Contributions</small><strong>£24,500</strong></div><div className="glass metric"><small>Gain / loss</small><strong>+£7,316</strong></div><div className="glass metric"><small>Health</small><strong>Healthy</strong></div></div>
  <div className="detail-grid"><section className="glass action-card"><div className="pill warn">NEXT ACTION</div><h2>Buy £1,184 target exposure</h2><p>Under the fictional strategy rules selected for this demo, the quarterly value target is above the current strategy value.</p><div className="why"><div className="why-row"><span>Current strategy value</span><b>£31,816</b></div><div className="why-row"><span>Quarterly target</span><b>£33,000</b></div><div className="why-row"><span>New contribution</span><b>£500</b></div><div className="why-row"><span>Calculated adjustment</span><b>£1,184</b></div></div></section>
  <section className="glass form-card"><div className="pill good">Strategy health</div><h3>Healthy</h3><p>Data current ✓<br/>Last reconciliation: 3 days ago ✓<br/>No unresolved transactions ✓<br/>Next review: 1 Jan ✓</p></section></div>
  <section className="glass chart-card"><div className="section-head"><div><h2>Performance</h2><p>Actual implementation vs model vs benchmark.</p></div></div><PerformanceChart data={demo} pinnedAppearance/></section>
  <section className="section"><div className="cards"><div className="card"><h3>Contribution</h3><p>£500 · monthly · 14:00<br/><span className="pill">Auto-filled</span></p></div><div className="card"><h3>Reconciliation</h3><p>Expected £31,816<br/>Broker £31,791<br/>Difference −£25 · FX cost</p></div><div className="card"><h3>History</h3><p>Every source event, calculation and correction remains auditable.</p></div></div></section>
  </div></main>;
}
