// glyph-adapter — Block Mesh permissioned GlyphIndex sharing.
//
// Koodu's leg of the ecosystem GlyphIndex contract
// (spec: OSOVM/GLYPHINDEX_SPEC.md; canonical reference implementation:
// Vantage/backend/glyph_index.py). Peers on the Block Mesh exchange
// *metadata projections* (the cross-language wire snapshot), never
// plaintext: this adapter filters what leaves a node according to a
// permission grant, verifies inbound anchors keylessly, and merges
// accepted snapshots under the shared A2A rules.
//
// Run the conformance self-test:  node glyph-adapter.js

import crypto from 'crypto';

export const GIX1_EMPTY_ROOT =
  '58cc47f0d238cea8bb764f7a927a54b398c8baf5de0a2332c03008038c3fd9a8';

const FOLD_RANGES = [
  [0x0020, 0xd7ff - 0x0020 + 1],
  [0xe000, 0xfdcf - 0xe000 + 1],
  [0xfdf0, 0xfffd - 0xfdf0 + 1],
];
const FOLD_TOTAL = FOLD_RANGES.reduce((sum, [, count]) => sum + count, 0);

const sha256 = (data) => crypto.createHash('sha256').update(data).digest();

export function contentHash(text) {
  return sha256(Buffer.from(text, 'utf8'));
}

export function canonicalId(digest) {
  return Buffer.from(digest).toString('hex');
}

export function glyphFold(digest) {
  let rem = 0n;
  for (const byte of digest) rem = ((rem << 8n) | BigInt(byte)) % BigInt(FOLD_TOTAL);
  let idx = Number(rem);
  for (const [start, count] of FOLD_RANGES) {
    if (idx < count) return String.fromCodePoint(start + idx);
    idx -= count;
  }
  throw new Error('unreachable fold index');
}

export function oduLink(digest) {
  return { base: digest[0], composed: (digest[0] << 8) | digest[1] };
}

/** Keyless GIX1 envelope audit (same checks as Zangbeto / Zero / larql-glyph). */
export function gix1Audit(blob) {
  return (
    blob.length >= 34 &&
    blob[0] === 0x47 && blob[1] === 0x49 && blob[2] === 0x58 && blob[3] === 0x31 &&
    blob[4] === 1 && blob[5] <= 1
  );
}

/**
 * Merkle root over receipt pairs { canonical_id, blob_sha256 } — leaf =
 * SHA-256(id bytes || blob hash), sorted by id, odd leaf promoted.
 */
export function merkleRoot(receipts) {
  if (receipts.length === 0) return GIX1_EMPTY_ROOT;
  const sorted = [...receipts].sort((a, b) => (a.canonical_id < b.canonical_id ? -1 : 1));
  let level = sorted.map(({ canonical_id, blob_sha256 }) =>
    sha256(Buffer.concat([Buffer.from(canonical_id, 'hex'), Buffer.from(blob_sha256, 'hex')])),
  );
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i + 1 < level.length; i += 2) next.push(sha256(Buffer.concat([level[i], level[i + 1]])));
    if (level.length % 2 === 1) next.push(level[level.length - 1]);
    level = next;
  }
  return level[0].toString('hex');
}

/** Verify an inbound anchor: receipts must recompute to the claimed root. */
export function verifyAnchor(receipts, claimedRoot) {
  return merkleRoot(receipts) === claimedRoot;
}

/**
 * A Block Mesh permission grant decides what leaves this node:
 *   allowTags     — share only nodes carrying at least one of these tags
 *                   (empty/omitted = share every node)
 *   shareLocators — keep walrus_blob_id pointers (default false: peers get
 *                   addresses and structure, not expansion locators)
 *   relations     — edge relations to share (default: all)
 * Nodes always keep canonical_id / glyph / odu / ts / tags — that is the
 * metadata projection; plaintext never enters the wire format at all.
 */
