/**
 * True only inside the ephemeral GitHub Actions test database. The CI catalogue fixture (the legacy
 * 9Sig release and its synthetic evidence) is usable there and nowhere else.
 */
export function syntheticCatalogueFixtureAllowed(){
  const u=process.env.DATABASE_URL??"";
  return process.env.CI==="true"&&process.env.GITHUB_ACTIONS==="true"&&
    /^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1:5432\/strategyos_test$/.test(u);
}
