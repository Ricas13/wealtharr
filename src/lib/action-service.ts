import "server-only";
import crypto from "node:crypto";
import Decimal from "decimal.js";
import { sql } from "@/lib/db";
import { assertLedgerEvent, foldLedger } from "@/domain/ledger";
import { getStrategyEngine } from "@/domain/strategy/registry";
import { exposureLeverage, resolveMapping, type MappingCandidate } from "@/domain/instruments";
import { assertExecutionCurrencyMatch, normalizeExecutionConstraints, planPracticalTrade, validateExecution } from "@/domain/execution";
import { nextReviewDueAt } from "@/domain/schedule";
import { classifyFreshness } from "@/domain/market-freshness";
import { parseInputSchema, validateInstanceSettings } from "@/domain/strategy/config";
import { actionRecalculationDisposition, type ActionStatus } from "@/domain/actions";
import { actionFingerprintMaterial } from "@/domain/action-fingerprint";
import { validatedEffectivePrice } from "@/domain/manual-override";
import { loadTrustedHistory } from "@/lib/trusted-history-loader";
import { assessStrategyMarket, StrategyMarketUnavailableError } from "@/domain/strategy/market-eligibility";
import { VERIFIED_MARKET_MAPPINGS_SQL, verifiedCandidates } from "@/lib/verified-market-mappings";
import { nextCalendarQuarterDueAt } from "@/domain/schedule";
import { buildStrategyAlert } from "@/domain/strategy-alert";
import { validatedFillTime } from "@/domain/execution-time";
import { postActionReviewState } from "@/domain/strategy/review-completion";
import { assessLinkedMarkets } from "@/domain/strategy/linked-market-eligibility";

function isoDate(value: unknown) { return value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10); }
type CalculationScenario={
  cashDelta?:Decimal.Value;
  contributionDelta?:Decimal.Value;
  executionConstraints?:Record<string,unknown>;
  forceReview?:boolean;
  versionOverride?:{
    strategyDefinitionId?:string;
    strategyVersionId:string;
    effectiveFrom:string;
    engineKey:string;
    config:Record<string,unknown>;
    settings:Record<string,unknown>;
  };
  stateOverride?:Record<string,unknown>;
  resetTimeline?:boolean;
};

