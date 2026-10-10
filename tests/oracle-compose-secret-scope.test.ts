import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

describe("Oracle Compose scheduler boundary",()=>{
  it("does not inject all application credentials into the scheduler",()=>{
    const config=readFileSync("docker-compose.oracle.yml","utf8");
    const scheduler=config.split("\n  scheduler:\n")[1]?.split("\n  backup:\n")[0];
    expect(scheduler).toBeTruthy();
    expect(scheduler).toContain("CRON_SECRET:");
    expect(scheduler).not.toContain("env_file:");
    expect(scheduler).not.toContain("DATABASE_URL:");
    expect(scheduler).not.toContain("STRIPE_SECRET_KEY:");
  });
});
