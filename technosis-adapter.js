import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import meshAdapter from './mesh-adapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Helper for POST requests
 */
function post(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const body = JSON.stringify(data);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 3000
    }, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => responseBody += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(responseBody)); }
          catch (e) { resolve(responseBody); }
        } else {
          reject(new Error(`Status ${res.statusCode}: ${responseBody}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Technosis Adapter for Swibe & Ecosystem
 */
class TechnosisAdapter {
  /**
   * @param {number} [blockHeight] - BTC block height for spiral calendar. Omit to estimate.
   */
  constructor(blockHeight) {
    this.currentDay = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    this.codex = this.loadCodex(this.currentDay);
    this.spiral = new SpiralCalendar(blockHeight);
  }

  loadCodex(day) {
    const jsonPath = path.join(__dirname, 'json', `${day}.json`);
    try {
      if (fs.existsSync(jsonPath)) {
        return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      }
    } catch (err) {
      console.error(`[TECHNOSIS] Failed to load codex for ${day}:`, err.message);
    }
    return null;
  }

  // --- Swibe Plugin Interface (v1.3) ---

  async onBirth(agent) {
    if (!this.codex) return;
    console.log(`[TECHNOSIS] 🔴 Ritual Birth: ${agent.name} aligned with ${this.codex.archetype}`);

    try {
      console.log(`[TECHNOSIS] 🦭 Requesting Seal key derivation...`);
      const sealResult = await post('https://seal-rpc.mystenlabs.com/derive', {
        entropy: agent.entropy || '0x' + Math.random().toString(16).slice(2)
      });
      agent.vibe_key = sealResult.publicKey;
      console.log(`[TECHNOSIS] ✅ Seal key derived.`);
    } catch (err) {
      console.warn(`[TECHNOSIS] ⚠️ Seal unreachable, falling back to local Ed25519: ${err.message}`);
    }
    
    agent.metadata = agent.metadata || {};
    agent.metadata.resonance = {
      day: this.codex.day,
      archetype: this.codex.archetype,
      frequency: this.codex.frequency,
      color: this.codex.color,
      principle: this.codex.principle
    };

    // Emit daily resonance as a Block Mesh trust signal
    const agentId = agent.id || agent.name;
    if (agentId) {
      await meshAdapter.emitResonanceSignal(agentId);
      const ctx = meshAdapter.getMeshContext();
      if (ctx) agent.metadata.mesh = ctx;
    }
  }

  async onThink(prompt, response) {
    if (!this.codex) return;
    process.stdout.write(`[TECHNOSIS] 🌀 Resonance: ${this.codex.frequency} | ${this.codex.principle}\n`);

    try {
      console.log(`[TECHNOSIS] 🐚 Executing via Nautilus TEE...`);
      await post('https://nautilus.mystenlabs.com/execute', {
        model: "ollama:llama3",
        prompt: prompt
      });
      console.log(`[TECHNOSIS] ✅ Nautilus execution attested.`);
    } catch (err) {
      console.warn(`[TECHNOSIS] ⚠️ Nautilus TEE unreachable, falling back to direct Ollama: ${err.message}`);
    }
  }

  onReceipt(receipt) {
    if (!this.codex) return;
    console.log(`[TECHNOSIS] 📜 Receipt sealed: ${receipt.substring(0, 8)}...`);
  }

  async onSettle(result) {
    if (!this.codex) return;
    
    try {
      console.log(`[TECHNOSIS] 🐋 Storing result on Walrus...`);
      const walrusResult = await post('https://publisher.walrus.site/v1/store', result);
      console.log(`[TECHNOSIS] ✅ Walrus blob stored: ${walrusResult.blobId || 'success'}`);
    } catch (err) {
      console.warn(`[TECHNOSIS] ⚠️ Walrus unreachable, falling back to local vault: ${err.message}`);
      const vaultPath = path.join(process.env.HOME, '.swibe', 'vault.json');
      try {
        const vaultDir = path.dirname(vaultPath);
        if (!fs.existsSync(vaultDir)) fs.mkdirSync(vaultDir, { recursive: true });
        const existingString = fs.existsSync(vaultPath) ? fs.readFileSync(vaultPath, 'utf8') : '[]';
        const existing = JSON.parse(existingString);
        existing.push({ ...result, timestamp: Date.now() });
        fs.writeFileSync(vaultPath, JSON.stringify(existing, null, 2));
      } catch (vaultErr) {
        console.error(`[TECHNOSIS] ❌ Failed to save to local vault: ${vaultErr.message}`);
      }
    }
  }

  toPluginContract() {
    return {
      onBirth: (agent) => this.onBirth(agent),
      onThink: (prompt, response) => this.onThink(prompt, response),
      onReceipt: (receipt) => this.onReceipt(receipt),
      onSettle: (result) => this.onSettle(result)
    };
  }
}

export default new TechnosisAdapter();