async function buildActionCalculation(strategyInstanceId:string,scenario?:CalculationScenario){
  const rows=await sql.unsafe("SELECT i.id,i.user_id,i.account_id,i.strategy_definition_id,i.strategy_version_id,i.started_at,i.onboarding_mode,i.last_reconciled_at,v.effective_from AS version_effective_from,v.engine_key AS engine,v.config,i.settings,i.execution_constraints,a.name AS primary_account_name,a.country,a.wrapper,a.currency,a.broker_name,s.state,u.timezone AS user_timezone FROM strategy_instances i JOIN strategy_definitions d ON d.id=i.strategy_definition_id JOIN strategy_versions v ON v.id=i.strategy_version_id JOIN accounts a ON a.id=i.account_id JOIN users u ON u.id=i.user_id JOIN strategy_states s ON s.strategy_instance_id=i.id WHERE i.id=$1 AND i.status='ACTIVE' LIMIT 1",[strategyInstanceId]);
  const instance=rows[0];if(!instance)throw new Error("STRATEGY_INSTANCE_NOT_FOUND");
  const linkedAccounts=await sql.unsafe(
    "SELECT a.id,a.name,a.country,a.wrapper,a.currency,a.broker_name,sa.role FROM strategy_accounts sa JOIN accounts a ON a.id=sa.account_id WHERE sa.strategy_instance_id=$1 ORDER BY CASE WHEN sa.role='PRIMARY' THEN 0 ELSE 1 END,a.created_at,a.name",
    [strategyInstanceId]
  );
  const accounts:Array<{id:unknown;name:unknown;country:unknown;wrapper:unknown;currency:unknown;broker_name:unknown;role:string}> = linkedAccounts.length
    ? linkedAccounts.map((account)=>({
        id:account.id,
        name:account.name,
        country:account.country,
        wrapper:account.wrapper,
        currency:account.currency,
        broker_name:account.broker_name,
        role:String(account.role)
      }))
    : [{id:instance.account_id,name:instance.primary_account_name,country:instance.country,wrapper:instance.wrapper,currency:instance.currency,broker_name:instance.broker_name,role:"PRIMARY"}];
  const baseCurrency=String(instance.currency).toUpperCase();
  const accountCurrencies=new Set(accounts.map((account)=>String(account.currency).toUpperCase()));
  const primaryAccountId=String(instance.account_id);
  const ledgerRows=await sql.unsafe("SELECT account_id,event_type,currency,cash_amount,fee_amount,instrument_id,quantity,occurred_at,created_at FROM ledger_events WHERE strategy_instance_id=$1 ORDER BY occurred_at,created_at",[strategyInstanceId]);
  const asLedgerEvent=(r:any)=>({eventType:String(r.event_type),currency:String(r.currency),cashAmount:String(r.cash_amount),feeAmount:String(r.fee_amount),instrumentId:r.instrument_id?String(r.instrument_id):null,quantity:String(r.quantity)});
  const folded=foldLedger(ledgerRows.map(asLedgerEvent),baseCurrency);
  const accountPositions=new Map<string,ReturnType<typeof foldLedger>>();
  for(const account of accounts){
    const accountId=String(account.id);
    const ownRows=ledgerRows.filter((row)=>row.account_id?String(row.account_id)===accountId:accountId===primaryAccountId);
    accountPositions.set(accountId,foldLedger(ownRows.map(asLedgerEvent),String(account.currency)));
  }
  const effectiveCash=folded.cash.plus(new Decimal(scenario?.cashDelta??0));
  const calculationDefinitionId=scenario?.versionOverride?.strategyDefinitionId??String(instance.strategy_definition_id);
  const calculationVersionId=scenario?.versionOverride?.strategyVersionId??String(instance.strategy_version_id);
  const calculationEngineKey=scenario?.versionOverride?.engineKey??String(instance.engine);
  const calculationEffectiveFrom=scenario?.versionOverride?.effectiveFrom??isoDate(instance.version_effective_from);
  const config=scenario?.versionOverride?.config??((instance.config??{}) as Record<string,unknown>);
  const settings=scenario?.versionOverride?.settings??((instance.settings??{}) as Record<string,unknown>);
  const state={...(scenario?.stateOverride??((instance.state??{}) as Record<string,unknown>))};
  if(scenario?.forceReview)state.forceReview=true;
  const requiredRelease=await sql.unsafe(
    "SELECT id,version FROM strategy_versions WHERE strategy_definition_id=$1 AND lifecycle_status='PUBLISHED' AND upgrade_policy='REQUIRED' AND effective_from>$2 AND effective_from<=current_date AND (effective_to IS NULL OR effective_to>=current_date) ORDER BY effective_from DESC,published_at DESC NULLS LAST LIMIT 1",
    [calculationDefinitionId,calculationEffectiveFrom]
  );
  if(calculationDefinitionId===String(instance.strategy_definition_id)){
    const targetOverride=await sql.unsafe("SELECT manual_value FROM overrides WHERE strategy_instance_id=$1 AND field_key='strategy_state.targetValue' AND active=true ORDER BY created_at DESC LIMIT 1",[strategyInstanceId]);
    if(targetOverride[0]?.manual_value!=null){
      const candidate=new Decimal(String(targetOverride[0].manual_value));
      if(!candidate.isFinite()||candidate.lt(0)||candidate.gt("999999999999"))throw new Error("INVALID_TARGET_OVERRIDE");
      state.targetValue=candidate.toString();
    }
  }

  const exposurePositions:Array<{economicExposure:string;value:Decimal;tradingLineId?:string;accountId:string;accountName:string}>=[];
  const foreignCash=[...folded.cashByCurrency.entries()].filter(([currency,value])=>currency!==baseCurrency&&!value.eq(0));
  let dataStatus:"CURRENT"|"STALE"|"MISSING"=state.resumeNeedsReconciliation||state.unresolvedReconciliation?"MISSING":"CURRENT";
  let dataMessage=state.resumeNeedsReconciliation?"Quick resume needs an opening holdings snapshot before a high-confidence action can be calculated.":state.unresolvedReconciliation?"An unresolved broker discrepancy must be classified before financial actions resume.":undefined;
  if(accountCurrencies.size!==1||!accountCurrencies.has(baseCurrency)){dataStatus="MISSING";dataMessage="Linked accounts use different currencies. Explicit FX support is required before this strategy can calculate a trade.";}
  if(foreignCash.length){dataStatus="MISSING";dataMessage="Foreign-currency cash is present. An explicit FX conversion is required before financial actions can resume.";}
  if(requiredRelease[0]){dataStatus="MISSING";dataMessage="Strategy version "+String(requiredRelease[0].version)+" is a required rules update. Update this strategy before new financial actions are calculated.";}
  if(effectiveCash.lt(0)){dataStatus="MISSING";dataMessage="This scenario needs more cash than is currently available. Reduce the withdrawal or sell investments first.";}

  for(const account of accounts){
    const accountId=String(account.id);
    const accountName=String(account.name);
    const accountCurrency=String(account.currency).toUpperCase();
    const position=accountPositions.get(accountId);
    if(!position)continue;
    for(const [instrumentId,quantity] of position.quantities.entries()){
      if(quantity.eq(0))continue;
      const market=await sql.unsafe(
        "SELECT i.economic_exposure,q.price,q.observed_at,q.observation_currency,q.trading_currency,q.trading_line_id "+
        "FROM instruments i LEFT JOIN LATERAL ("+
        " SELECT tl.id AS trading_line_id,tl.currency AS trading_currency,o.price,o.observed_at,o.currency AS observation_currency"+
        " FROM trading_lines tl LEFT JOIN LATERAL (SELECT price,observed_at,currency FROM market_data_observations m WHERE m.trading_line_id=tl.id ORDER BY observed_at DESC LIMIT 1) o ON true"+
        " WHERE tl.instrument_id=i.id AND upper(tl.currency)=upper($2) AND tl.effective_from<=current_date AND (tl.effective_to IS NULL OR tl.effective_to>=current_date)"+
        " ORDER BY o.observed_at DESC NULLS LAST,tl.id LIMIT 1"+
        ") q ON true WHERE i.id=$1 LIMIT 1",
        [instrumentId,accountCurrency]
      );
      const m=market[0];
      const priceOverride=await sql.unsafe("SELECT manual_value,observed_at FROM overrides WHERE strategy_instance_id=$1 AND field_key=$2 AND active=true AND expires_at>now() ORDER BY created_at DESC LIMIT 1",[strategyInstanceId,"market_price:"+instrumentId]);
      const priceCurrency=String(m?.observation_currency??m?.trading_currency??"").toUpperCase();
      if(priceCurrency&&priceCurrency!==accountCurrency){
        dataStatus="MISSING";
        dataMessage="FX conversion is required for a held instrument; actions are suppressed until an explicit FX source is configured.";
        continue;
      }
      const manualPrice=priceOverride[0]?.manual_value==null?null:validatedEffectivePrice(priceOverride[0].manual_value);
      if(manualPrice){
        if(!m?.economic_exposure||!m?.trading_line_id){dataStatus="MISSING";dataMessage="A valid trading line is required for a manually priced holding.";continue;}
        exposurePositions.push({economicExposure:String(m.economic_exposure),value:quantity.mul(manualPrice),tradingLineId:String(m.trading_line_id),accountId,accountName});
        continue;
      }
      if(!m?.price){dataStatus="MISSING";dataMessage="A held instrument has no current market price in "+accountName+".";continue;}
      const observedAt=new Date(m.observed_at);
      if(classifyFreshness(observedAt)!=="CURRENT"&&dataStatus!=="MISSING"){dataStatus="STALE";dataMessage="Market data is stale or invalid; financial actions are suppressed until data is current and verified.";}
      exposurePositions.push({economicExposure:String(m.economic_exposure),value:quantity.mul(new Decimal(String(m.price))),tradingLineId:m.trading_line_id?String(m.trading_line_id):undefined,accountId,accountName});
    }
  }

  const aggregatedExposureMap=new Map<string,Decimal>();
  for(const position of exposurePositions){
    aggregatedExposureMap.set(
      position.economicExposure,
      (aggregatedExposureMap.get(position.economicExposure)??new Decimal(0)).plus(position.value)
    );
  }
  const engineExposures=[...aggregatedExposureMap.entries()].map(([economicExposure,value])=>({economicExposure,value}));

  const frequency=String(config.reviewFrequency??"QUARTERLY");
  const lastReview=scenario?.resetTimeline?new Date():state.lastReviewAt?new Date(String(state.lastReviewAt)):new Date(instance.started_at);
  const reviewTimezone=String(config.reviewTimezone??instance.user_timezone??"UTC");
  const holidayDates=Array.isArray(config.marketHolidays)?config.marketHolidays.filter((v):v is string=>typeof v==="string"):[];
  const convention: "PREVIOUS"|"NEXT"=config.businessDayConvention==="NEXT"?"NEXT":"PREVIOUS";
  const scheduleInput={
    lastReviewAt:lastReview,
    timeZone:reviewTimezone,
    cutoffLocal:String(config.reviewCutoffLocal??"16:00"),
    holidays:holidayDates,
    convention
  };
  const dueAt=config.reviewSchedule==="CALENDAR_QUARTER_END"
    ?nextCalendarQuarterDueAt(scheduleInput)
    :nextReviewDueAt({...scheduleInput,frequency});
  const reviewDue=Boolean(state.forceReview)||new Date()>=dueAt;
  const contributionRows=scenario?.resetTimeline
    ?[{amount:"0"}]
    :await sql.unsafe("SELECT COALESCE(sum(l.cash_amount),0) AS amount FROM ledger_events l WHERE l.strategy_instance_id=$1 AND l.event_type='CONTRIBUTION' AND l.occurred_at>$2 AND NOT EXISTS (SELECT 1 FROM ledger_events c WHERE c.correction_of_event_id=l.id)",[strategyInstanceId,lastReview]);
  const contributionsSinceReview=new Decimal(String(contributionRows[0]?.amount??0)).plus(new Decimal(scenario?.contributionDelta??0));
  const engine=getStrategyEngine(calculationEngineKey);
  const fullyEligibleAccountIds=new Set<string>();
  // Do not start a partial implementation. The next leg alone may map (e.g. SPY3 in a
  // UK ISA), while another mandatory leg has no faithful equivalent (TMF duration).
  // Only complete verified implementations are eligible for action instructions.
  if(dataStatus==="CURRENT"){
    const candidateMappings=verifiedCandidates(await sql.unsafe(VERIFIED_MARKET_MAPPINGS_SQL));
    const market=assessLinkedMarkets(calculationEngineKey,config,candidateMappings,
      accounts.map(account=>({
        country:String(account.country),wrapper:String(account.wrapper),
        currency:String(account.currency),broker:account.broker_name?String(account.broker_name):null
      })),new Date().toISOString().slice(0,10));
    for(const accountIndex of market.eligibleAccountIndices)
      fullyEligibleAccountIds.add(String(accounts[accountIndex].id));
    if(!market.available){
      dataStatus="MISSING";
      dataMessage="This strategy cannot be implemented in your linked accounts with the currently verified trading lines. "+
        "Missing or ambiguous exposures: "+market.missingExposures.join(", ")+". "+
        (market.supportedMarkets.length?"Verified markets: "+market.supportedMarkets.join(", ")+".":
          "No fully verified market implementation is available yet.");
    }
  }
  // Momentum research engines read licensed price history; every other engine ignores it.
  const momentumUniverse=calculationEngineKey==="MOMENTUM_ROTATION"&&Array.isArray(config.riskAssets)&&typeof config.defensiveAsset==="string"
    ?[...(config.riskAssets as unknown[]).map(String),String(config.defensiveAsset)]:null;
  const trustedHistory=momentumUniverse?await loadTrustedHistory(momentumUniverse,String(instance.currency),Number(config.lookbackMonths)||12):undefined;
  let proposal=engine.calculate({strategyInstanceId,trustedHistory,strategyVersionId:calculationVersionId,now:new Date(),baseCurrency:String(instance.currency),cash:effectiveCash,exposures:engineExposures,contributionsSinceReview,state,config,settings,reviewDue,nextReviewAt:dueAt,dataHealth:{status:dataStatus,message:dataMessage}});

  let tradingLineId:string|null=null;
  let executionTicker:string|null=null;
  let executionAccountId:string|null=null;
  if(proposal.economicExposure&&["BUY","SELL","REBALANCE"].includes(proposal.actionType)){
    if(proposal.actionType==="SELL"){
      const heldExposure=[...exposurePositions]
        .filter((p)=>p.economicExposure===proposal.economicExposure&&p.tradingLineId&&fullyEligibleAccountIds.has(p.accountId))
        .sort((a,b)=>b.value.cmp(a.value))[0];
      if(heldExposure?.tradingLineId){
        tradingLineId=heldExposure.tradingLineId;
        executionAccountId=heldExposure.accountId;
      }
    }

    if(!tradingLineId){
      const leverage=exposureLeverage(proposal.economicExposure,proposal.leverage);
      const rankedAccounts=accounts
        .filter(account=>fullyEligibleAccountIds.has(String(account.id)))
        .map((account)=>{
          const accountId=String(account.id);
          const position=accountPositions.get(accountId);
          const scenarioDelta=scenario?.cashDelta&&accountId===primaryAccountId?new Decimal(scenario.cashDelta):new Decimal(0);
          return {account,cash:(position?.cash??new Decimal(0)).plus(scenarioDelta)};
        })
        .sort((a,b)=>b.cash.cmp(a.cash));

      let mappedAccount:typeof accounts[number]|null=null;
      for(const candidateAccount of rankedAccounts){
        const account=candidateAccount.account;
        const mappingRows=await sql.unsafe(
          "SELECT m.id,m.economic_exposure,m.leverage,m.direction,m.country,m.wrapper,m.broker,m.preferred_currency,m.fidelity,m.effective_from,m.effective_to,m.trading_line_id,tl.currency AS trading_line_currency,tl.effective_from AS trading_line_effective_from,tl.effective_to AS trading_line_effective_to FROM regional_instrument_mappings m JOIN trading_lines tl ON tl.id=m.trading_line_id JOIN instruments i ON i.id=tl.instrument_id AND i.economic_exposure=m.economic_exposure AND i.leverage=m.leverage AND i.direction=m.direction WHERE m.economic_exposure=$1 AND m.country=$2 AND m.wrapper=$3 AND m.enabled=true AND m.fidelity='EXACT'",
          [proposal.economicExposure,String(account.country),String(account.wrapper)]
        );
        const candidates:MappingCandidate[]=mappingRows.map((r)=>({
          id:String(r.id),economicExposure:String(r.economic_exposure),leverage:String(r.leverage),direction:String(r.direction),
          country:String(r.country),wrapper:String(r.wrapper),broker:r.broker?String(r.broker):null,
          preferredCurrency:r.preferred_currency?String(r.preferred_currency):null,fidelity:String(r.fidelity),
          effectiveFrom:isoDate(r.effective_from),effectiveTo:r.effective_to?isoDate(r.effective_to):null,
          tradingLineId:String(r.trading_line_id),tradingLineCurrency:String(r.trading_line_currency),
          tradingLineEffectiveFrom:isoDate(r.trading_line_effective_from),
          tradingLineEffectiveTo:r.trading_line_effective_to?isoDate(r.trading_line_effective_to):null
        }));
        const mapping=resolveMapping(candidates,{
          economicExposure:proposal.economicExposure,leverage,direction:"LONG",
          country:String(account.country),wrapper:String(account.wrapper),
          broker:account.broker_name?String(account.broker_name):null,
          preferredCurrency:String(account.currency),asOf:new Date().toISOString().slice(0,10)
        });
        if(mapping){
          mappedAccount=account;
          executionAccountId=String(account.id);
          tradingLineId=mapping.tradingLineId;
          break;
        }
      }

      if(!tradingLineId){
        proposal={
          actionType:"DATA_REQUIRED",
          title:"This implementation is not supported yet",
          instruction:"None of the linked accounts has an approved instrument mapping for the exposure this strategy needs.",
          explanation:[...proposal.explanation,{label:"Required exposure",value:proposal.economicExposure}],
          nextState:state,confidence:"LOW",dueAt:proposal.dueAt
        };
      }else if(mappedAccount){
        proposal={
          ...proposal,
          explanation:[
            ...proposal.explanation,
            {label:"Execution account",value:String(mappedAccount.name),kind:"text"}
          ]
        };
      }
    }

    if(tradingLineId&&["BUY","SELL"].includes(proposal.actionType)&&proposal.amount){
      const quoteRows=await sql.unsafe(
        "SELECT tl.ticker,tl.instrument_id,tl.currency,o.price,o.observed_at,o.currency AS observation_currency FROM trading_lines tl LEFT JOIN LATERAL (SELECT price,observed_at,currency FROM market_data_observations m WHERE m.trading_line_id=tl.id ORDER BY observed_at DESC LIMIT 1) o ON true WHERE tl.id=$1 LIMIT 1",
        [tradingLineId]
      );
      const quote=quoteRows[0];
      executionTicker=quote?.ticker?String(quote.ticker):null;
      const executionOverride=quote?.instrument_id
        ?await sql.unsafe(
          "SELECT manual_value,observed_at FROM overrides WHERE strategy_instance_id=$1 AND field_key=$2 AND active=true AND expires_at>now() ORDER BY created_at DESC LIMIT 1",
          [strategyInstanceId,"market_price:"+String(quote.instrument_id)]
        ):[]; 
      const chosenOverride=executionOverride[0];
      const effectivePrice=chosenOverride?.manual_value!=null
        ?validatedEffectivePrice(chosenOverride.manual_value)
        :quote?.price!=null?validatedEffectivePrice(String(quote.price)):null;
      const priceObservedAt=chosenOverride?.observed_at??quote?.observed_at;
      if(!effectivePrice){
        proposal={actionType:"DATA_REQUIRED",title:"Price needed before you trade",instruction:"A current price is not available for the instrument this strategy would use.",explanation:proposal.explanation,nextState:state,confidence:"LOW",dueAt:proposal.dueAt};
      }else if(String(quote.observation_currency??quote.currency)!==String(instance.currency)){
        proposal={actionType:"DATA_REQUIRED",title:"FX data needed",instruction:"The selected trading line is not priced in your account currency, so we will not estimate an order without an explicit FX conversion.",explanation:proposal.explanation,nextState:state,confidence:"LOW",dueAt:proposal.dueAt};
      }else if(!priceObservedAt||!Number.isFinite(new Date(priceObservedAt).getTime())||
        (Date.now()-new Date(priceObservedAt).getTime())/3600000>36||
        new Date(priceObservedAt).getTime()>Date.now()+60_000){
        proposal={actionType:"DATA_REQUIRED",title:"Price is out of date",instruction:"Refresh market data before using this trade instruction.",explanation:proposal.explanation,nextState:state,confidence:"LOW",dueAt:proposal.dueAt};
      }else{
        const selectedPosition=accountPositions.get(String(executionAccountId));
        const selectedCash=(selectedPosition?.cash??new Decimal(0)).plus(
          scenario?.cashDelta&&String(executionAccountId)===primaryAccountId?new Decimal(scenario.cashDelta):0
        );
        const heldQuantity=quote.instrument_id?(selectedPosition?.quantities.get(String(quote.instrument_id))??new Decimal(0)):new Decimal(0);
        const practical=planPracticalTrade({
          side:proposal.actionType as "BUY"|"SELL",
          proposedAmount:proposal.amount,
          price:effectivePrice.toString(),
          availableCash:selectedCash,
          heldQuantity,
          constraints:scenario?.executionConstraints??((instance.execution_constraints??{}) as Record<string,unknown>)
        });
        if(practical.status==="BLOCKED"){
          const messages={
            SELLING_DISABLED:"Selling is disabled in your trade preferences. Change that preference or add new money before the strategy can proceed.",
            INSUFFICIENT_SPENDABLE_CASH:"Your cash buffer and estimated fee leave no spendable cash for this action.",
            BELOW_ONE_SHARE:"This action is smaller than one whole share and your broker is set to whole shares only.",
            BELOW_MINIMUM_TRADE:"This action is below your minimum trade size.",
            NO_HOLDINGS:"The strategy wants to reduce this exposure, but no matching holding is recorded."
          } as const;
          proposal={actionType:"DATA_REQUIRED",title:"Trade does not fit your preferences",instruction:messages[practical.reason],explanation:[...proposal.explanation,{label:"Execution constraint",value:practical.reason.replaceAll("_"," ")}],nextState:state,confidence:"HIGH",dueAt:proposal.dueAt};
        }else{
          const quantityText=practical.quantity.toDecimalPlaces(6,Decimal.ROUND_DOWN).toString();
          const amountText=practical.amount.toDecimalPlaces(2,Decimal.ROUND_HALF_EVEN).toFixed(2);
          proposal={
            ...proposal,
            amount:practical.amount,
            completesReview:practical.constrained?false:proposal.completesReview,
            title:(proposal.actionType==="BUY"?"Buy ":"Sell ")+(executionTicker??"the selected instrument"),
            instruction:(proposal.actionType==="BUY"?"Buy ":"Sell ")+quantityText+" "+(executionTicker??"units")+" for about "+amountText+" "+String(instance.currency)+".",
            explanation:[
              ...proposal.explanation,
              {label:"Practical order",value:quantityText+" "+(executionTicker??"units"),kind:"text"},
              {label:"Estimated trade value",value:amountText,kind:"money"},
              ...(practical.estimatedFee.gt(0)?[{label:"Estimated fee",value:practical.estimatedFee.toFixed(2),kind:"money" as const}]:[]),
              ...(practical.note?[{label:"Adjustment",value:practical.note,kind:"text" as const}]:[]),
              {label:"Price used for order sizing",value:effectivePrice.toString()+" "+String(quote.currency)+(chosenOverride?" (user corrected)":" (market observation)"),kind:"text" as const}
            ]
          };
        }
      }
    }
  }

  const stableHoldings=accounts.flatMap((account)=>{
    const accountId=String(account.id);
    const position=accountPositions.get(accountId);
    if(!position)return [] as string[];
    return [...position.quantities.entries()]
      .filter(([,quantity])=>!quantity.eq(0))
      .map(([instrumentId,quantity])=>accountId+":"+instrumentId+":"+quantity.toString());
  }).sort().join(",");
  const material=actionFingerprintMaterial({
    strategyInstanceId,
    strategyVersionId:calculationVersionId,
    lastReviewIso:lastReview.toISOString(),
    actionType:proposal.actionType,
    currency:proposal.currency??"",
    economicExposure:proposal.economicExposure??"",
    leverage:proposal.leverage??"",
    tradingLineId:tradingLineId??"",
    executionAccountId:executionAccountId??"",
    effectiveCash:effectiveCash.toString(),
    contributionsSinceReview:contributionsSinceReview.toString(),
    stableHoldings,
    dataStatus,
    materialRevision:JSON.stringify({amount:proposal.amount?.toDecimalPlaces(2,Decimal.ROUND_HALF_EVEN).toString()??null,instruction:proposal.instruction,explanation:proposal.actionType==="NO_ACTION"?null:proposal.explanation})
  });
  const fingerprint=crypto.createHash("sha256").update(material).digest("hex");
  // Deliver one generic reminder per strategy review cycle and alert class,
  // while the newest calculated action and its precise quantities can change.
  const notificationClass=proposal.actionType==="DATA_REQUIRED"?"DATA_REQUIRED":"REVIEW";
  const reviewKey=crypto.createHash("sha256")
    .update(strategyInstanceId+"|"+lastReview.toISOString()+"|"+notificationClass).digest("hex");
  // An estimated BUY/SELL is never proof that target weights were achieved.
  // Keep this cycle due until the broker's real fills and fees are recorded and
  // the engine recalculates. A HOLD acknowledgement can then close the review.
  const nextState=postActionReviewState(proposal,state,new Date());
  const totalValue=exposurePositions.reduce((sum,p)=>sum.plus(p.value),effectiveCash);
  return {instance,proposal,totalValue,dataStatus,fingerprint,reviewKey,nextState,tradingLineId,executionAccountId,executionTicker};
}

