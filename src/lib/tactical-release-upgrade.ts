import type {Sql} from "postgres";

export type TacticalReleaseSeed={
 definitionId:string;name:string;description:string;family:string;
 config:Readonly<Record<string,unknown>>;inputSchema:readonly unknown[];disclosure:string;
};
/** Executes only inside a database transaction which locks the strategy definition.
 * The caller must already have verified this is a code-COMPLETE canonical tactical release.
 * An existing draft or active user instance is never altered; the new release receives
 * its own immutable version row. Existing published versions are never modified.
 */
export async function insertSafeTacticalRelease(tx:Pick<Sql,"unsafe">,item:TacticalReleaseSeed):
 Promise<"CREATED"|"BLOCKED"|"UNCHANGED">{
 const {definitionId:id,name,description,family,config,inputSchema,disclosure}=item;
 const defs=await tx.unsafe("SELECT id,engine,enabled FROM strategy_definitions WHERE id=$1 FOR UPDATE",[id]);
 if(defs.length!==1)throw new Error("TACTICAL_RELEASE_DEFINITION_MISSING");
 const def=defs[0];
 if(def.enabled===true)return "BLOCKED";
 if(!["TACTICAL_ALLOCATION","MOMENTUM_ROTATION","RESEARCH_PENDING"].includes(String(def.engine)))return "BLOCKED";
 if((await tx.unsafe("SELECT id FROM strategy_instances WHERE strategy_definition_id=$1 LIMIT 1",[id])).length)return "BLOCKED";
 const versions=await tx.unsafe("SELECT version,lifecycle_status FROM strategy_versions WHERE strategy_definition_id=$1 FOR UPDATE",[id]);
 if(versions.some(v=>v.lifecycle_status==="PUBLISHED"))return "UNCHANGED";
 if(versions.some(v=>!["1.0","2.0"].includes(String(v.version))))return "BLOCKED";
 const version=versions.some(v=>v.version==="1.0")?"2.0":"1.0";
 if(versions.some(v=>v.version===version))return "BLOCKED";
 await tx.unsafe(
  "UPDATE strategy_definitions SET name=$2,description=$3,family=$4,engine='TACTICAL_ALLOCATION' "+
  "WHERE id=$1 AND enabled=false AND NOT EXISTS (SELECT 1 FROM strategy_instances WHERE strategy_definition_id=$1)",
  [id,name,description,family]);
 const inserted=await tx.unsafe(
  "INSERT INTO strategy_versions (strategy_definition_id,version,effective_from,engine_key,lifecycle_status,upgrade_policy,input_schema,config,disclosure,published_at) "+
  "VALUES ($1,$2,current_date,'TACTICAL_ALLOCATION','PUBLISHED','OPTIONAL',$3::text::jsonb,$4::text::jsonb,$5,now()) "+
  "ON CONFLICT (strategy_definition_id,version) DO NOTHING RETURNING id",
  [id,version,JSON.stringify(inputSchema),JSON.stringify(config),disclosure]);
 if(inserted.length!==1)throw new Error("TACTICAL_RELEASE_INSERT_CONFLICT");
 return "CREATED";
}
