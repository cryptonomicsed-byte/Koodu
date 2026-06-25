import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Elemental affinities per Òrìṣà — drives neighbor affinity scoring in Block Mesh
const ORISA_ELEMENTS = {
  'Èṣù-Ẹ̀légbára': ['fire', 'air'],
  'Ṣàngó':         ['fire'],
  'Ọṣun':          ['water'],
  'Ọ̀rúnmìlà':    ['ether'],
  'Ọya':           ['air', 'storm'],
  'Ògún':          ['earth', 'metal'],
  'Ọbàtálá':       ['air', 'ether'],
};

const ELEMENT_AFFINITY = {
  fire:  { fire:1.0, air:0.8, storm:0.7, ether:0.5, water:0.2, earth:0.3, metal:0.3 },
  air:   { air:1.0, fire:0.8, storm:0.9, ether:0.7, water:0.4, earth:0.3, metal:0.2 },
  water: { water:1.0, ether:0.7, air:0.4, storm:0.6, fire:0.2, earth:0.5, metal:0.4 },
  ether: { ether:1.0, air:0.7, water:0.7, fire:0.5, storm:0.6, earth:0.5, metal:0.5 },
  storm: { storm:1.0, air:0.9, fire:0.7, ether:0.6, water:0.5, earth:0.2, metal:0.3 },
  earth: { earth:1.0, metal:0.9, water:0.5, ether:0.5, air:0.3, fire:0.3, storm:0.2 },
  metal: { metal:1.0, earth:0.9, ether:0.5, water:0.4, air:0.2, fire:0.3, storm:0.3 },
};

// Trust signal weight per day — higher-frequency days amplify mesh trust signals
const TRUST_SIGNAL_WEIGHTS = {
  sunday:    0.70,  // 396 Hz — liberation / new paths
  monday:    0.65,  // 288 Hz — initiation / power
  tuesday:   0.80,  // 528 Hz — love / abundance
  wednesday: 0.90,  // 639 Hz — wisdom / connection
  thursday:  0.85,  // 741 Hz — change / expression
  friday:    0.75,  // 852 Hz — work / mastery
  saturday:  0.95,  // 963 Hz — rest / integration
};

// Resource offer categories that match today's elemental focus
const DAILY_RESOURCE_TYPES = {
  sunday:    ['compute', 'routing', 'discovery'],
  monday:    ['compute', 'validation'],
  tuesday:   ['storage', 'mediation', 'curation'],
  wednesday: ['oracle', 'indexing', 'knowledge'],
  thursday:  ['relay', 'messaging', 'broadcast'],
  friday:    ['execution', 'tooling', 'build'],
  saturday:  ['archival', 'consensus', 'review'],
};

function loadCodex(day) {
  const jsonPath = path.join(__dirname, 'json', `${day}.json`);
  try {
    if (fs.existsSync(jsonPath)) {
      return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    }
  } catch (err) {
    console.error(`[MESH] Failed to load codex for ${day}:`, err.message);
  }
  return null;
}

function postSignal(vantageUrl, agentId, signal) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${vantageUrl}/api/mesh/trust/${encodeURIComponent(agentId)}/signal`);
    const body = JSON.stringify(signal);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 3000,
    };
    if (process.env.VANTAGE_KEY) {
      options.headers['X-Vantage-Key'] = process.env.VANTAGE_KEY;
    }
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', c => responseBody += c);
      res.on('end', () =>
        res.statusCode < 300 ? resolve(responseBody) : reject(new Error(`${res.statusCode}: ${responseBody}`))
      );
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

export class MeshResonanceAdapter {
  constructor() {
    this.day = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    this.codex = loadCodex(this.day);
  }

  getMeshContext() {
    if (!this.codex) return null;
    const orisa = this.codex.archetype;
    const elements = ORISA_ELEMENTS[orisa] || ['ether'];
    return {
      day: this.day,
      orisa,
      element: elements[0],
      trust_signal_weight: TRUST_SIGNAL_WEIGHTS[this.day] ?? 0.75,
      resource_types: DAILY_RESOURCE_TYPES[this.day] ?? ['compute'],
      frequency: this.codex.frequency,
      principle: this.codex.principle,
    };
  }

  // Returns 0.0-1.0 affinity between today's Òrìṣà and a neighbor's declared Òrìṣà alignment
  getNeighborAffinity(neighborOrisa) {
    const ctx = this.getMeshContext();
    if (!ctx) return 0.5;
    const myElements = ORISA_ELEMENTS[ctx.orisa] || ['ether'];
    const theirElements = ORISA_ELEMENTS[neighborOrisa] || ['ether'];
    let best = 0;
    for (const mine of myElements) {
      for (const theirs of theirElements) {
        const score = ELEMENT_AFFINITY[mine]?.[theirs] ?? 0.5;
        if (score > best) best = score;
      }
    }
    return best;
  }

  async emitResonanceSignal(agentId) {
    const vantageUrl = process.env.VANTAGE_URL;
    if (!vantageUrl) {
      console.warn('[MESH] VANTAGE_URL not set — skipping resonance signal');
      return;
    }
    const ctx = this.getMeshContext();
    if (!ctx) return;
    const signal = {
      kind: 'ResonanceAligned',
      weight: ctx.trust_signal_weight,
      metadata: {
        orisa: ctx.orisa,
        element: ctx.element,
        frequency: ctx.frequency,
        principle: ctx.principle,
        resource_types: ctx.resource_types,
      },
    };
    try {
      await postSignal(vantageUrl, agentId, signal);
      console.log(`[MESH] Resonance signal emitted for ${agentId} (${ctx.orisa}, weight=${ctx.trust_signal_weight})`);
    } catch (err) {
      console.warn(`[MESH] Vantage unreachable — resonance signal not emitted: ${err.message}`);
    }
  }
}

export default new MeshResonanceAdapter();