export async function previewCashScenario(
  userId:string,
  strategyInstanceId:string,
  input:{type:"CONTRIBUTION"|"WITHDRAWAL";amount:Decimal.Value}
){
  const owner=await sql.unsafe("SELECT id FROM strategy_instances WHERE id=$1 AND user_id=$2 LIMIT 1",[strategyInstanceId,userId]);
  if(!owner[0])throw new Error("STRATEGY_INSTANCE_NOT_FOUND");
  const amount=new Decimal(input.amount);
  if(!amount.isFinite()||amount.lte(0))throw new Error("INVALID_PREVIEW_AMOUNT");
  const contribution=input.type==="CONTRIBUTION"?amount:new Decimal(0);
  const calculation=await buildActionCalculation(strategyInstanceId,{
    cashDelta:input.type==="CONTRIBUTION"?amount:amount.neg(),
    contributionDelta:contribution
  });
  return {
    scenario:{type:input.type,amount:amount.toString(),currency:String(calculation.instance.currency)},
    portfolioValueAfter:calculation.totalValue.toString(),
    action:{
      actionType:calculation.proposal.actionType,
      title:calculation.proposal.title,
      instruction:calculation.proposal.instruction,
      amount:calculation.proposal.amount?.toString()??null,
      currency:calculation.proposal.currency??null,
      confidence:calculation.proposal.confidence,
      explanation:calculation.proposal.explanation
    }
  };
}

