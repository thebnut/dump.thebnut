import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createWalletMatcher } from "../src/lib/wallet-match";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined, set: (name: string, value: string) => jar.set(name, value) }) }));
import { addPasswordToWallet, readWallet, encryptWallet, decryptWallet, makeGateToken, verifyGateToken } from "../src/lib/gate";
beforeAll(() => { vi.stubEnv("AUTH_SECRET", "synthetic-test-key-not-a-production-credential"); });
beforeEach(() => jar.clear());
describe("owner-scoped password wallet", () => {
  it("cannot silently unlock another owner's project using the same password", async () => {
    const compare = vi.fn(async (password: string, hash: string) => password === hash);
    const match = createWalletMatcher(compare);
    const row = { id: "password-id", label: "Family", passwordHash: "shared-password" };
    const wallet = [{ ownerId: "owner-a", password: "shared-password" }];
    expect(await match("project-b", "owner-b", wallet, [row])).toBeNull();
    expect(compare).not.toHaveBeenCalled();
    expect(await match("project-a", "owner-a", wallet, [row])).toEqual(row);
  });
  it("bounds bcrypt work and caches negative results until expiry", async () => {
    const compare = vi.fn(async () => false);
    const match = createWalletMatcher(compare);
    const wallet = Array.from({ length: 25 }, (_, i) => ({ ownerId: "owner", password: `password-${i}` }));
    const hashes = Array.from({ length: 5 }, (_, i) => ({ id: String(i), label: "test", passwordHash: "different" }));
    await match("project", "owner", wallet, hashes, 1000);
    expect(compare.mock.calls.length).toBeLessThanOrEqual(25);
    const firstCount = compare.mock.calls.length;
    await match("project", "owner", wallet, hashes, 2000);
    expect(compare).toHaveBeenCalledTimes(firstCount);
    await match("project", "owner", wallet, hashes, 32000);
    expect(compare.mock.calls.length).toBeGreaterThan(firstCount);
  });
  it("shares comparison work across concurrent identical requests", async () => {
    let release!: (value: boolean) => void;
    const compare = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
    const match = createWalletMatcher(compare);
    const wallet = [{ ownerId: "owner", password: "same" }];
    const hashes = [{ id: "pw", label: "Test", passwordHash: "hash" }];
    const a = match("project", "owner", wallet, hashes); const b = match("project", "owner", wallet, hashes);
    expect(compare).toHaveBeenCalledTimes(1);
    release(true); expect(await a).toEqual(hashes[0]); expect(await b).toEqual(hashes[0]);
  });
  it("does not cache an incomplete automatic scan as a password mismatch", async () => {
    const compare = vi.fn(async () => false);
    const match = createWalletMatcher(compare);
    const wallet = [{ ownerId: "owner", password: "candidate" }];
    const hashes = Array.from({ length: 26 }, (_, i) => ({ id: String(i), label: "Test", passwordHash: "hash" }));
    expect(await match("project", "owner", wallet, hashes, 1000)).toBeNull();
    expect(compare).toHaveBeenCalledTimes(25);
    await match("project", "owner", wallet, hashes, 2000);
    expect(compare).toHaveBeenCalledTimes(50);
  });
  it("invalidates a cached miss when passwords change", async () => {
    const match = createWalletMatcher(async (password, hash) => password === hash);
    const wallet = [{ ownerId: "owner", password: "match" }];
    expect(await match("project", "owner", wallet, [{ id: "pw", label: "Test", passwordHash: "old" }], 1000)).toBeNull();
    expect((await match("project", "owner", wallet, [{ id: "pw", label: "Test", passwordHash: "match" }], 2000))?.id).toBe("pw");
  });
  it("round-trips scoped entries and rejects tampering", () => {
    const entries = [{ ownerId: "owner", password: "sensitive-test-password" }];
    const encrypted = encryptWallet(entries);
    expect(encrypted).not.toContain(entries[0].password);
    expect(decryptWallet(encrypted)).toEqual(entries);
    const tampered = encrypted.slice(0, 4) + (encrypted[4] === "a" ? "b" : "a") + encrypted.slice(5);
    expect(decryptWallet(tampered)).toEqual([]);
  });
  it("keeps cookies within budget while retaining the newest entry", async () => {
    for (let i = 0; i < 25; i++) await addPasswordToWallet(`${i}-` + "x".repeat(250), "owner");
    expect(Buffer.byteLength(jar.get("dt_pw")!)).toBeLessThanOrEqual(3500);
    expect((await readWallet())[0].password).toMatch(/^24-/);
    const before = jar.get("dt_pw");
    await addPasswordToWallet("x".repeat(5000), "owner");
    expect(jar.get("dt_pw")).toBe(before);
  });
  it("does not mix identical passwords from different owners", async () => {
    await addPasswordToWallet("same", "owner-a"); await addPasswordToWallet("same", "owner-b");
    expect((await readWallet()).map(entry => entry.ownerId)).toEqual(["owner-b", "owner-a"]);
  });
  it("rejects malformed gate signatures without crashing", () => {
    expect(verifyGateToken("project.password.short", "project")).toBeNull();
    expect(verifyGateToken(makeGateToken("project", "password"), "project")).toEqual({ passwordLabelId: "password" });
  });
});
