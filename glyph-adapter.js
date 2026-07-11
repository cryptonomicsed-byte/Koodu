import crypto from 'crypto';
import https from 'https';
import http from 'http';

/**
 * GlyphMeshAdapter — permissioned GlyphIndex memory sharing over the Block Mesh.
 *
 * Companion to mesh-adapter.js: where that adapter emits resonance/trust
 * signals, this one publishes and validates *memory capability cards* —
 * signed offers that let a neighbor query a permitted slice of an agent's
 * sealed glyph vault (spec: OSOVM/GLYPHINDEX_SPEC.md; canonical reference:
 * Vantage/backend/glyph_index.py). Plaintext never crosses the mesh: cards
 * carry glyph metadata + Walrus blob ids; the requester decrypts only what
 * its grant covers, with keys it received out-of-band from the owner.
 */

// ── GIX-FOLD-v1 (identical constants in every ecosystem repo) ───────────────

const FOLD_RANGES = [
  [0x0020, 0xd7ff - 0x0020 + 1],
  [0xe000, 0xfdcf - 0xe000 + 1],
  [0xfdf0, 0xfffd - 0xfdf0 + 1],
];
const FOLD_TOTAL = FOLD_RANGES.reduce((acc, [, count]) => acc + count, 0);

export function contentHash(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest();
}

export function glyphFold(digest) {
  if (digest.length !== 32) throw new Error('glyphFold requires a 32-byte digest');
  let rem = 0n;
  for (const byte of digest) rem = ((rem << 8n) | BigInt(byte)) % BigInt(FOLD_TOTAL);
  let idx = Number(rem);
  for (const [start, count] of FOLD_RANGES) {
    if (idx < count) return String.fromCodePoint(start + idx);
    idx -= count;
  }
  throw new Error('unreachable');
}

export function oduLink(digest) {
  return [digest[0], (digest[0] << 8) | digest[1]];
}

// ── memory capability cards ─────────────────────────────────────────────────

/**
 * Build a shareable capability card for a slice of the vault. `glyphs` is an
 * array of metadata entries ({ canonical_id, glyph, odu_composed, ts,
 * walrus_blob_id }); `grant` names the neighbor and scope. The card is
 * HMAC-signed with the owner's GIX mac key so Vantage/Zangbeto can verify it
 * wasn't reshaped in transit.
 */
export function buildCapabilityCard({ ownerWallet, agentId, glyphs, grant, macKey }) {
  const card = {
    kind: 'glyph_capability_card',
    version: 1,
    owner: ownerWallet,
    agent_id: agentId,
    grant: {
      neighbor_id: grant.neighborId,
      block_id: grant.blockId || 'default',
      scope: grant.scope || 'read',
      expires_at: grant.expiresAt || null,
    },
    glyphs: glyphs.map((g) => ({
      canonical_id: g.canonical_id,
      glyph: g.glyph,
      odu_composed: g.odu_composed,
      ts: g.ts,
      walrus_blob_id: g.walrus_blob_id || '',
    })),
    issued_at: Date.now() / 1000,
  };
  card.hmac = signCard(card, macKey);
  return card;
}

function canonicalCardBytes(card) {
  const { hmac, ...unsigned } = card;
  return Buffer.from(JSON.stringify(unsigned, Object.keys(unsigned).sort()), 'utf8');
}

export function signCard(card, macKey) {
  return crypto.createHmac('sha256', macKey).update(canonicalCardBytes(card)).digest('hex');
}

export function verifyCapabilityCard(card, macKey) {
  if (card.kind !== 'glyph_capability_card' || card.version !== 1) return false;
  if (card.grant?.expires_at && card.grant.expires_at < Date.now() / 1000) return false;
  const expected = signCard(card, macKey);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(card.hmac || '', 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Every glyph in a card must display as the fold of its canonical id. */
export function auditCardGlyphs(card) {
  return (card.glyphs || []).every((g) => {
    try {
      return glyphFold(Buffer.from(g.canonical_id, 'hex')) === g.glyph;
    } catch {
      return false;
    }
  });
}

// ── mesh transport (Vantage) ────────────────────────────────────────────────

function postJson(baseUrl, path, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const body = JSON.stringify(payload);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 10_000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data ? JSON.parse(data) : {});
          else reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

export class GlyphMeshAdapter {
  constructor({ vantageUrl = process.env.VANTAGE_URL || 'http://localhost:8000' } = {}) {
    this.vantageUrl = vantageUrl;
  }

  /** Publish a capability card to the neighborhood memory board. */
  async publishCard(card) {
    if (!auditCardGlyphs(card)) throw new Error('card failed glyph-name audit');
    try {
      return await postJson(this.vantageUrl, '/api/mesh/memory/cards', card);
    } catch (err) {
      console.warn(`[GLYPH] Vantage unreachable — card not published: ${err.message}`);
      return null;
    }
  }

  /** Ask a neighbor's vault (via Vantage) for the sealed blobs a card grants. */
  async requestSealed(card, canonicalIds) {
    const granted = new Set(card.glyphs.map((g) => g.canonical_id));
    const outside = canonicalIds.filter((id) => !granted.has(id));
    if (outside.length) throw new Error(`request exceeds grant: ${outside[0]}…`);
    return postJson(this.vantageUrl, '/api/mesh/memory/fetch', {
      owner: card.owner,
      agent_id: card.agent_id,
      canonical_ids: canonicalIds,
      card_hmac: card.hmac,
    });
  }
}

export default new GlyphMeshAdapter();