export async function previewStrategySwitchScenario(
  userId:string,
  strategyInstanceId:string,
  targetStrategyKey:string,
  suppliedSettings:Record<string,unknown>|undefined,
  allowedStrategyKeys:Set<string>|null
){
  const targets=await sql.unsafe(
    "SELECT d.id AS definition_id,d.key,d.name,d.supported_regions,d.supported_wrappers,v.id AS version_id,v.version,v.effective_from,v.engine_key,v.config,v.input_schema "+
    "FROM strategy_definitions d JOIN LATERAL ("+
    " SELECT * FROM strategy_versions v WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED' "+
    " AND v.effective_from<=current_date AND (v.effective_to IS NULL OR v.effective_to>=current_date) "+
    " ORDER BY v.effective_from DESC,v.published_at DESC NULLS LAST LIMIT 1"+
    ") v ON true WHERE d.key=$1 AND d.enabled=true LIMIT 1",
    [targetStrategyKey]
  );
  const target=targets[0];
  if(!target)throw new Error("STRATEGY_NOT_AVAILABLE");
  if(allowedStrategyKeys&&!allowedStrategyKeys.has(String(target.key)))throw new Error("STRATEGY_NOT_IN_PLAN");

  const ownership=await sql.unsafe(
    "SELECT i.strategy_definition_id FROM strategy_instances i WHERE i.id=$1 AND i.user_id=$2 AND i.status<>'CLOSED' LIMIT 1",
    [strategyInstanceId,userId]
  );
  if(!ownership[0])throw new Error("STRATEGY_INSTANCE_NOT_FOUND");
  if(String(ownership[0].strategy_definition_id)===String(target.definition_id))throw new Error("STRATEGY_ALREADY_SELECTED");

  const linkedAccounts=await sql.unsafe(
    "SELECT a.country,a.wrapper,a.currency,a.broker_name FROM strategy_accounts sa JOIN accounts a ON a.id=sa.account_id WHERE sa.strategy_instance_id=$1 ORDER BY sa.created_at",
    [strategyInstanceId]
  );
  const regions=Array.isArray(target.supported_regions)?target.supported_regions.map(String):[];
  const wrappers=Array.isArray(target.supported_wrappers)?target.supported_wrappers.map(String):[];
  for(const account of linkedAccounts){
    if(regions.length&&!regions.includes(String(account.country)))throw new Error("STRATEGY_NOT_SUPPORTED_IN_REGION");
    if(wrappers.length&&!wrappers.includes(String(account.wrapper)))throw new Error("STRATEGY_NOT_SUPPORTED_FOR_WRAPPER");
  }

  const candidates=verifiedCandidates(await sql.unsafe(VERIFIED_MARKET_MAPPINGS_SQL));
  for(const account of linkedAccounts){
    const choice={country:String(account.country),wrapper:String(account.wrapper),currency:String(account.currency).toUpperCase(),broker:account.broker_name?String(account.broker_name):null};
    const market=assessStrategyMarket(String(target.engine_key),(target.config??{}) as Record<string,unknown>,candidates,choice,new Date().toISOString().slice(0,10));
    if(!market.available)throw new StrategyMarketUnavailableError(market,choice);
  }
  const engine=getStrategyEngine(String(target.engine_key));
  const config=(target.config??{}) as Record<string,unknown>;
  engine.validateConfig(config);
  const settings=validateInstanceSettings(parseInputSchema(target.input_schema),suppliedSettings);

  const calculation=await buildActionCalculation(strategyInstanceId,{
    forceReview:true,
    resetTimeline:true,
    stateOverride:{forceReview:true},
    versionOverride:{
      strategyDefinitionId:String(target.definition_id),
      strategyVersionId:String(target.version_id),
      effectiveFrom:isoDate(target.effective_from),
      engineKey:String(target.engine_key),
      config,
      settings
    }
  });

  return {
    preview:true,
    scenario:{
      type:"STRATEGY_SWITCH" as const,
      currency:String(calculation.instance.currency),
      targetStrategy:{key:String(target.key),name:String(target.name),version:String(target.version)}
    },
    portfolioValueAfter:calculation.totalValue.toString(),
    action:{
      actionType:calculation.proposal.actionType,
      title:calculation.proposal.title,
      instruction:calculation.proposal.instruction,
      amount:calculation.proposal.amount?.toString()??null,
      currency:calculation.proposal.currency??null,
      confidence:calculation.proposal.confidence,
      explanation:calculation.proposal.explanation
    }
  };
}

