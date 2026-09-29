/**
 * AES-256-GCM for agent private keys at rest.
 *
 * ## Read this before you believe the encryption is the control
 *
 * It is not. `docs/TRUST_MODEL.md` says so and this file repeats it: **the encryption is
 * hygiene; the on-chain caps are what actually bound the risk.** A server compromised badly
 * enough to read `members.agent_key_ciphertext` is a server that can also read
 * `AGENT_KEY_ENC_SECRET` out of its own environment. What makes a stolen agent key cheap is
 * that the contract caps what the key can stake per transaction and per market, and pays
 * `claim()` to the registered *owner* rather than to the agent. Those hold whether or not this
 * file exists.
 *
 * What encryption at rest *does* buy is narrower and still worth having: a database dump — a
 * leaked Neon branch, a backup, a screenshot of a query result, a `SELECT *` in a demo — does
 * not hand anyone a usable key.
 *
 * ## The one design decision worth defending
 *
 * The agent's own address is used as **additional authenticated data**, so a ciphertext is
 * cryptographically bound to the row it belongs to. Moving a ciphertext from one member to
 * another — by an UPDATE, a botched restore, or a deliberate swap — makes it fail to decrypt
 * instead of quietly producing a wallet that signs for the wrong member. That matters here
 * more than it usually would: `members.agent_address` is what `registerAgent` bound to an
 * owner on chain, so a mismatched key would be a wallet betting under a stranger's caps and
 * paying winnings to a stranger's address. GCM gives that check for one extra argument, so
 * there is no reason not to take it.
 *
 * Nothing in this module logs, returns or stringifies a key except to its direct caller.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireEnv } from "../env";

/** Recorded in the payload so a future scheme change is a readable migration, not a guess. */
const VERSION = "v1";

/** 96 bits — the IV length GCM is specified and optimised for. */
const IV_BYTES = 12;

/**
 * The 32-byte key, read from the environment on every call.
 *
 * Deliberately not cached in a module-level variable: a long-lived `Buffer` holding the key
 * sits in every heap dump for the lifetime of the process, and these calls happen a handful of
 * times per tick. Re-deriving costs a hex parse.
 */
function secretKey(): Buffer {
  const raw = requireEnv("AGENT_KEY_ENC_SECRET");
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "AGENT_KEY_ENC_SECRET must be exactly 64 hex characters (32 bytes). " +
        "Generate one with `openssl rand -hex 32`. Its value is never printed.",
    );
  }
  return Buffer.from(raw, "hex");
}

/** Lowercased, so the AAD cannot depend on how an address happened to be cased. */
function aad(agentAddress: string): Buffer {
  if (!/^0x[0-9a-fA-F]{40}$/.test(agentAddress)) {
    throw new Error(`"${agentAddress}" is not an address, so it cannot bind a ciphertext.`);
  }
  return Buffer.from(agentAddress.toLowerCase(), "utf8");
}

/**
 * Encrypts a private key for storage, bound to the agent address that will use it.
 *
 * Returns `v1:<iv>:<tag>:<ciphertext>`, all base64. Fixed-width fields would be denser; a
 * self-describing string is greppable in a database client, which is worth more than the bytes.
 */
export function encryptAgentKey(privateKey: string, agentAddress: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    // Checked without echoing the value: a thrown message can reach a log or an HTTP response.
    throw new Error("That does not look like a private key. Refusing to encrypt it.");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  cipher.setAAD(aad(agentAddress));

  const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Recovers a private key, or throws.
 *
 * There is no "best effort" path and no fallback: GCM authentication failing means the
 * ciphertext, the tag, the key or the address is wrong, and every one of those is a condition
 * under which signing would be the wrong thing to do. The caller's job is to defer the intent
 * and say why — never to proceed with a key it could not verify.
 */
export function decryptAgentKey(payload: string, agentAddress: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(
      `Agent key ciphertext is not ${VERSION} format. Found ${parts.length} field(s) ` +
        `with version "${parts[0] ?? ""}".`,
    );
  }

  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivB64, "base64"));
  decipher.setAAD(aad(agentAddress));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  let plaintext: string;
  try {
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // The library's own message ("Unsupported state or unable to authenticate data") says
    // nothing a reader can act on. Name the three real causes instead.
    throw new Error(
      `Could not decrypt the agent key for ${agentAddress}. Either AGENT_KEY_ENC_SECRET ` +
        `changed, the row was tampered with, or this ciphertext belongs to a different agent.`,
    );
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(plaintext)) {
    throw new Error("Decryption authenticated but did not produce a private key.");
  }
  return plaintext;
}

/** True when a key can be encrypted or decrypted at all, so callers can degrade cleanly. */
export function canEncryptAgentKeys(): boolean {
  try {
    secretKey();
    return true;
  } catch {
    return false;
  }
}
