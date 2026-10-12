"use client";

import { useMemo, useState } from "react";
import { calculateLandingDemo, LANDING_DEMO_STRATEGIES } from "@/domain/landing-demo";

const money = (amount: number) => new Intl.NumberFormat("en-GB", {
  style: "currency", currency: "GBP", maximumFractionDigits: 0
}).format(amount);

export function LandingInteractiveDemo() {
  const [strategyKey, setStrategyKey] = useState("all-weather");
  const [contribution, setContribution] = useState(500);
  const strategy = LANDING_DEMO_STRATEGIES.find(item => item.key === strategyKey) ?? LANDING_DEMO_STRATEGIES[0];
  const example = useMemo(
    () => calculateLandingDemo(strategy.allocations, contribution),
    [strategy, contribution]
  );

  return <section className="landing-section landing-live-demo landing-wrap" id="demo">
    <div className="landing-demo-intro">
      <div>
        <span className="landing-kicker">A little clarity goes a long way</span>
        <h2 className="landing-title">Understand your next move. <em>Before you make it.</em></h2>
        <p>Try a fictional portfolio. Switch methodologies, inspect allocation drift and explore how adding cash might change the balance. No account required.</p>
        <div className="landing-demo-choices" role="group" aria-label="Choose a fictional example">
          {LANDING_DEMO_STRATEGIES.map(item =>
            <button key={item.key} type="button" aria-pressed={item.key === strategyKey}
              onClick={() => setStrategyKey(item.key)}>{item.name}</button>)}
        </div>
        <div className="landing-demo-input">
          <div className="landing-demo-slider-label"><label htmlFor="demo-contribution">Hypothetical new contribution</label><strong>{money(contribution)}</strong></div>
          <input id="demo-contribution" type="range" min={0} max={1000} step={100} value={contribution}
            onChange={event => setContribution(Number(event.target.value))}
            aria-valuetext={money(contribution)}/>
          <div className="landing-demo-range"><span>£0</span><span>£1,000</span></div>
        </div>
        <p className="landing-demo-disclosure">For illustration only. Values are fictitious, not market data, advice, executable trades or a claim that any example is enabled on your plan.</p>
      </div>
      <div className="landing-demo-card">
        <div className="landing-demo-card-head">
          <div><span>INTERACTIVE EXAMPLE / {strategy.category}</span><h3>{strategy.name}</h3></div>
          <span className="landing-example-pill">SIMULATED</span>
        </div>
        <div className="landing-demo-stats">
          <div><span>Before drift</span><strong>{example.beforeDrift.toFixed(1)}<small> pp</small></strong></div>
          <div><span>After cash-only example</span><strong>{example.afterDrift.toFixed(1)}<small> pp</small></strong></div>
          <div><span>Example total</span><strong>{money(10_000 + contribution)}</strong></div>
        </div>
        <div className="landing-demo-bars-heading">
          <span>Allocation</span><span>Current → after cash / target</span>
        </div>
        <div className="landing-demo-bars">
          {example.rows.map(row => <div className="landing-demo-asset" key={row.name}>
            <div className="landing-demo-asset-top"><span>{row.name}</span><span>
              {row.current.toFixed(0)}% <b aria-hidden="true">→</b> {row.afterPercent.toFixed(1)}% <small>/ {row.target}% target</small>
            </span></div>
            <div className="landing-demo-bar" role="img"
              aria-label={row.name + ": " + row.current.toFixed(0) + " percent before; " + row.afterPercent.toFixed(1) + " percent after; " + row.target + " percent target"}>
              <span className="landing-demo-bar-current" style={{width:row.current + "%"}}/>
              <span className="landing-demo-bar-after" style={{width:row.afterPercent + "%"}}/>
              <span className="landing-demo-bar-target" style={{left:row.target + "%"}}/>
            </div>
            {contribution > 0 && row.contributionAllocated >= 1 &&
              <div className="landing-demo-cash">Example cash directed here: {money(row.contributionAllocated)}</div>}
          </div>)}
        </div>
        <div className="landing-demo-result">
          <span className="landing-demo-result-icon" aria-hidden="true">↗</span>
          <div><strong>Turn drift into a clear review.</strong>
            <p>In this simplified illustration, new cash is distributed across underweight holdings before considering any sales. Real strategy rules and account constraints govern actual calculations.</p>
          </div>
        </div>
        <p className="landing-demo-card-foot">{strategy.note} · Hypothetical starting value £10,000; no transaction costs or price movements.</p>
      </div>
    </div>
  </section>;
}