export async function previewStrategyVersionScenario(
  userId:string,
  strategyInstanceId:string,
  targetVersionId:string,
  suppliedSettings?:Record<string,unknown>
){
  const rows=await sql.unsafe(
    "SELECT i.strategy_definition_id,i.strategy_version_id,i.settings,cv.engine_key AS current_engine,tv.id AS target_version_id,tv.version AS target_version,tv.effective_from,tv.engine_key,tv.config,tv.input_schema "+
    "FROM strategy_instances i JOIN strategy_versions cv ON cv.id=i.strategy_version_id JOIN strategy_versions tv ON tv.id=$3 "+
    "WHERE i.id=$1 AND i.user_id=$2 AND tv.strategy_definition_id=i.strategy_definition_id AND tv.lifecycle_status='PUBLISHED' "+
    "AND tv.effective_from<=current_date AND (tv.effective_to IS NULL OR tv.effective_to>=current_date) LIMIT 1",
    [strategyInstanceId,userId,targetVersionId]
  );
  const target=rows[0];
  if(!target)throw new Error("INVALID_TARGET_VERSION");
  if(String(target.engine_key)!==String(target.current_engine))throw new Error("ENGINE_MIGRATION_NOT_SUPPORTED");

  const engine=getStrategyEngine(String(target.engine_key));
  const config=(target.config??{}) as Record<string,unknown>;
  engine.validateConfig(config);
  const mergedSettings={...((target.settings??{}) as Record<string,unknown>),...(suppliedSettings??{})};
  const settings=validateInstanceSettings(parseInputSchema(target.input_schema),mergedSettings);

  const calculation=await buildActionCalculation(strategyInstanceId,{
    forceReview:true,
    versionOverride:{
      strategyVersionId:String(target.target_version_id),
      effectiveFrom:isoDate(target.effective_from),
      engineKey:String(target.engine_key),
      config,
      settings
    }
  });

  return {
    preview:true,
    targetVersion:String(target.target_version),
    action:{
      actionType:calculation.proposal.actionType,
      title:calculation.proposal.title,
      instruction:calculation.proposal.instruction,
      amount:calculation.proposal.amount?.toString()??null,
      currency:calculation.proposal.currency??null,
      confidence:calculation.proposal.confidence,
      explanation:calculation.proposal.explanation
    }
  };
}

