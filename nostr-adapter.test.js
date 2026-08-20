/**
 * Tests for the Kóòdù → Nostr wire adapter.
 *
 * Run: node --test nostr-adapter.test.js
 * Zero dependencies — uses Node's built-in test runner, matching this repo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KIND_AGENT_ENGRAM,
  KIND_CLAIM,
  isPublishable,
  canonicalSerialize,
  eventId,
  buildUnsignedEvent,
  gateRecord,
  slugGate,
  gateEngram,
  gateClaim,
} from './nostr-adapter.js';

const PUBKEY = 'a'.repeat(64);

test('canonical serialization does not escape non-ASCII', () => {
  // The load-bearing interop property. Python's json.dumps escapes to \uXXXX
  // by default and computes a DIFFERENT id; since the signature is over the
  // id, that implementation's signatures fail everywhere else. Kóòdù's
  // vocabulary is Yorùbá, so nearly every event it builds hits this.
  const event = {
    pubkey: PUBKEY,
    created_at: 1700000000,
    kind: 30174,
    tags: [],
    content: 'Òrìṣà Ògún',
  };

  assert.ok(
    canonicalSerialize(event).includes('Òrìṣà Ògún'),
    'diacritics must survive serialization as raw UTF-8',
  );
  assert.ok(
    !canonicalSerialize(event).includes('\\u'),
    'no \\uXXXX escaping — that is the Python-default form and it is wrong here',
  );

  // Pinned against the value independently computed in Rust and in Python
  // with ensure_ascii=False.
  assert.equal(
    eventId(event),
    'e24b148552d35adf425c92e2e701ee3be6b4c86dbfd5fa2cc84a4c922250ac3b',
  );
});

test('event id is the sha256 of the canonical form, in NIP-01 field order', () => {
  const event = {
    pubkey: PUBKEY,
    created_at: 1700000000,
    kind: 30174,
    tags: [['d', 'abc']],
    content: 'x',
  };
  assert.equal(
    canonicalSerialize(event),
    `[0,"${PUBKEY}",1700000000,30174,[["d","abc"]],"x"]`,
  );
});

test('event id changes when any signed field changes', () => {
  const base = {
    pubkey: PUBKEY,
    created_at: 1700000000,
    kind: 30174,
    tags: [],
    content: 'x',
  };
  const id = eventId(base);
  assert.notEqual(id, eventId({ ...base, content: 'y' }));
  assert.notEqual(id, eventId({ ...base, created_at: 1700000001 }));
  assert.notEqual(id, eventId({ ...base, kind: 47001 }));
  assert.notEqual(id, eventId({ ...base, tags: [['d', 'a']] }));
});

test('every kind Kóòdù emits is publishable', () => {
  assert.ok(isPublishable(KIND_AGENT_ENGRAM));
  assert.ok(isPublishable(KIND_CLAIM));
  // The failure this guard exists to prevent: a plausible custom kind that the
  // relay drops after auth succeeds, which reads as an auth problem.
  assert.ok(!isPublishable(31337));
});

test('isPublishable does not claim the relay rejects other kinds', () => {
  // The relay accepts far more than Kóòdù emits — kind 1, 7, 30023, 30315 and
  // much of Buzz's vocabulary. false here means "not ours", never "refused".
  // Conflating the two sent an earlier draft of this module into
  // over-restricting, so this pins the distinction.
  assert.ok(!isPublishable(7));
  assert.ok(!isPublishable(1));
});

test('building an event under an unadmitted kind throws', () => {
  assert.throws(
    () => buildUnsignedEvent({ pubkey: PUBKEY, kind: 31337, content: '{}' }),
    /is not one Kóòdù publishes under/,
  );
});

test('a malformed pubkey is rejected before an id is computed', () => {
  assert.throws(
    () => buildUnsignedEvent({ pubkey: 'nope', kind: KIND_CLAIM, content: '{}' }),
    /64 hex characters/,
  );
  // 64 chars but not hex.
  assert.throws(
    () => buildUnsignedEvent({ pubkey: 'z'.repeat(64), kind: KIND_CLAIM, content: '{}' }),
    /64 hex characters/,
  );
});

test('an unsigned event is complete except for sig', () => {
  const event = buildUnsignedEvent({
    pubkey: PUBKEY,
    kind: KIND_CLAIM,
    content: '{}',
    createdAt: 1700000000,
  });
  for (const field of ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content']) {
    assert.ok(field in event, `missing ${field}`);
  }
  assert.ok(!('sig' in event), 'Kóòdù holds no keys and must not fabricate a sig');
  assert.equal(event.id, eventId(event));
});

test('a gate engram carries the d and p tags NIP-AE requires', () => {
  const record = gateRecord({
    ritual: 'ọjọ́-ògún-forge',
    day: 'Friday',
    orisha: 'Ògún',
    element: 'Earth + Metal',
    allowed: true,
    reason: 'within Ògún window',
  });
  const event = gateEngram({
    pubkey: PUBKEY,
    record,
    ownerPubkey: PUBKEY,
    dTag: 'deadbeef',
    createdAt: 1700000000,
  });

  const names = event.tags.map((t) => t[0]);
  assert.ok(names.includes('d'));
  assert.ok(names.includes('p'));
  assert.equal(event.kind, KIND_AGENT_ENGRAM);

  // A reader in another language must be able to parse the body.
  const decoded = JSON.parse(event.content);
  assert.equal(decoded.orisha, 'Ògún');
  assert.equal(decoded.allowed, true);
});

test('an engram refuses to publish a raw slug in place of an HMACd d tag', () => {
  // The reason minipae hashes the slug is so a relay operator cannot enumerate
  // what an agent stores. Kóòdù cannot compute the HMAC (it has no key), so
  // omitting it must fail loudly rather than silently leak.
  assert.throws(
    () =>
      gateEngram({
        pubkey: PUBKEY,
        record: gateRecord({ ritual: 'r', day: 'Friday', orisha: 'Ògún', element: 'Earth', allowed: true, reason: '' }),
        ownerPubkey: PUBKEY,
      }),
    /must be HMACd by the key owner/,
  );
});

test('slug is namespaced to koodu', () => {
  assert.ok(slugGate('forge', 'Friday').startsWith('mem/koodu/'));
});

test('a claim without a falsifier is refused rather than emitted', () => {
  // Crucible rejects such a claim at parse time; failing here gives a clear
  // error instead of a silent bounce at the relay.
  assert.throws(
    () => gateClaim({ pubkey: PUBKEY, statement: 's', ritual: 'r' }),
    /requires a falsifier/,
  );
});

test('a gate claim is a Crucible claim carrying its falsifier', () => {
  const event = gateClaim({
    pubkey: PUBKEY,
    statement: 'the forge ritual ran inside its Ògún window',
    falsifier: 'sha256:abc',
    ritual: 'ọjọ́-ògún-forge',
    createdAt: 1700000000,
  });
  assert.equal(event.kind, KIND_CLAIM);
  assert.ok(event.tags.some((t) => t[0] === 'falsifier' && t[1] === 'sha256:abc'));
  assert.equal(JSON.parse(event.content).half_life_secs, 86400);
});

test('yoruba ritual names round-trip through an event body intact', () => {
  const record = gateRecord({
    ritual: 'ọjọ́-ọ̀rúnmìlà-ìwúre',
    day: 'Wednesday',
    orisha: 'Ọ̀rúnmìlà',
    element: 'Ether',
    allowed: true,
    reason: 'ọjọ́ rú',
  });
  const event = gateEngram({
    pubkey: PUBKEY,
    record,
    ownerPubkey: PUBKEY,
    dTag: 'abc',
    createdAt: 1700000000,
  });
  const decoded = JSON.parse(event.content);
  assert.equal(decoded.ritual, 'ọjọ́-ọ̀rúnmìlà-ìwúre');
  assert.equal(decoded.orisha, 'Ọ̀rúnmìlà');
});
