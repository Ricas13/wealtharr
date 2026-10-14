#!/usr/bin/env node
/**
 * Read-only release smoke test against the ACTUAL URL, not a GitHub PR check.
 * It does not create accounts, take payments, record fills or certify legal/data rights.
 * npm run release:smoke -- --url https://your-domain.example
 *
 * Local CI may explicitly pass --allow-local; production must always be HTTPS.
 */
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const input = arg("--url") || process.env.WEALTHARR_RELEASE_URL;
if (!input) {
  console.error("FAIL: supply --url https://your-wealtharr-host or WEALTHARR_RELEASE_URL");
  process.exit(2);
}
let base;
try { base = new URL(input); }
catch { console.error("FAIL: invalid release URL"); process.exit(2); }
const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
if ((base.protocol !== "https:" && !(local && base.protocol === "http:" && process.argv.includes("--allow-local"))) ||
    base.username || base.password || base.search || base.hash || base.pathname !== "/") {
  console.error("FAIL: production release URL must be a root HTTPS origin without embedded credentials");
  process.exit(2);
}
const results = [];
async function check(label, path, accept, extra) {
  try {
    const response = await fetch(new URL(path, base), {
      method: "GET", redirect: "manual",
      headers: { "accept": "text/html,application/json" },
      signal: AbortSignal.timeout(12000)
    });
    let passed = accept(response.status);
    if (passed && extra) passed = await extra(response);
    results.push({ label, passed, status: response.status });
  } catch {
    results.push({ label, passed: false, status: "network/error" });
  }
}
await check("core database and application readiness", "/api/health",
  (code) => code === 200,
  async (response) => {
    const body = await response.json();
    return body.status === "ready" && !("database" in body) && !("capabilities" in body);
  });
for (const page of ["/", "/login", "/register", "/pricing", "/strategies"]) {
  await check("public page " + page, page, (code) => code === 200);
}
await check("anonymous admin access denied", "/admin",
  (code) => [301,302,303,307,308,401,403,404].includes(code));
await check("anonymous member access denied", "/app",
  (code) => [301,302,303,307,308,401,403,404].includes(code));
await check("worker health requires bearer authentication", "/api/cron/health",
  (code) => code === 401 || code === 403);
for (const result of results) {
  console.log((result.passed ? "PASS" : "FAIL") + " " + result.label + " (" + result.status + ")");
}
const failed = results.filter((row) => !row.passed);
console.log("Release HTTP smoke: " + (failed.length ? "FAILED (" + failed.length + ")" : "PASS") +
  " — this only verifies public HTTP, application readiness and basic access boundaries.");
if (failed.length) process.exitCode = 1;
