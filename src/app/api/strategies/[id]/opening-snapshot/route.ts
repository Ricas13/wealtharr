import Decimal from "decimal.js";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { getStrategyForUser } from "@/lib/strategy-service";
import { recalculateAfterMutation } from "@/lib/action-service";
import { assertSameOrigin } from "@/lib/security";
import { sql } from "@/lib/db";
import { authFailure } from "@/lib/api-auth";

const decimalString = z.string().regex(/^\d+(?:\.\d{1,12})?$/);
const schema = z.object({
  accountId: z.string().uuid().optional(),
  cash: z.string().regex(/^\d{1,16}(?:\.\d{1,8})?$/).default("0"),
  holdings: z.array(z.object({
    ticker: z.string().min(1).max(40),
    exchange: z.string().min(1).max(80),
    quantity: decimalString
  })).max(30).default([])
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    const strategy = await getStrategyForUser(user.id, id);
    if (!strategy) return Response.json({ error: "Not found." }, { status: 404 });
    if (String(strategy.status) === "CLOSED") return Response.json({ error: "Closed strategies are read-only." }, { status: 409 });
    const input = schema.parse(await request.json());
    const cash = new Decimal(input.cash);
    const holdings = input.holdings.map((h) => ({ ...h, quantityDecimal: new Decimal(h.quantity) }));
    if (cash.lt(0) || !cash.isFinite() || holdings.some((h) => !h.quantityDecimal.isFinite() || h.quantityDecimal.lte(0))) {
      return Response.json({ error: "Opening balances must be finite and non-negative." }, { status: 400 });
    }
    if (cash.eq(0) && holdings.length === 0) {
      return Response.json({ error: "Enter cash, at least one holding, or both." }, { status: 400 });
    }

    const snapshotState=await sql.begin(async (tx) => {
      const locked = await tx.unsafe(
        "SELECT i.id,i.status,i.onboarding_mode,i.account_id AS primary_account_id,a.id AS account_id,a.currency,a.name AS account_name,sa.role "+
        "FROM strategy_instances i JOIN strategy_accounts sa ON sa.strategy_instance_id=i.id JOIN accounts a ON a.id=sa.account_id "+
        "WHERE i.id=$1 AND i.user_id=$2 AND a.id=COALESCE($3::uuid,i.account_id) FOR UPDATE OF i",
        [id,user.id,input.accountId??null]
      );
      if (!locked[0]) throw new Error("STRATEGY_NOT_FOUND");
      if (String(locked[0].status) === "CLOSED") throw new Error("STRATEGY_CLOSED");
      if(String(locked[0].onboarding_mode)!=="RESUME"&&String(locked[0].role)==="PRIMARY"){
        throw new Error("OPENING_SNAPSHOT_NOT_ALLOWED");
      }
      const existing = await tx.unsafe(
        "SELECT count(*)::int AS count FROM ledger_events WHERE strategy_instance_id=$1 AND account_id=$2",
        [id,locked[0].account_id]
      );
      if (Number(existing[0]?.count ?? 0) > 0) throw new Error("OPENING_SNAPSHOT_EXISTS");

      if (cash.gt(0)) {
        await tx.unsafe(
          "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,provenance,confidence,metadata) VALUES ($1,$2,now(),'OPENING_CASH',$3,$4,'USER_CONFIRMED','VERIFIED',$5::jsonb)",
          [id, locked[0].account_id, String(locked[0].currency), cash.toString(), JSON.stringify({ openingSnapshot: true, accountName:String(locked[0].account_name) })]
        );
      }

      const includedInstruments=new Set<string>();
      for (const holding of holdings) {
        const lines = await tx.unsafe(
          "SELECT tl.instrument_id,tl.currency,tl.id FROM trading_lines tl WHERE upper(tl.ticker)=upper($1) AND upper(tl.exchange)=upper($2) AND upper(tl.currency)=upper($3) AND tl.effective_from<=current_date AND (tl.effective_to IS NULL OR tl.effective_to>=current_date) ORDER BY tl.effective_from DESC,tl.id LIMIT 2",
          [holding.ticker,holding.exchange,String(locked[0].currency)]
        );
        if (!lines[0]) throw new Error("TRADING_LINE_NOT_FOUND:" + holding.ticker + ":" + holding.exchange);
        if (lines.length > 1) throw new Error("AMBIGUOUS_TRADING_LINE:" + holding.ticker + ":" + holding.exchange);
        const instrumentId=String(lines[0].instrument_id);
        if(includedInstruments.has(instrumentId))throw new Error("DUPLICATE_OPENING_HOLDING");
        includedInstruments.add(instrumentId);
        await tx.unsafe(
          "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,instrument_id,quantity,provenance,confidence,metadata) VALUES ($1,$2,now(),'OPENING_POSITION',$3,0,$4,$5,'USER_CONFIRMED','VERIFIED',$6::jsonb)",
          [id, locked[0].account_id, lines[0].currency, lines[0].instrument_id, holding.quantityDecimal.toString(), JSON.stringify({ openingSnapshot: true, tradingLineId: String(lines[0].id), ticker: holding.ticker, exchange: holding.exchange, accountName:String(locked[0].account_name) })]
        );
      }

      const pending=await tx.unsafe(
        "SELECT a.id,a.name FROM strategy_accounts sa JOIN accounts a ON a.id=sa.account_id "+
        "WHERE sa.strategy_instance_id=$1 AND NOT EXISTS ("+
        " SELECT 1 FROM ledger_events l WHERE l.strategy_instance_id=sa.strategy_instance_id AND l.account_id=sa.account_id"+
        ") ORDER BY CASE WHEN sa.role='PRIMARY' THEN 0 ELSE 1 END,a.created_at",
        [id]
      );
      const snapshotMeta={
        openingSnapshotAt:new Date().toISOString(),
        pendingOpeningAccountIds:pending.map((row)=>String(row.id)),
        pendingOpeningAccountNames:pending.map((row)=>String(row.name))
      };
      if(String(locked[0].onboarding_mode)==="RESUME"&&pending.length){
        await tx.unsafe(
          "UPDATE strategy_states SET state=jsonb_set(state || $1::jsonb,'{resumeNeedsReconciliation}','true'::jsonb,true),confidence='LOW',calculated_at=now() WHERE strategy_instance_id=$2",
          [JSON.stringify(snapshotMeta),id]
        );
      }else{
        await tx.unsafe(
          "UPDATE strategy_states SET state=(state-'resumeNeedsReconciliation') || $1::jsonb || '{\"forceReview\":true}'::jsonb,confidence='MEDIUM',calculated_at=now() WHERE strategy_instance_id=$2",
          [JSON.stringify(snapshotMeta),id]
        );
      }
      await tx.unsafe("UPDATE strategy_instances SET health_status='NEEDS_ATTENTION',updated_at=now() WHERE id=$1", [id]);
      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'strategy.opening-snapshot','strategy_instance',$2,$3::jsonb)",
        [user.id, id, JSON.stringify({ accountId:String(locked[0].account_id), holdings: holdings.length, cashEntered: cash.gt(0), pendingAccounts:pending.map((row)=>String(row.id)) })]
      );
      return {status:String(locked[0].status),pendingAccountIds:pending.map((row)=>String(row.id)),pendingAccountNames:pending.map((row)=>String(row.name))};
    });

    const recalc=snapshotState.status==="ACTIVE"?await recalculateAfterMutation(id,user.id,"opening-snapshot"):{actionId:null,recalculationPending:false,errorCode:null};
    return Response.json({
      ok:true,
      actionId:recalc.actionId,
      recalculationPending:recalc.recalculationPending,
      complete:snapshotState.pendingAccountIds.length===0,
      pendingAccountIds:snapshotState.pendingAccountIds,
      pendingAccountNames:snapshotState.pendingAccountNames
    });
  } catch(error){const denied=authFailure(error);if(denied)return denied;
    if (error instanceof z.ZodError) return Response.json({ error: "Check the opening cash and holding quantities." }, { status: 400 });
    const code = error instanceof Error ? error.message : "FAILED";
    if (code === "STRATEGY_CLOSED") return Response.json({ error: "Closed strategies are read-only." }, { status: 409 });
    if (code === "STRATEGY_NOT_FOUND") return Response.json({ error: "That account is not linked to this strategy." }, { status: 404 });
    if (code === "OPENING_SNAPSHOT_NOT_ALLOWED") return Response.json({ error: "Opening snapshots are only for resumed portfolios or newly linked existing accounts." }, { status: 409 });
    if (code === "OPENING_SNAPSHOT_EXISTS") return Response.json({ error: "This account already has activity, so its opening position cannot be replaced." }, { status: 409 });
    if (code === "DUPLICATE_OPENING_HOLDING") return Response.json({error:"Enter each security once with its total quantity. Duplicate holdings have not been saved."},{status:400});
    if (code.startsWith("TRADING_LINE_NOT_FOUND:")) {
      const [, ticker, exchange] = code.split(":");
      return Response.json({ error: "No active configured trading line in this account’s currency was found for " + ticker + " on " + exchange + "." }, { status: 400 });
    }
    if (code.startsWith("AMBIGUOUS_TRADING_LINE:")) {
      const [, ticker, exchange] = code.split(":");
      return Response.json({ error: "More than one active configured trading line matches " + ticker + " on " + exchange + ". Ask an administrator to resolve the duplicate mapping before importing this holding." }, { status: 409 });
    }
    return Response.json({ error: "Could not save the opening snapshot." }, { status: 500 });
  }
}
