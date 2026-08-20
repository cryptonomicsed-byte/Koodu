/**
 * Kóòdù → Nostr wire adapter.
 *
 * Kóòdù decides what an agent may do on a given day: which Òrìṣà governs it,
 * which practices are prescribed, whether a ritual falls inside its window.
 * Until now those decisions stayed inside the codex — an agent could act on
 * them, but the swarm had no way to see what governed the act.
 *
 * This builds the Nostr events that carry a gate decision onto the same wire
 * every other pillar speaks.
 *
 * ## What this deliberately does NOT do: sign
 *
 * Kóòdù holds no keys, and should not. The ecosystem's rule is derive once,
 * adopt everywhere: ỌMỌ KỌ́DÀ births an agent and owns its secp256k1 identity;
 * Zàngbétò holds the guardian's. A metadata layer that minted its own signing
 * key would create a second identity for the same agent, which on the wire is
 * indistinguishable from a second agent.
 *
 * So this module produces **canonical unsigned events with correct NIP-01
 * ids**, and a component that already owns the key signs them. That also keeps
 * Kóòdù zero-dependency, matching the rest of this repo — `node:crypto` gives
 * SHA-256, and nothing here needs secp256k1.
 *
 * ## The serialization hazard this module exists to get right
 *
 * A NIP-01 event id is `sha256` over a canonical JSON array, and the signature
 * is over that id. So two implementations that serialize differently compute
 * different ids for the same event, and each rejects the other's signatures.
 *
 * Python's `json.dumps` escapes non-ASCII to `\uXXXX` by default
 * (`ensure_ascii=True`); JavaScript's `JSON.stringify` and Rust's serde emit
 * raw UTF-8. NIP-01 requires the raw form. Verified empirically — for the
 * content `"Òrìṣà Ògún"`:
 *
 *   ensure_ascii=True   -> f5ceda251451b3571736436644e34ca50eca23ad68ea3e067934e5f8668c2337
 *   raw UTF-8 (correct) -> e24b148552d35adf425c92e2e701ee3be6b4c86dbfd5fa2cc84a4c922250ac3b
 *
 * This matters here more than almost anywhere else in the ecosystem, because
 * Kóòdù's vocabulary is Yorùbá and nearly every ritual name carries diacritics.
 * `canonicalSerialize` is pinned by a test against that exact vector.
 */

import crypto from 'crypto';

// === The shared wire contract ===
// Each constant is owned by another component and mirrored here, never
// invented. Changing one in isolation breaks interoperability silently.

/** NIP-AE agent engram. Owner: minipae (KIND_AGENT_ENGRAM). */
export const KIND_AGENT_ENGRAM = 30174;
/** Crucible falsifiable claim. Owner: crucible-core::kinds::CLAIM. */
export const KIND_CLAIM = 47001;
/** NIP-42 relay auth. Owner: minipae (KIND_AUTH). */
export const KIND_AUTH = 22242;
/** Crucible's reserved block. Kóòdù must never mint a kind inside it. */
export const CRUCIBLE_RESERVED = [47000, 48000];

/** Slug namespace for everything Kóòdù writes. */
export const SLUG_PREFIX = 'mem/koodu';

/**
 * True when `kind` is one Kóòdù is allowed to publish under.
 *
 * Deliberately NOT a mirror of the relay's allowlist. That allowlist is a
 * large match arm in `required_scope_for_kind` covering most of Buzz's own
 * vocabulary (kind 1, 7, 30023, 30315 and many more), and a copy here would
 * drift out of sync silently while claiming an authority this module does not
 * have. What this states is narrower and checkable: the kinds Kóòdù emits.
 *
 * A `false` therefore means "not ours", never "the relay would refuse it".
 * The relay does reject kinds with no match arm — after authentication
 * succeeds, which reads like an auth failure and is not one — so checking
 * locally still turns a caller's mistake into a clear error at the call site.
 */
export function isPublishable(kind) {
  return kind === KIND_AGENT_ENGRAM || kind === KIND_CLAIM || kind === KIND_AUTH;
}

