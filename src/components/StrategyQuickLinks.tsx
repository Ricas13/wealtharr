"use client";
import {ArrowLeftRight,BookOpen,Plus,TrendingUp} from "lucide-react";
const controls=[
  {id:"portfolio-update",label:"Add money / record a trade",help:"Record real cash and broker fills",Icon:Plus},
  {id:"strategy-history",label:"Performance history",help:"Compare returns and cash flows",Icon:TrendingUp},
  {id:"strategy-settings",label:"Strategy rules & settings",help:"Review this version's methodology",Icon:BookOpen}
] as const;
/** Open native disclosures before navigating so quick links never land in hidden content. */
export function StrategyQuickLinks(){
  return <nav className="adaptive-quick-links" aria-label="Strategy shortcuts">
    {controls.map(({id,label,help,Icon})=><button type="button" key={id} onClick={()=>{
      const section=document.getElementById(id);
      if(section instanceof HTMLDetailsElement)section.open=true;
      section?.scrollIntoView({behavior:"smooth",block:"start"});
      section?.focus({preventScroll:true});
    }}><Icon size={18}/><span><strong>{label}</strong><small>{help}</small></span><ArrowLeftRight size={14} aria-hidden="true"/></button>)}
  </nav>;
}