export async function previewExecutionConstraintsScenario(
  userId:string,
  strategyInstanceId:string,
  executionConstraints:Record<string,unknown>
){
  const owner=await sql.unsafe("SELECT id FROM strategy_instances WHERE id=$1 AND user_id=$2 LIMIT 1",[strategyInstanceId,userId]);
  if(!owner[0])throw new Error("STRATEGY_INSTANCE_NOT_FOUND");
  const normalized=normalizeExecutionConstraints(executionConstraints);
  const calculation=await buildActionCalculation(strategyInstanceId,{executionConstraints:{
    fractionalShares:normalized.fractionalShares,
    minimumTradeAmount:normalized.minimumTradeAmount.toString(),
    cashBufferAmount:normalized.cashBufferAmount.toString(),
    flatFee:normalized.flatFee.toString(),
    allowSelling:normalized.allowSelling
  }});
  return {
    scenario:{
      type:"EXECUTION_CONSTRAINTS" as const,
      currency:String(calculation.instance.currency),
      constraints:{
        fractionalShares:normalized.fractionalShares,
        minimumTradeAmount:normalized.minimumTradeAmount.toString(),
        cashBufferAmount:normalized.cashBufferAmount.toString(),
        flatFee:normalized.flatFee.toString(),
        allowSelling:normalized.allowSelling
      }
    },
    portfolioValueAfter:calculation.totalValue.toString(),
    action:{
      actionType:calculation.proposal.actionType,
      title:calculation.proposal.title,
      instruction:calculation.proposal.instruction,
      amount:calculation.proposal.amount?.toString()??null,
      currency:calculation.proposal.currency??null,
      confidence:calculation.proposal.confidence,
      explanation:calculation.proposal.explanation
    }
  };
}

export const STALE_ACTION_DISPLAY={
  action_type:"DATA_REQUIRED",title:"Refresh this review",
  instruction:"Your holdings, prices or strategy settings have changed. Recalculate to see the current instruction.",
  amount:null,confidence:"LOW",explanation:[]
};

/** Read-only validation for dashboard instructions. Never show an old order as current. */
export async function isStoredActionCurrent(strategyInstanceId:string,actionId:string){
  try{
    const rows=await sql.unsafe(
      "SELECT a.fingerprint FROM actions a WHERE a.id=$1 AND a.strategy_instance_id=$2 "+
      "AND a.status IN ('CALCULATED','NOTIFIED','ACKNOWLEDGED') "+
      "AND NOT EXISTS (SELECT 1 FROM ledger_events l WHERE l.strategy_instance_id=$2 AND l.created_at>a.calculated_at)",
      [actionId,strategyInstanceId]
    );
    if(!rows[0])return false;
    return (await buildActionCalculation(strategyInstanceId)).fingerprint===String(rows[0].fingerprint);
  }catch{return false;}
}