/**
 * Serialize an event into the exact byte string NIP-01 hashes.
 *
 * `JSON.stringify` is correct here precisely because it does not escape
 * non-ASCII — see the module note. Do not "fix" this by adding escaping.
 */
export function canonicalSerialize({ pubkey, created_at, kind, tags, content }) {
  return JSON.stringify([0, pubkey, created_at, kind, tags, content]);
}

/** Compute a NIP-01 event id (sha256 of the canonical serialization, hex). */
export function eventId(event) {
  return crypto
    .createHash('sha256')
    .update(canonicalSerialize(event), 'utf8')
    .digest('hex');
}

/**
 * Build a canonical unsigned event with its id filled in.
 *
 * The returned object is complete except for `sig`. A signer that owns the
 * agent's key signs `id` and attaches the signature; it must not recompute or
 * alter any other field, or the id stops matching what was signed.
 *
 * @throws if `kind` would be rejected by the relay allowlist.
 */
export function buildUnsignedEvent({ pubkey, kind, content, tags = [], createdAt }) {
  if (!isPublishable(kind)) {
    throw new Error(`kind ${kind} is not one Kóòdù publishes under`);
  }
  if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(pubkey)) {
    throw new Error('pubkey must be 64 hex characters (x-only secp256k1)');
  }

  const event = {
    pubkey,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
    kind,
    tags,
    content,
  };
  event.id = eventId(event);
  return event;
}

/**
 * The wire body of a Kóòdù gate decision.
 *
 * Flat and self-describing so a Rust, Julia or Python reader can interpret it
 * without Kóòdù's own modules.
 */
export function gateRecord({
  ritual,
  day,
  orisha,
  element,
  allowed,
  reason,
  btcHeight = null,
}) {
  return {
    ritual,
    day,
    orisha,
    element,
    allowed,
    reason,
    btc_height: btcHeight,
  };
}

/** Slug for one gate decision. */
export function slugGate(ritual, day) {
  return `${SLUG_PREFIX}/gate/${day}/${ritual}`;
}

/**
 * Build the unsigned engram (kind:30174) carrying a gate decision.
 *
 * `dTag` is the HMAC'd slug. Kóòdù cannot compute it — the HMAC key is derived
 * from the agent's secret — so the signer supplies it. Passing the raw slug
 * here would publish it in the clear and defeat the reason minipae hashes it.
 */
export function gateEngram({ pubkey, record, ownerPubkey, dTag, createdAt }) {
  if (!dTag) {
    throw new Error(
      'dTag is required: the slug must be HMACd by the key owner, never published raw',
    );
  }
  return buildUnsignedEvent({
    pubkey,
    kind: KIND_AGENT_ENGRAM,
    content: JSON.stringify(record),
    tags: [
      ['d', dTag],
      ['p', ownerPubkey],
      ['orisha', record.orisha],
      ['gates', String(record.allowed)],
    ],
    createdAt,
  });
}

/**
 * Build the unsigned Crucible claim (kind:47001) asserting a gate decision was
 * correct.
 *
 * Crucible's one rule: an assertion must say how it could be proven wrong. A
 * claim without a falsifier is rejected at parse time, so this throws rather
 * than emitting one that will bounce.
 */
export function gateClaim({ pubkey, statement, falsifier, ritual, halfLifeSecs = 86400, createdAt }) {
  if (!falsifier) {
    throw new Error('a Crucible claim requires a falsifier; Crucible rejects claims without one');
  }
  return buildUnsignedEvent({
    pubkey,
    kind: KIND_CLAIM,
    content: JSON.stringify({
      statement,
      falsifier,
      ritual,
      half_life_secs: halfLifeSecs,
    }),
    tags: [
      ['falsifier', falsifier],
      ['ritual', ritual],
      ['half_life', String(halfLifeSecs)],
    ],
    createdAt,
  });
}

export default {
  KIND_AGENT_ENGRAM,
  KIND_CLAIM,
  KIND_AUTH,
  SLUG_PREFIX,
  isPublishable,
  canonicalSerialize,
  eventId,
  buildUnsignedEvent,
  gateRecord,
  slugGate,
  gateEngram,
  gateClaim,
};
