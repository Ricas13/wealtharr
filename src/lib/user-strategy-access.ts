import "server-only";
import type {Sql} from "postgres";

type AccessDb=Pick<Sql,"unsafe">;

/** An individual deny cannot be bypassed by a paid plan or the admin preview path. */
export async function assertUserStrategyAccessWith(db:AccessDb,userId:string,strategyDefinitionId:string){
  const rows=await db.unsafe(
    "SELECT allowed FROM user_strategy_access WHERE user_id=$1 AND strategy_definition_id=$2 LIMIT 1",
    [userId,strategyDefinitionId]
  );
  if(rows[0]?.allowed===false)throw new Error("STRATEGY_NOT_ALLOWED_FOR_USER");
}

/** An explicit allow is NOT a global, plan, or account-wrapper override. */
export function effectiveUserStrategyPermission(override:boolean|null|undefined){
  return override!==false;
}
