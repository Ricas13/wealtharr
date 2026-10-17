import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe,expect,it} from "vitest";

const css=readFileSync(join(process.cwd(),"src/app/app/customer-light-palette.css"),"utf8");
const layout=readFileSync(join(process.cwd(),"src/app/app/layout.tsx"),"utf8");
const member=readFileSync(join(process.cwd(),"src/app/app/member-workspace.css"),"utf8");

function hexToken(name:string){
  const selector='html[data-theme="light"] .customer-workspace-shell{';
  const beginning=css.indexOf(selector);
  if(beginning<0)throw new Error("LIGHT_PALETTE_SELECTOR_MISSING");
  const block=css.slice(beginning,css.indexOf("}",beginning));
  const match=block.match(new RegExp("--"+name+"\\s*:\\s*(#[0-9a-f]{6})","i"));
  if(!match)throw new Error("LIGHT_PALETTE_TOKEN_MISSING:"+name);
  return match[1];
}
function luminance(hex:string){
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const linear=rgb.map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  return 0.2126*linear[0]+0.7152*linear[1]+0.0722*linear[2];
}
function contrast(a:string,b:string){
  const sorted=[luminance(a),luminance(b)].sort((x,y)=>y-x);
  return (sorted[0]+0.05)/(sorted[1]+0.05);
}

describe("customer sketch-inspired light palette",()=>{
  it("loads after the member and adaptive styles and does not override the dark tokens",()=>{
    expect(layout.indexOf('import "./customer-light-palette.css";'))
      .toBeGreaterThan(layout.indexOf('import "./adaptive-dashboard.css";'));
    expect(member).toContain("--member-bg:#080d11");
    expect(member).toContain("--member-accent:#b7f5cc");
    const selectors=css.match(/(?:^|\n)(?!\s*\*|\s*\/\/)([^\n{}]*\.customer-workspace-shell[^\n{}]*)\{/g)??[];
    expect(selectors.length).toBeGreaterThan(25);
    expect(selectors.every(rule=>rule.includes('html[data-theme="light"]'))).toBe(true);
  });
  it("provides AA normal-text contrast on white and off-white surfaces",()=>{
    const backgrounds=[hexToken("member-panel"),hexToken("member-bg")];
    for(const name of ["member-text","member-muted","member-subtle","member-blue","member-amber","member-danger","member-accent"]){
      const fg=hexToken(name);
      for(const bg of backgrounds)expect(contrast(fg,bg),name+" on "+bg).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast("#ffffff",hexToken("member-action-blue"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff",hexToken("member-action-blue-hover"))).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps risk, on-track and data-needed badges legible without relying on colour alone",()=>{
    for(const [text,bg] of [["#086749","#e1f7eb"],["#94520d","#fff0db"],["#405a81","#e9f0fc"],["#a31d31","#fee9ed"]]){
      expect(contrast(text,bg),text+" on "+bg).toBeGreaterThanOrEqual(4.5);
    }
    for(const state of ['data-status="DATA_NEEDED"','data-status="AWAITING_CONFIRMATION"','.adaptive-state.good','.adaptive-state.attention','.adaptive-vix-regime.fear']){
      expect(css).toContain(state);
    }
  });
  it("preserves accessible focus states, distinct positive and CTA colours and verified-data chart cues",()=>{
    expect(css).toContain("focus-visible");
    expect(css).toContain("--chart-actual:#109b80");
    expect(css).toContain("--chart-comparison-1:#7e9abf");
    expect(hexToken("member-accent")).not.toBe(hexToken("member-action-blue"));
    expect(css).not.toContain("!important");
  });
});
