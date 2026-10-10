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

  it("runs the scheduler unprivileged, read-only, and without installing packages at start-up",()=>{
    const config=readFileSync("docker-compose.oracle.yml","utf8");
    const scheduler=config.split("\n  scheduler:\n")[1]?.split("\n  backup:\n")[0]??"";
    expect(scheduler).toContain('user: "65534:65534"');
    expect(scheduler).toContain("read_only: true");
    expect(scheduler).toContain("cap_drop: [ALL]");
    expect(scheduler).toContain("no-new-privileges:true");
    expect(scheduler).not.toMatch(/apk add/);
    expect(scheduler).not.toMatch(/\bcurl\b/);
  });
  it("gives the backup container an explicit variable list rather than the whole application env file",()=>{
    const config=readFileSync("docker-compose.oracle.yml","utf8");
    const backup=(config.split("\n  backup:\n")[1]?.split("\nvolumes:\n")[0]??"").split("\n").filter((line)=>!line.trim().startsWith("#")).join("\n");
    expect(backup).toBeTruthy();
    expect(backup).not.toContain("env_file:");
    for(const secret of ["AUTH_SECRET","APP_ENCRYPTION_KEY","STRIPE","EMAIL","MARKET_DATA"])expect(backup).not.toContain(secret);
    expect(backup).toContain("RESTIC_REPOSITORY");
    expect(backup).toContain("PGPASSWORD");
    expect(backup).toContain("PGUSER: wealtharr_backup");
    expect(backup).not.toContain("PGUSER: strategyos");
  });
  it("isolates elevated maintenance and scrubs database passwords from the app",()=>{
    const config=readFileSync("docker-compose.oracle.yml","utf8");
    const app=config.split("\n  app:\n")[1]?.split("\n  maintenance:\n")[0]??"";
    const maintenance=config.split("\n  maintenance:\n")[1]?.split("\n  scheduler:\n")[0]??"";
    for(const variable of ["POSTGRES_PASSWORD","APP_DB_PASSWORD","BACKUP_DB_PASSWORD"])
      expect(app).toContain(variable+': ""');
    expect(maintenance).toContain("profiles: [maintenance]");
    expect(maintenance).toContain("APP_DB_PASSWORD:");
    expect(maintenance).toContain("BACKUP_DB_PASSWORD:");
    expect(maintenance).not.toContain("ports:");
  });
  it("keeps the database private and the application as the only service with the application env file",()=>{
    const config=readFileSync("docker-compose.oracle.yml","utf8");
    expect(config.match(/env_file:/g)?.length).toBe(1);
    const db=config.split("\n  db:\n")[1]?.split("\n  app:\n")[0]??"";
    expect(db).toBeTruthy();
    expect(db).not.toContain("ports:");
  });
});