export async function calculateAction(strategyInstanceId:string){
  return sql.begin(async(tx)=>{
    // Match the lock order used by financial mutations: strategy row first, then
    // the calculation mutex. This prevents ledger/reconciliation changes from
    // committing while a calculation is reading and persisting its action.
    const locked=await tx.unsafe("SELECT id FROM strategy_instances WHERE id=$1 FOR UPDATE",[strategyInstanceId]);
    if(!locked[0])throw new Error("STRATEGY_INSTANCE_NOT_FOUND");
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[strategyInstanceId]);

    const calculation=await buildActionCalculation(strategyInstanceId);
    const {instance,proposal,totalValue,dataStatus,fingerprint,reviewKey,nextState,tradingLineId,executionAccountId,executionTicker}=calculation;
    if(dataStatus==="CURRENT")await tx.unsafe("INSERT INTO performance_series (strategy_instance_id,series_type,date,value,metadata) VALUES ($1,'USER_VALUE',current_date,$2,$3::jsonb) ON CONFLICT (strategy_instance_id,series_type,date) DO UPDATE SET value=EXCLUDED.value,metadata=EXCLUDED.metadata",[strategyInstanceId,totalValue.toString(),JSON.stringify({source:"ledger+market"})]);
    const existing=await tx.unsafe(
      "SELECT id,status FROM actions WHERE strategy_instance_id=$1 AND fingerprint=$2 FOR UPDATE",
      [strategyInstanceId,fingerprint]
    );
    let actionId:string;
    let shouldNotify=false;
    if(existing[0]){
      actionId=String(existing[0].id);
      const previousStatus=String(existing[0].status) as ActionStatus;
      const disposition=actionRecalculationDisposition(previousStatus);
      await tx.unsafe(
        "UPDATE actions SET account_id=$1,strategy_version_id=$2,action_type=$3,status=$4,title=$5,instruction=$6,amount=$7,currency=$8,trading_line_id=$9,explanation=$10::jsonb,next_state=$11::jsonb,confidence=$12,due_at=$13,"+
        "acknowledged_at=CASE WHEN $4='CALCULATED' THEN NULL ELSE acknowledged_at END,"+
        "cancelled_at=CASE WHEN $4='CALCULATED' THEN NULL ELSE cancelled_at END,"+
        "superseded_by_action_id=CASE WHEN $4='CALCULATED' THEN NULL ELSE superseded_by_action_id END,calculated_at=clock_timestamp(),updated_at=now() WHERE id=$14",
        [executionAccountId,instance.strategy_version_id,proposal.actionType,disposition.status,proposal.title,proposal.instruction,proposal.amount?.toString()??null,proposal.currency??null,tradingLineId,JSON.stringify(proposal.explanation),JSON.stringify(nextState),proposal.confidence,proposal.dueAt??null,actionId]
      );
      shouldNotify=disposition.shouldNotify;
    }else{
      const inserted=await tx.unsafe(
        "INSERT INTO actions (strategy_instance_id,account_id,strategy_version_id,fingerprint,action_type,status,title,instruction,amount,currency,trading_line_id,explanation,next_state,confidence,due_at) VALUES ($1,$2,$3,$4,$5,'CALCULATED',$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14) RETURNING id",
        [strategyInstanceId,executionAccountId,instance.strategy_version_id,fingerprint,proposal.actionType,proposal.title,proposal.instruction,proposal.amount?.toString()??null,proposal.currency??null,tradingLineId,JSON.stringify(proposal.explanation),JSON.stringify(nextState),proposal.confidence,proposal.dueAt??null]
      );
      actionId=String(inserted[0].id);
      shouldNotify=true;
    }
    await tx.unsafe("UPDATE actions SET status='SUPERSEDED',superseded_by_action_id=$1,updated_at=now() WHERE strategy_instance_id=$2 AND id<>$1 AND status IN ('CALCULATED','NOTIFIED','ACKNOWLEDGED') AND action_type<>'NO_ACTION'",[actionId,strategyInstanceId]);
    const healthy=dataStatus==="CURRENT"&&proposal.actionType!=="DATA_REQUIRED";
    await tx.unsafe("UPDATE strategy_instances SET health_status=$1,updated_at=now() WHERE id=$2",[healthy?"HEALTHY":"NEEDS_ATTENTION",strategyInstanceId]);
    if(shouldNotify&&proposal.actionType!=="NO_ACTION"){
      // Keep the *alert* stable, not an obsolete execution quantity. An
      // in-flight or delivered alert always points to the latest revision.
      const message=buildStrategyAlert({
        actionType:proposal.actionType,
        amount:proposal.amount?.toString()??null,
        currency:proposal.currency??null,
        ticker:executionTicker??proposal.economicExposure??null,
        calculatedAt:new Date(),
        brand:process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"
      });
      const noticeTitle=message.title;
      const noticeBody=message.body;
      await tx.unsafe(
        "INSERT INTO notifications (user_id,action_id,type,title,body,review_key) "+
        "VALUES ($1,$2,'ACTION',$3,$4,$5) "+
        "ON CONFLICT (review_key) WHERE review_key IS NOT NULL "+
        "DO UPDATE SET action_id=EXCLUDED.action_id,title=EXCLUDED.title,body=EXCLUDED.body",
        [instance.user_id,actionId,noticeTitle,noticeBody,reviewKey]
      );
    }
    return {actionId,proposal,totalValue:totalValue.toString()};
  });
}

export async function recalculateAfterMutation(
  strategyInstanceId:string,
  actorUserId?:string|null,
  source="financial-mutation"
){
  try{
    const calculated=await calculateAction(strategyInstanceId);
    return {actionId:calculated.actionId,recalculationPending:false,errorCode:null as string|null};
  }catch(error){
    const errorCode=error instanceof Error?error.message:"ACTION_RECALCULATION_FAILED";
    try{
      await sql.begin(async(tx)=>{
        await tx.unsafe(
          "UPDATE strategy_instances SET health_status='NEEDS_ATTENTION',updated_at=now() WHERE id=$1",
          [strategyInstanceId]
        );
        await tx.unsafe(
          "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'strategy.recalculation-failed','strategy_instance',$2,$3::jsonb)",
          [actorUserId??null,strategyInstanceId,JSON.stringify({source,errorCode})]
        );
      });
    }catch{
      // The original financial mutation has already succeeded. Do not mask that success
      // if only the secondary health/audit write also fails.
    }
    return {actionId:null,recalculationPending:true,errorCode};
  }
}

