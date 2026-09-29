/**
 * The encryption is hygiene, not the control — but a broken hygiene layer that *looks* like it
 * works is worse than none, because the claim in the README would then be false. These tests
 * pin the three properties the claim actually rests on: a round trip works, a ciphertext moved
 * to another agent fails, and a tampered byte fails.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { canEncryptAgentKeys, decryptAgentKey, encryptAgentKey } from "./crypto";

const SECRET_A = "1".repeat(64);
const SECRET_B = "2".repeat(64);

const AGENT = "0x1111111111111111111111111111111111111111";
const OTHER_AGENT = "0x2222222222222222222222222222222222222222";
const KEY = `0x${"ab".repeat(32)}`;

beforeEach(() => {
  process.env.AGENT_KEY_ENC_SECRET = SECRET_A;
});

describe("agent key encryption", () => {
  it("round-trips a private key", () => {
    expect(decryptAgentKey(encryptAgentKey(KEY, AGENT), AGENT)).toBe(KEY);
  });

  it("is case-insensitive about the bound address, because the database stores it lowercased", () => {
    const payload = encryptAgentKey(KEY, AGENT.toUpperCase().replace("0X", "0x"));
    expect(decryptAgentKey(payload, AGENT)).toBe(KEY);
  });

  it("produces a different ciphertext every time, so equal keys are not visibly equal", () => {
    expect(encryptAgentKey(KEY, AGENT)).not.toBe(encryptAgentKey(KEY, AGENT));
  });

  it("emits a self-describing v1 payload of four base64 fields", () => {
    const parts = encryptAgentKey(KEY, AGENT).split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    // 12-byte IV and 16-byte tag, base64.
    expect(Buffer.from(parts[1], "base64")).toHaveLength(12);
    expect(Buffer.from(parts[2], "base64")).toHaveLength(16);
  });

  it("never puts the key in its own output", () => {
    expect(encryptAgentKey(KEY, AGENT)).not.toContain(KEY.slice(2));
  });
});

describe("agent key encryption — the failures that must be failures", () => {
  it("refuses to decrypt a ciphertext bound to a different agent", () => {
    const payload = encryptAgentKey(KEY, AGENT);
    // THE test for the AAD decision: a swapped row cannot produce a usable wallet.
    expect(() => decryptAgentKey(payload, OTHER_AGENT)).toThrow(/different agent/);
  });

  it("refuses a tampered ciphertext", () => {
    const parts = encryptAgentKey(KEY, AGENT).split(":");
    const bytes = Buffer.from(parts[3], "base64");
    bytes[0] ^= 0xff;
    parts[3] = bytes.toString("base64");
    expect(() => decryptAgentKey(parts.join(":"), AGENT)).toThrow(/Could not decrypt/);
  });

  it("refuses a tampered authentication tag", () => {
    const parts = encryptAgentKey(KEY, AGENT).split(":");
    const tag = Buffer.from(parts[2], "base64");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64");
    expect(() => decryptAgentKey(parts.join(":"), AGENT)).toThrow(/Could not decrypt/);
  });

  it("refuses a ciphertext encrypted under a different secret", () => {
    const payload = encryptAgentKey(KEY, AGENT);
    process.env.AGENT_KEY_ENC_SECRET = SECRET_B;
    expect(() => decryptAgentKey(payload, AGENT)).toThrow(/AGENT_KEY_ENC_SECRET/);
  });

  it("refuses an unknown payload version instead of guessing at the format", () => {
    const payload = encryptAgentKey(KEY, AGENT).replace(/^v1/, "v2");
    expect(() => decryptAgentKey(payload, AGENT)).toThrow(/not v1 format/);
  });

  it("refuses to encrypt something that is not a private key", () => {
    expect(() => encryptAgentKey("hunter2", AGENT)).toThrow(/does not look like a private key/);
    // And the rejected value is not echoed back in the message.
    expect(() => encryptAgentKey("hunter2", AGENT)).not.toThrow(/hunter2/);
  });

  it("refuses to bind a ciphertext to something that is not an address", () => {
    expect(() => encryptAgentKey(KEY, "alice")).toThrow(/is not an address/);
  });

  it("names the variable when the secret is the wrong length", () => {
    process.env.AGENT_KEY_ENC_SECRET = "abc";
    expect(() => encryptAgentKey(KEY, AGENT)).toThrow(/64 hex characters/);
    expect(canEncryptAgentKeys()).toBe(false);
  });

  it("reports availability without throwing when the secret is good", () => {
    expect(canEncryptAgentKeys()).toBe(true);
  });
});
