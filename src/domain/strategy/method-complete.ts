import type {StrategyPlugin} from "./catalog/plugin";
import {curatedRelease} from "./catalog";
import {getExposure,isFullyDescribedExposure} from "./exposures";
import {assertCustomerPublishableEngine} from "./registry";

/**
 * Method completeness: is the strategy's *method* finished enough to be offered at all?
 *
 * This is verified code completeness, not human attestation and not market eligibility. A complete
 * method still reaches customers only when an administrator enables it AND a complete EXACT market
 * exists for the customer's account (those gates are separate and unchanged).
 *
 * Checklist (every item must hold):
 *  1. declared:         `releaseStatus === "COMPLETE"` on the plugin (an explicit claim, never inferred)
 *  2. seed-published:   the seed definition inserts a PUBLISHED version "1.0"
 *  3. release-rules:    an executable engine and immutable config, matching the seed definition's engine
 *  4. engine:           the engine is in the customer-publishable set
 *  5. exposures:        every referenced exposure is registered with a full structured descriptor
 *  6. leverage:         a leveraged exposure carries a disclosure
 *  7. spec-card:        a `docs/strategy-specs/<name>.md` path is declared
 *  8. golden-tests:     a `tests/<name>.test.ts` path is declared
 * With file evidence (CI; the production image carries neither docs/ nor tests/):
 *  9. spec-card-file:   the card exists, has the model-definition sections and no VERIFY/DRAFT markers
 * 10. golden-file:      the golden file exists and references the strategy key and asserts values
 *
 * Without file evidence only items 1-8 are evaluated, so the production runtime never reads files.
 * The unit test that feeds real file evidence for every plugin keeps item 9-10 enforced in CI.
 */
export type MethodFileEvidence={
  exists(path:string):boolean;
  read(path:string):string|null;
};
export type MethodCheck={id:string;ok:boolean;detail:string};
export type MethodCompleteness={key:string;complete:boolean;checks:MethodCheck[];failures:string[]};

/** Headings a model spec card must contain (matched as `##`/`###` heading prefixes, case-insensitive). */
export const REQUIRED_SPEC_CARD_HEADINGS=[
  "Definition","Rebalancing rule","Instrument requirements","Owner-decision list","Golden tests"
] as const;

const SPEC_CARD_PATH=/^docs\/strategy-specs\/[a-z0-9-]+\.md$/;
const GOLDEN_PATH=/^tests\/[A-Za-z0-9._-]+\.test\.ts$/;

function headingPresent(markdown:string,heading:string){
  const escaped=heading.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  return new RegExp("^#{2,3}\\s+"+escaped,"im").test(markdown);
}

function referencedExposures(config:Readonly<Record<string,unknown>>|undefined):string[]{
  if(!config)return [];
  const ids:string[]=[];
  if(Array.isArray(config.allocations)){
    for(const row of config.allocations){
      const exposure=(row as {exposure?:unknown})?.exposure;
      ids.push(typeof exposure==="string"?exposure:"");
    }
  }
  if(typeof config.targetExposure==="string")ids.push(config.targetExposure);
  if(typeof config.targetDateExposure==="string")ids.push(config.targetDateExposure);
  if(typeof config.smallCapValueExposure==="string")ids.push(config.smallCapValueExposure);
  if(Array.isArray(config.staticAllocations))for(const row of config.staticAllocations){ids.push(typeof (row as {exposure?:unknown})?.exposure==="string"?(row as {exposure:string}).exposure:"");}
  if(Array.isArray(config.signalUniverse))for(const exposure of config.signalUniverse){ids.push(typeof exposure==="string"?exposure:"");}
  if(typeof config.defensiveAsset==="string")ids.push(config.defensiveAsset);
  return ids;
}

export function evaluateMethodCompleteness(plugin:StrategyPlugin,files?:MethodFileEvidence):MethodCompleteness{
  const checks:MethodCheck[]=[];
  const add=(id:string,ok:boolean,detail:string)=>{checks.push({id,ok,detail});};

  add("declared",plugin.releaseStatus==="COMPLETE",
    plugin.releaseStatus==="COMPLETE"?"declared COMPLETE":"releaseStatus is not COMPLETE");

  const seed=plugin.seedDefinition;
  add("seed-published",seed?.initialVersion==="PUBLISHED",
    seed?.initialVersion==="PUBLISHED"?"seeds a PUBLISHED version":"seed definition does not insert a PUBLISHED version");

  const release=curatedRelease(plugin);
  const executable=Boolean(release&&release.config&&release.engine!=="RESEARCH_PENDING"&&seed&&seed.engine===release.engine);
  add("release-rules",executable,executable?"executable immutable rules present":"no executable rules or engine mismatch");

  let engineOk=false;
  if(release){
    try{assertCustomerPublishableEngine(release.engine);engineOk=true;}catch{engineOk=false;}
  }
  add("engine",engineOk,engineOk?"engine is customer-publishable":"engine is not customer-publishable");

  const ids=referencedExposures(release?.config);
  const undescribed=ids.filter((id)=>!id||!isFullyDescribedExposure(getExposure(id)));
  add("exposures",ids.length>0&&undescribed.length===0,
    ids.length===0?"no exposures referenced":undescribed.length?"not fully described: "+undescribed.join(", "):"all exposures fully described");

  const leveraged=ids.some((id)=>(getExposure(id)?.leverage??1)>1);
  const disclosed=Boolean(release?.disclosure&&release.disclosure.trim());
  add("leverage",!leveraged||disclosed,leveraged&&!disclosed?"leveraged exposure without disclosure":"ok");

  const card=plugin.specCard;
  add("spec-card",card!==null&&SPEC_CARD_PATH.test(card),card?"spec card declared":"no spec card path");
  const golden=plugin.goldenTests;
  add("golden-tests",golden!==null&&GOLDEN_PATH.test(golden),golden?"golden tests declared":"no golden tests path");

  if(files){
    let cardOk=false;
    let cardDetail="spec card file not available";
    if(card&&SPEC_CARD_PATH.test(card)&&files.exists(card)){
      const text=files.read(card)??"";
      const missing=REQUIRED_SPEC_CARD_HEADINGS.filter((h)=>!headingPresent(text,h));
      if(missing.length)cardDetail="spec card lacks sections: "+missing.join(", ");
      else if(/\bVERIFY\b/.test(text)||/NOT SIGNED OFF/i.test(text)||/\bDRAFT\b/.test(text))
        cardDetail="spec card still carries VERIFY/DRAFT/NOT SIGNED OFF markers";
      else{cardOk=true;cardDetail="spec card has the model-definition sections";}
    }
    add("spec-card-file",cardOk,cardDetail);

    let goldenOk=false;
    let goldenDetail="golden test file not available";
    if(golden&&GOLDEN_PATH.test(golden)&&files.exists(golden)){
      const text=files.read(golden)??"";
      const keyed=text.includes('"'+plugin.key+'"')||text.includes("'"+plugin.key+"'");
      if(!keyed)goldenDetail="golden file does not reference the strategy key";
      else if(!/\bexpect\(/.test(text))goldenDetail="golden file asserts nothing";
      else{goldenOk=true;goldenDetail="golden file references the key and asserts values";}
    }
    add("golden-file",goldenOk,goldenDetail);
  }

  const failures=checks.filter((c)=>!c.ok).map((c)=>c.id+": "+c.detail);
  return {key:plugin.key,complete:failures.length===0,checks,failures};
}

export function isMethodComplete(plugin:StrategyPlugin|undefined,files?:MethodFileEvidence):boolean{
  return plugin?evaluateMethodCompleteness(plugin,files).complete:false;
}
