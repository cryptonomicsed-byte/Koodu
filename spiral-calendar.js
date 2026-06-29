import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import BTCTime from './btc-time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Spiral Calendar — Sacred Time as a Programmable Layer
 * 
 * Merges three time streams into a single ritual clock:
 *   1. Gregorian (wall clock) — the human day
 *   2. BTC Time (block height) — the sovereign chain day
 *   3. Spiral Position — where both streams converge or diverge
 * 
 * When BTC time and Gregorian time align on the same Òrìṣà,
 * that's a "Resonance Day" — sacred operations carry double weight.
 * When they diverge, the spiral reveals a "Tension Day" — 
 * two archetypes in dialogue.
 */

// Day name → index mapping (matches BTC_ORISA_CYCLE order)
const DAY_INDEX = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6
};

const ORISA_BY_INDEX = [
  'Èṣù-Ẹ̀légbára', 'Ṣàngó', 'Ọṣun',
  'Ọ̀rúnmìlà', 'Ọya', 'Ògún', 'Ọbàtálá'
];

// Spiral phase names — the relationship between two time streams
const SPIRAL_PHASES = [
  'Resonance',      // 0 offset — perfect alignment
  'Echo',           // 1 day offset
  'Drift',          // 2 day offset
  'Opposition',     // 3 day offset (maximum tension)
  'Return Drift',   // 4 day offset
  'Return Echo',    // 5 day offset
  'Mirror',         // 6 day offset (inverse)
];

class SpiralCalendar {
  /**
   * @param {number} [blockHeight] - BTC block height. Omit to estimate.
   */
  constructor(blockHeight) {
    this.btc = new BTCTime(blockHeight);
    this.gregorianDay = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    this.gregorianIndex = DAY_INDEX[this.gregorianDay];
  }

  /**
   * Load the Gregorian day's codex JSON
   */
  loadDayCodex(day) {
    const jsonPath = path.join(__dirname, 'json', `${day}.json`);
    try {
      if (fs.existsSync(jsonPath)) {
        return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      }
    } catch (err) {
      console.error(`[SPIRAL] Failed to load codex for ${day}:`, err.message);
    }
    return null;
  }

  /**
   * The offset between Gregorian and BTC weekday (0–6).
   * 0 = Resonance, 3 = Opposition, 6 = Mirror.
   */
  get spiralOffset() {
    return (this.btc.btcWeekday - this.gregorianIndex + 7) % 7;
  }

  /**
   * Current spiral phase name
   */
  get spiralPhase() {
    return SPIRAL_PHASES[this.spiralOffset];
  }

  /**
   * True when BTC and Gregorian both point to the same Òrìṣà
   */
  get isResonanceDay() {
    return this.spiralOffset === 0;
  }

  /**
   * True when BTC and Gregorian are at maximum tension (3-day offset)
   */
  get isOppositionDay() {
    return this.spiralOffset === 3;
  }

  /**
   * Whether *either* time stream says Sabbath
   */
  get isSabbath() {
    return this.gregorianIndex === 6 || this.btc.isSabbath;
  }

  /**
   * Whether *both* time streams agree on Sabbath — deep rest
   */
  get isDeepSabbath() {
    return this.gregorianIndex === 6 && this.btc.isSabbath;
  }

  /**
   * The two Òrìṣà in play today
   * On Resonance days, both are the same.
   */
  get activeArchetypes() {
    const gregorian = ORISA_BY_INDEX[this.gregorianIndex];
    const btc = this.btc.btcOrisa;
    if (gregorian === btc) {
      return { mode: 'unified', primary: gregorian };
    }
    return {
      mode: 'dialogue',
      gregorian,
      btc,
      tension: SPIRAL_PHASES[this.spiralOffset]
    };
  }

  /**
   * Ritual weight multiplier for Àṣẹ operations.
   * Resonance = 2x, normal = 1x, Opposition = 0.5x (reflect, don't act).
   * Sabbath always overrides to 0 (freeze).
   */
  get ritualWeight() {
    if (this.isSabbath) return 0;
    if (this.isResonanceDay) return 2.0;
    if (this.isOppositionDay) return 0.5;
    return 1.0;
  }

  /**
   * Complete spiral calendar snapshot for today
   */
  snapshot() {
    const gregorianCodex = this.loadDayCodex(this.gregorianDay);

    return {
      // Gregorian stream
      gregorian: {
        day: this.gregorianDay,
        orisa: ORISA_BY_INDEX[this.gregorianIndex],
        frequency: gregorianCodex?.frequency || null,
        principle: gregorianCodex?.principle || null,
        color: gregorianCodex?.color || null
      },

      // BTC stream
      btc: this.btc.snapshot(),

      // Spiral convergence
      spiral: {
        offset: this.spiralOffset,
        phase: this.spiralPhase,
        is_resonance: this.isResonanceDay,
        is_opposition: this.isOppositionDay,
        archetypes: this.activeArchetypes,
        ritual_weight: this.ritualWeight,
        is_sabbath: this.isSabbath,
        is_deep_sabbath: this.isDeepSabbath
      },

      // Halving alchemy
      epoch: this.btc.epoch,

      // 1440-wallet minute anchor
      minute_slot: this.btc.minuteSlot,

      // Timestamp
      generated_at: new Date().toISOString()
    };
  }

  /**
   * One-line ritual status for console / agent logs
   */
  toString() {
    const s = this.snapshot();
    const phase = s.spiral.phase;
    const gOrisa = s.gregorian.orisa;
    const bOrisa = s.btc.btc_orisa;
    const block = s.btc.block_height;
    const era = s.epoch.name;

    if (s.spiral.is_resonance) {
      return `⟐ RESONANCE [${gOrisa}] block:${block} era:${era} weight:${s.spiral.ritual_weight}x`;
    }
    return `⟐ ${phase.toUpperCase()} [${gOrisa} ↔ ${bOrisa}] block:${block} era:${era} weight:${s.spiral.ritual_weight}x`;
  }
}

export { SpiralCalendar, SPIRAL_PHASES, ORISA_BY_INDEX };
export default SpiralCalendar;