export async function executeAction(
  userId:string,
  actionId:string,
  execution?:{price?:string;quantity?:string;fee?:string;partial?:boolean;executedAt?:string}
){
  const result=await sql.begin(async(tx)=>{
    const ownership=await tx.unsafe(
      "SELECT a.strategy_instance_id FROM actions a JOIN strategy_instances i ON i.id=a.strategy_instance_id WHERE a.id=$1 AND i.user_id=$2 LIMIT 1",
      [actionId,userId]
    );
    if(!ownership[0])throw new Error("ACTION_NOT_FOUND");

    // Keep lock ordering consistent with pause/close flows: strategy first, then action.
    const strategyRows=await tx.unsafe(
      "SELECT i.id,i.status,i.execution_constraints FROM strategy_instances i WHERE i.id=$1 AND i.user_id=$2 FOR UPDATE OF i",
      [ownership[0].strategy_instance_id,userId]
    );
    const strategy=strategyRows[0];
    if(!strategy)throw new Error("ACTION_NOT_FOUND");
    if(String(strategy.status)!=="ACTIVE")throw new Error("STRATEGY_NOT_ACTIVE");

    const actionRows=await tx.unsafe(
      "SELECT a.*,tl.instrument_id,acc.currency AS account_currency FROM actions a LEFT JOIN trading_lines tl ON tl.id=a.trading_line_id LEFT JOIN accounts acc ON acc.id=a.account_id WHERE a.id=$1 AND a.strategy_instance_id=$2 FOR UPDATE OF a",
      [actionId,strategy.id]
    );
    const action=actionRows[0];
    if(!action)throw new Error("ACTION_NOT_FOUND");
    if(!["CALCULATED","NOTIFIED","ACKNOWLEDGED"].includes(String(action.status)))throw new Error("ACTION_NOT_EXECUTABLE");

    // A deposit, withdrawal, corrected trade or imported fill can invalidate an old
    // instruction if asynchronous recalculation failed. Never let an executable
    // action outlive the financial ledger snapshot it was calculated against.
    const newerLedger=await tx.unsafe(
      "SELECT id FROM ledger_events WHERE strategy_instance_id=$1 AND created_at>(SELECT calculated_at FROM actions WHERE id=$2) ORDER BY created_at DESC LIMIT 1",
      [strategy.id,actionId]
    );
    if(newerLedger[0])throw new Error("ACTION_STALE_LEDGER_MUTATION");

    const actionType=String(action.action_type);
    if(["DATA_REQUIRED","NO_ACTION"].includes(actionType))throw new Error("ACTION_NOT_EXECUTABLE");
    if(actionType==="REBALANCE")throw new Error("REBALANCE_TRADES_REQUIRED");

    // The ledger guard alone does not catch expired quotes, withdrawn mappings
    // or changed settings. Rebuild under the same strategy lock before a fill
    // or HOLD can advance the review. Already-completed broker fills can still
    // be recorded through the historical import/reconciliation path.
    const current=await buildActionCalculation(String(strategy.id));
    if(current.fingerprint!==String(action.fingerprint))throw new Error("ACTION_STALE_INPUTS");

    let partial=false;
    let actualNotional:string|null=null;

    if(["BUY","SELL"].includes(actionType)){
      if(!execution?.price||!execution?.quantity||!action.instrument_id||!action.amount)throw new Error("EXECUTION_DETAILS_REQUIRED");
      if(!action.account_id)throw new Error("EXECUTION_CURRENCY_MISMATCH");
      const executionCurrency=assertExecutionCurrencyMatch(action.currency,action.account_currency);

      const ledgerRows=await tx.unsafe(
        "SELECT event_type,currency,cash_amount,fee_amount,instrument_id,quantity FROM ledger_events WHERE strategy_instance_id=$1 AND account_id=$2 ORDER BY occurred_at,created_at",
        [action.strategy_instance_id,action.account_id]
      );
      const position=foldLedger(ledgerRows.map((r)=>({
        eventType:String(r.event_type),
        currency:String(r.currency),
        cashAmount:String(r.cash_amount),
        feeAmount:String(r.fee_amount),
        instrumentId:r.instrument_id?String(r.instrument_id):null,
        quantity:String(r.quantity)
})),String(action.account_currency));
      const ledgerTime=await tx.unsafe(
        "SELECT max(occurred_at) AS latest_at FROM ledger_events WHERE strategy_instance_id=$1",
        [action.strategy_instance_id]
      );
      const brokerExecutedAt=validatedFillTime(
        execution.executedAt, new Date(action.created_at),
        ledgerTime[0]?.latest_at?new Date(ledgerTime[0].latest_at):null
      );
      const held=position.quantities.get(String(action.instrument_id))??new Decimal(0);
      const constraints=normalizeExecutionConstraints(strategy.execution_constraints);
      if(actionType==="SELL"&&!constraints.allowSelling)throw new Error("SELLING_DISABLED");
      if(!constraints.fractionalShares&&!new Decimal(execution.quantity).isInteger())throw new Error("FRACTIONAL_SHARES_DISABLED");
      const spendableCash=Decimal.max(position.cash.minus(constraints.cashBufferAmount),0);
      const validated=validateExecution({
        side:actionType as "BUY"|"SELL",
        proposedAmount:String(action.amount),
        price:execution.price,
        quantity:execution.quantity,
        fee:execution.fee??"0",
        availableCash:spendableCash,
        heldQuantity:held,
        allowPartial:Boolean(execution.partial)
      });
      if(!constraints.fractionalShares&&!validated.quantity.isInteger())throw new Error("FRACTIONAL_SHARES_DISABLED");
      if(validated.grossNotional.lt(constraints.minimumTradeAmount))throw new Error("BELOW_MINIMUM_TRADE");

      // Backstop: the signs and fee rules of a trade row are enforced right at the write.
      assertLedgerEvent({eventType:actionType,cashAmount:validated.cashAmount,feeAmount:validated.fee,instrumentId:String(action.instrument_id),quantity:validated.ledgerQuantity});
      const inserted=await tx.unsafe(
        "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,unit_price,fee_amount,provenance,confidence,metadata) VALUES ($1,$2,$11,$3,$4,$5,$6,$7,$8,$9,'USER_ENTERED','VERIFIED',$10::jsonb) RETURNING id",
        [
          action.strategy_instance_id,
          action.account_id,
          actionType,
          executionCurrency,
          validated.cashAmount.toString(),
          action.instrument_id,
          validated.ledgerQuantity.toString(),
          execution.price,
          validated.fee.toString(),
          JSON.stringify({
            actionId,
            proposedAmount:String(action.amount),
            actualNotional:validated.grossNotional.toString(),
            partial:Boolean(execution.partial),
            executedAt:brokerExecutedAt.toISOString()
          }),
          brokerExecutedAt.toISOString()
        
        ]
      );
      actualNotional=validated.grossNotional.toString();
      const remainder=new Decimal(String(action.amount)).minus(validated.grossNotional);
      partial=Boolean(execution.partial)&&remainder.gt(new Decimal(String(action.amount)).mul("0.000001"));

      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,$2,'action',$3,$4::jsonb)",
        [
          userId,
          partial?"action.partially-executed":"action.executed",
          actionId,
          JSON.stringify({ledgerEventId:String(inserted[0].id),actualNotional,quantity:validated.quantity.toString(),fee:validated.fee.toString(),executedAt:brokerExecutedAt.toISOString()})
        ]
      );
    }

    if(partial){
      // Even a partial fill must lock the review's original target before the
      // post-fill recalculation. Otherwise 9Sig grows it again on the next trade.
      await tx.unsafe(
        "UPDATE strategy_states SET state=$1::jsonb,calculated_at=now(),confidence=$2 WHERE strategy_instance_id=$3",
        [JSON.stringify(action.next_state??{}),action.confidence,action.strategy_instance_id]
      );
      await tx.unsafe(
        "UPDATE actions SET status='PARTIALLY_EXECUTED',executed_at=now(),updated_at=now() WHERE id=$1",
        [actionId]
      );
    }else{
      await tx.unsafe(
        "UPDATE strategy_states SET state=$1::jsonb,calculated_at=now(),confidence=$2 WHERE strategy_instance_id=$3",
        [JSON.stringify(action.next_state??{}),action.confidence,action.strategy_instance_id]
      );
      await tx.unsafe(
        "UPDATE actions SET status='EXECUTED',executed_at=now(),updated_at=now() WHERE id=$1",
        [actionId]
      );
      if(!["BUY","SELL"].includes(actionType)){
        await tx.unsafe(
          "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'action.executed','action',$2,$3::jsonb)",
          [userId,actionId,JSON.stringify({actionType})]
        );
      }
    }

    return {strategyInstanceId:String(action.strategy_instance_id),partial,actualNotional};
  });
  const recalc=await recalculateAfterMutation(result.strategyInstanceId,userId,"action-execution");
  return {...result,actionId:recalc.actionId,recalculationPending:recalc.recalculationPending};
}

