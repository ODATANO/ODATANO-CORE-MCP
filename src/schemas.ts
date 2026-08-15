import { z } from 'zod';

/*
 * Shared zod helpers for Cardano-native shapes. Validation happens in the MCP
 * layer so obviously malformed input never reaches ODATANO (and the agent
 * gets a precise message instead of a generic 400).
 */

const HEX = /^[0-9a-fA-F]+$/;

export const hex64 = (what: string) =>
  z.string().regex(/^[0-9a-fA-F]{64}$/, `${what} must be 64 hex characters (32 bytes)`);

export const hex56 = (what: string) =>
  z.string().regex(/^[0-9a-fA-F]{56}$/, `${what} must be 56 hex characters (28 bytes)`);

/** Any even-length hex string (CBOR, COSE, scripts). */
export const hexString = (what: string, max = 1_000_000) =>
  z.string().min(2).max(max).regex(HEX, `${what} must be hex`).refine((s) => s.length % 2 === 0, {
    message: `${what} must have an even number of hex characters`,
  });

/**
 * Bech32 Cardano address (payment or stake). Loose check: prefix + charset +
 * length; the server does the checksum. Accepts addr / addr_test / stake /
 * stake_test.
 */
export const bech32Address = z.string()
  .regex(/^(addr|addr_test|stake|stake_test)1[02-9ac-hj-np-z]{20,120}$/, 'must be a bech32 Cardano address (addr…/addr_test…/stake…/stake_test…)');

export const stakeAddress = z.string()
  .regex(/^(stake|stake_test)1[02-9ac-hj-np-z]{20,80}$/, 'must be a bech32 stake address (stake…/stake_test…)');

export const poolId = z.string()
  .regex(/^pool1[02-9ac-hj-np-z]{20,70}$/, 'must be a bech32 pool id (pool1…)');

export const drepId = z.string()
  .regex(/^drep(_script)?1[02-9ac-hj-np-z]{20,70}$/, 'must be a bech32 DRep id (drep1… / drep_script1…)');

/** `policyId (56 hex) + assetNameHex (0..64 hex)`; `lovelace` is also accepted where the server does. */
export const assetUnit = z.string()
  .regex(/^[0-9a-fA-F]{56}(?:[0-9a-fA-F]{2}){0,32}$/, 'must be policyId (56 hex) + assetNameHex (up to 64 hex)');

/**
 * Non-negative integer amount as decimal string (preferred, exact) or JS
 * number. Always forwarded to ODATANO as a string so nothing is rounded.
 */
export const amount = (what: string) =>
  z.union([
    z.string().regex(/^\d+$/, `${what} must be a non-negative integer (decimal string)`),
    z.number().int().nonnegative(),
  ]).transform((v) => String(v));

/** Positive integer amount (>= 1). */
export const positiveAmount = (what: string) =>
  z.union([
    z.string().regex(/^[1-9]\d*$/, `${what} must be a positive integer (decimal string)`),
    z.number().int().positive(),
  ]).transform((v) => String(v));

/** Posix milliseconds as decimal string or number, forwarded as string. */
export const posixMs = amount;

/** A string that must parse as JSON (objects/arrays are passed pre-stringified to ODATANO). */
export const jsonString = (what: string, kind: 'array' | 'object' | 'any' = 'any') =>
  z.string().min(1).superRefine((s, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${what} must be a JSON string` });
      return;
    }
    if (kind === 'array' && !Array.isArray(parsed)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${what} must be a JSON array` });
    }
    if (kind === 'object' && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${what} must be a JSON object` });
    }
  });

/**
 * JSON that the agent may pass either as a string or as a native value; the
 * native form is stringified before it reaches ODATANO. Convenient for
 * datums / redeemers / metadata objects.
 */
export const jsonValue = (what: string, kind: 'array' | 'object' | 'any' = 'any') =>
  z.union([
    jsonString(what, kind),
    kind === 'array' ? z.array(z.unknown()) : kind === 'object' ? z.record(z.unknown()) : z.unknown(),
  ]).transform((v) => (typeof v === 'string' ? v : JSON.stringify(v)));

export const uuid = (what: string) => z.string().uuid(`${what} must be a UUID`);

export const network = z.enum(['mainnet', 'preview', 'preprod']);

/** Clamp an integer into [min, max] (used for limits the server also clamps). */
export const clampedInt = (what: string, min: number, max: number, fallback: number) =>
  z.number().int().min(min, `${what} must be >= ${min}`).max(max, `${what} must be <= ${max}`).optional()
    .transform((v) => v ?? fallback);
