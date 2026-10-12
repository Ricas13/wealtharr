import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path:string) => readFileSync(path,"utf8");
const page=read("src/app/app/page.tsx");
const shell=read("src/components/AppShell.tsx");
const layout=read("src/app/app/layout.tsx");
const css=read("src/app/app/member-workspace.css");

describe("member command-centre contract",()=>{
  it("loads customer-only styling after the previous customer stylesheet",()=>{
    expect(layout).toContain('import "./customer-dashboard.css";\nimport "./member-workspace.css";');
    expect(css).toContain(".customer-workspace-shell");
    expect(css).toContain(".member-action-hero");
    expect(css).not.toMatch(/(^|\n)\s*(body|html|:root)\s*\{/);
    expect(css).toContain('html[data-theme="light"] .customer-workspace-shell');
    expect(css).toContain("@media(max-width:680px)");
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
  });
  it("uses the real ledger, valuations, schedule and action state rather than illustrative numbers",()=>{
    expect(page).toContain("listUserStrategies(user.id)");
    expect(page).toContain("EXECUTABLE_ACTION_STATUS_SQL");
    expect(page).toContain("isStoredActionCurrent");
    expect(page).toContain("loadWorkspaceAnalytics(user.id)");
    expect(page).toContain("growthIndex(combined.valuations,combined.flows)");
    expect(page).toContain('ps.series_type=\'USER_VALUE\'');
    expect(page).toContain("portfolioFullyValued");
    expect(page).toContain("portfolioCurrencyEntries.length===1");
    expect(page).toContain("member-action-hero");
    expect(page).toContain("member-metrics");
    expect(page).toContain("member-focus-grid");
    expect(page).toContain("<PerformanceChart data={overallChart}");
    expect(page).toContain("fullControls");
    expect(page).not.toMatch(/£42,680|£31,420|95\.3%|Alex Morgan|Demo workspace/);
  });
  it("keeps actual destinations, empty states and user-controlled trading",()=>{
    expect(page).toContain('href="/app/strategies/new"');
    expect(page).toContain('href="/app/notifications"');
    expect(page).toContain('href={primaryAction?"/app/strategies/"+primaryAction.strategy_instance_id:"/app/strategies"}');
    expect(page).toContain("if(!strategies.length)");
    expect(page).toContain("You decide whether to trade");
    expect(page).toContain("Missing values are never fabricated");
    expect(shell).toContain('<Link className="nav-link member-queue-nav" href="/app#action-queue">');
    expect(shell).toContain("<WorkspaceNavLink href=\"/app/strategies\">");
    expect(shell).toContain("<ThemeToggle/>");
    expect(shell).toContain('className="skip-link" href="#main-content"');
  });
});
