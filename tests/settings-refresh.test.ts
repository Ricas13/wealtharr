import { beforeEach, describe, expect, it, vi } from "vitest";

// A forced settings refresh follows a save. It must never be satisfied by a load that started before
// the save committed: that load may have read the old rows.
const state = vi.hoisted(() => ({
  // Each call to the settings query waits for the test to release it and reports the table contents
  // as they were when the query STARTED (like a snapshot read).
  pending: [] as Array<{ snapshot: string | null; release: () => void; done: Promise<void> }>,
  table: null as string | null
}));

vi.mock("@/lib/db", () => ({
  sql: {
    unsafe: async () => {
      const snapshot = state.table;
      let release!: () => void;
      const done = new Promise<void>((resolve) => { release = resolve; });
      state.pending.push({ snapshot, release, done });
      await done;
      return snapshot === null ? [] : [{ key: "OPS_ALERTS_ENABLED", value_encrypted: snapshot }];
    }
  }
}));
vi.mock("@/lib/crypto", () => ({ decryptSecret: (value: string) => value, encryptSecret: (value: string) => value }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ensureSettings(force)", () => {
  beforeEach(() => {
    state.pending.length = 0;
    state.table = null;
    delete process.env.OPS_ALERTS_ENABLED;
    vi.resetModules();
  });

  it("does not return stale settings when a load was already in flight before the save", async () => {
    const { ensureSettings } = await import("@/lib/settings");
    // A background refresh starts and reads the table before the save.
    const background = ensureSettings(true);
    await flush();
    expect(state.pending).toHaveLength(1);
    // The save commits, then the saver asks for a forced refresh.
    state.table = "true";
    let forcedDone = false;
    const forced = ensureSettings(true).then(() => { forcedDone = true; });
    await flush();
    // It must not have joined the old load: it waits for it, then starts a second one.
    state.pending[0].release();
    await background;
    await flush();
    expect(forcedDone).toBe(false);
    expect(state.pending).toHaveLength(2);
    expect(state.pending[1].snapshot).toBe("true");
    state.pending[1].release();
    await forced;
    expect(process.env.OPS_ALERTS_ENABLED).toBe("true");
  });

  it("lets concurrent forced callers share one load that started after the first of them", async () => {
    const { ensureSettings } = await import("@/lib/settings");
    state.table = "true";
    const a = ensureSettings(true);
    const b = ensureSettings(true);
    await flush();
    expect(state.pending).toHaveLength(1);
    state.pending[0].release();
    await Promise.all([a, b]);
    expect(process.env.OPS_ALERTS_ENABLED).toBe("true");
  });

  it("still coalesces ordinary refreshes onto the load in flight", async () => {
    const { ensureSettings } = await import("@/lib/settings");
    const first = ensureSettings();
    const second = ensureSettings();
    await flush();
    expect(state.pending).toHaveLength(1);
    state.pending[0].release();
    await Promise.all([first, second]);
  });

  it("never throws when the database is unavailable", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ sql: { unsafe: async () => { throw new Error("db down"); } } }));
    const { ensureSettings } = await import("@/lib/settings");
    await expect(ensureSettings(true)).resolves.toBeUndefined();
    vi.doUnmock("@/lib/db");
  });
});
