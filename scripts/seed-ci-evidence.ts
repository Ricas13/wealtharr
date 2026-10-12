/** Synthetic integration-test release evidence only.
 * Production seeding must NEVER fabricate methodology sign-off. GitHub CI uses a local,
 * disposable test database to exercise the creation/switch lifecycle; this row proves
 * authorisation code paths, not the real 9Sig method, data licence or legal eligibility.
 */
import postgres from "postgres";

async function main(){
const url=process.env.DATABASE_URL??"";
if(process.env.GITHUB_ACTIONS!=="true" || process.env.CI!=="true" ||
   !/^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1:5432\/strategyos_test$/.test(url)){
  throw new Error("CI_EVIDENCE_FIXTURE_REFUSED_OUTSIDE_EPHEMERAL_TEST_DB");
}
const sql=postgres(url,{max:1,prepare:false});
try{
  const rows=await sql.unsafe(
    "SELECT v.id FROM strategy_versions v JOIN strategy_definitions d ON d.id=v.strategy_definition_id "+
    "WHERE d.key='9sig' AND v.lifecycle_status='PUBLISHED' ORDER BY v.published_at DESC NULLS LAST LIMIT 1"
  );
  if(!rows[0])throw new Error("CI_9SIG_TEST_VERSION_MISSING");
  await sql.unsafe(
    "INSERT INTO strategy_version_attestations (strategy_version_id,spec_card,golden_tests,notes,attested_by_email) "+
    "VALUES ($1,'docs/strategy-specs/ci-only-fixture.md','tests/value-target.test.ts',"+
    "'SYNTHETIC CI TEST DATA ONLY — NOT AN INVESTMENT METHODOLOGY APPROVAL',"+
    "'ci-synthetic-fixture@invalid.example') "+
    "ON CONFLICT (strategy_version_id) DO NOTHING",
    [rows[0].id]
  );
  console.log("Installed synthetic release evidence in disposable CI test database only.");
}finally{
  await sql.end();
}
}
void main().catch((error)=>{console.error(error);process.exitCode=1;});