export function filterSnapshot(wire, grant = {}) {
  const allowTags = grant.allowTags ?? [];
  const shareLocators = grant.shareLocators ?? false;
  const relations = grant.relations ?? null;
  const nodes = {};
  for (const [id, node] of Object.entries(wire.nodes)) {
    if (allowTags.length > 0 && !node.tags.some((tag) => allowTags.includes(tag))) continue;
    nodes[id] = { ...node, tags: [...node.tags], walrus_blob_id: shareLocators ? node.walrus_blob_id : null };
  }
  const edges = wire.edges.filter(
    (edge) => nodes[edge.from] && nodes[edge.to] && (relations === null || relations.includes(edge.relation)),
  );
  return { nodes, edges: edges.map((edge) => ({ ...edge })) };
}

/**
 * Merge a peer snapshot into the local one under the shared A2A rules:
 * tags union (byte-sorted), earliest ts wins, existing locators are never
 * dropped, edges union. Returns { wire, nodesAdded, edgesAdded }.
 */
export function mergeSnapshots(local, remote) {
  const nodes = {};
  for (const [id, node] of Object.entries(local.nodes)) nodes[id] = { ...node, tags: [...node.tags] };
  let nodesAdded = 0;
  for (const [id, theirs] of Object.entries(remote.nodes)) {
    const existing = nodes[id];
    if (!existing) {
      nodes[id] = { ...theirs, tags: [...theirs.tags] };
      nodesAdded += 1;
      continue;
    }
    existing.tags = [...new Set([...existing.tags, ...theirs.tags])].sort();
    existing.ts = Math.min(existing.ts, theirs.ts);
    existing.walrus_blob_id = existing.walrus_blob_id ?? theirs.walrus_blob_id;
  }
  const seen = new Set(local.edges.map((e) => `${e.from} ${e.to} ${e.relation}`));
  const edges = local.edges.map((e) => ({ ...e }));
  let edgesAdded = 0;
  for (const edge of remote.edges) {
    const key = `${edge.from} ${edge.to} ${edge.relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ ...edge });
    edgesAdded += 1;
  }
  edges.sort((a, b) =>
    a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : a.relation < b.relation ? -1 : 1,
  );
  return { wire: { nodes, edges }, nodesAdded, edgesAdded };
}

/**
 * Group node ids by base Odù — the mesh routing hook: neighbors whose
 * vaults share Odù lineages score higher affinity (mesh-adapter.js pairs
 * this with its elemental affinity table).
 */
export function groupByOduBase(wire) {
  const groups = new Map();
  for (const [id, node] of Object.entries(wire.nodes)) {
    if (!groups.has(node.odu_base)) groups.set(node.odu_base, []);
    groups.get(node.odu_base).push(id);
  }
  for (const ids of groups.values()) ids.sort();
  return groups;
}

// ---- conformance self-test --------------------------------------------------

function buildNode(chunk, ts, tags = [], locator = null) {
  const digest = contentHash(chunk);
  const { base, composed } = oduLink(digest);
  return {
    canonical_id: canonicalId(digest),
    glyph: glyphFold(digest),
    odu_base: base,
    odu_composed: composed,
    ts,
    tags: [...tags].sort(),
    walrus_blob_id: locator,
  };
}

function selfTest() {
  const assert = (cond, label) => {
    if (!cond) throw new Error(`conformance failure: ${label}`);
  };

  // Frozen fold vectors (shared by every leg of the contract).
  const frozen = [
    ['Àṣẹ', 21841, 227, 58152],
    ['hello', 23636, 44, 11506],
    ['GlyphIndex', 13726, 68, 17595],
    ['😊🚀 Unicode test', 64591, 189, 48626],
    ['Ọ̀rúnmìlà', 17963, 204, 52390],
  ];
  for (const [text, codepoint, base, composed] of frozen) {
    const digest = contentHash(text);
    assert(glyphFold(digest).codePointAt(0) === codepoint, `fold ${text}`);
    const odu = oduLink(digest);
    assert(odu.base === base && odu.composed === composed, `odu ${text}`);
  }

  // Merkle vectors: frozen empty root + the cross-language deterministic root
  // over the golden-fixture ids with blob_sha256 = SHA-256(ascii id).
  assert(merkleRoot([]) === GIX1_EMPTY_ROOT, 'empty merkle root');
  const receipts = frozen.map(([text]) => {
    const id = canonicalId(contentHash(text));
    return { canonical_id: id, blob_sha256: sha256(Buffer.from(id, 'ascii')).toString('hex') };
  });
  const root = merkleRoot(receipts);
  assert(root === 'b6c97879f0b04824c626cef414c8be9f459abd853743e013b25ccb34256015ed', 'merkle vector root');
  assert(verifyAnchor(receipts, root), 'anchor verifies');
  assert(!verifyAnchor(receipts.slice(1), root), 'withheld blob detected');

  // Permissioned sharing: grants filter tags/locators/relations.
  const a = buildNode('mesh chunk A', 1, ['topic:mesh', 'private:wallet'], 'mnemopi://default/m1');
  const b = buildNode('mesh chunk B', 2, ['topic:mesh']);
  const c = buildNode('secret chunk', 3, ['private:wallet']);
  const wire = {
    nodes: { [a.canonical_id]: a, [b.canonical_id]: b, [c.canonical_id]: c },
    edges: [
      { from: a.canonical_id, to: b.canonical_id, relation: 'follows' },
      { from: a.canonical_id, to: c.canonical_id, relation: 'rem-cluster' },
    ],
  };
  const shared = filterSnapshot(wire, { allowTags: ['topic:mesh'], relations: ['follows'] });
  assert(Object.keys(shared.nodes).length === 2, 'grant filters nodes');
  assert(shared.edges.length === 1 && shared.edges[0].relation === 'follows', 'grant filters relations');
  assert(shared.nodes[a.canonical_id].walrus_blob_id === null, 'locators stripped by default');
  assert(wire.nodes[a.canonical_id].walrus_blob_id !== null, 'local wire untouched');

  // A2A merge rules: union, earliest ts, locator kept, idempotent.
  const localNode = buildNode('shared chunk', 0);
  const local = { nodes: { [localNode.canonical_id]: localNode }, edges: [] };
  const peerNode = buildNode('shared chunk', 99, ['from:peer'], 'walrus://peer/blob');
  const freshNode = buildNode('only theirs', 3);
  const remote = {
    nodes: { [peerNode.canonical_id]: peerNode, [freshNode.canonical_id]: freshNode },
    edges: [{ from: peerNode.canonical_id, to: freshNode.canonical_id, relation: 'rem-cluster' }],
  };
  const merged = mergeSnapshots(local, remote);
  assert(merged.nodesAdded === 1 && merged.edgesAdded === 1, 'merge stats');
  const kept = merged.wire.nodes[localNode.canonical_id];
  assert(kept.ts === 0, 'earliest ts wins');
  assert(kept.walrus_blob_id === 'walrus://peer/blob', 'locator adopted');
  assert(kept.tags.includes('from:peer'), 'tags union');
  const again = mergeSnapshots(merged.wire, remote);
  assert(again.nodesAdded === 0 && again.edgesAdded === 0, 'merge idempotent');

  // GIX1 audit + Odù grouping.
  const blob = Buffer.concat([Buffer.from('GIX1'), Buffer.from([1, 0]), Buffer.alloc(28)]);
  assert(gix1Audit(blob), 'gix1 audit accepts');
  blob[4] = 9;
  assert(!gix1Audit(blob), 'bad version rejected');
  const groups = groupByOduBase(wire);
  assert([...groups.values()].reduce((n, ids) => n + ids.length, 0) === 3, 'odu grouping covers all nodes');

  console.log('glyph-adapter conformance ok');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  selfTest();
}
