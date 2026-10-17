import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { afterEach, expect, test } from "vitest";

let server: Server | undefined;
afterEach(async () => {
  if (server) {
    const closing = server;
    server = undefined;
    await new Promise<void>((resolve, reject) => closing.close((error) => error ? reject(error) : resolve()));
  }
});

async function runSmoke(redirect: string | null) {
  server = createServer((request, response) => {
    if (request.url === "/api/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ready" }));
    } else if (["/", "/login", "/register", "/pricing", "/strategies"].includes(request.url ?? "")) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><body>Ready</body></html>");
    } else if (request.url === "/api/cron/health") {
      response.writeHead(401);
      response.end();
    } else if (request.url === "/admin" || request.url === "/app") {
      response.writeHead(302, redirect === null ? {} : { location: redirect });
      response.end();
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  return await new Promise<{ exit: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [
      "scripts/release-acceptance.mjs",
      "--url", `http://127.0.0.1:${address.port}/`,
      "--allow-local"
    ], { env: { ...process.env, WEALTHARR_RELEASE_URL: "" } });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (exit) => resolve({ exit, output }));
  });
}

test("release smoke accepts protected-route redirects to same origin", async () => {
  const result = await runSmoke("/login");
  expect(result.exit).toBe(0);
  expect(result.output).toContain("Release HTTP smoke: PASS");
});

test.each(["https://malicious.example/login", null])(
  "release smoke refuses external or missing auth redirect: %s",
  async (redirect) => {
    const result = await runSmoke(redirect);
    expect(result.exit).toBe(1);
    expect(result.output).toContain("FAIL anonymous admin access denied");
    expect(result.output).toContain("FAIL anonymous member access denied");
  }
);
