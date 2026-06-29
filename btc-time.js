/**
 * BTC Time — Sacred Blockchain Clock
 * 
 * Bitcoin's block height as a sovereign time standard.
 * 1 BTC day = 144 blocks (~10 min each = 1440 minutes).
 * Maps block height to the 7-day Òrìṣà cycle, halving epochs,
 * and the 1440-wallet minute grid from Osovm.
 * 
 * No external dependencies — pure math from genesis block.
 */

// Genesis: 2009-01-03T18:15:05Z
const BTC_GENESIS_MS = 1231006505000;
const BLOCKS_PER_DAY = 144;
const BLOCKS_PER_WEEK = BLOCKS_PER_DAY * 7;        // 1008
const BLOCKS_PER_HALVING = 210000;
const MINUTES_PER_BLOCK = 10;
const SATS_PER_BTC = 100_000_000;

// Initial reward schedule
const INITIAL_REWARD = 50;

// Halving epoch names — alchemical stages of the chain
const HALVING_EPOCHS = [
  { era: 0, name: 'Genesis Fire',      reward: 50,    alchemy: 'Calcination',   element: 'Fire'  },
  { era: 1, name: 'First Reduction',   reward: 25,    alchemy: 'Dissolution',   element: 'Water' },
  { era: 2, name: 'Second Reduction',  reward: 12.5,  alchemy: 'Separation',    element: 'Air'   },
  { era: 3, name: 'Third Reduction',   reward: 6.25,  alchemy: 'Conjunction',   element: 'Earth' },
  { era: 4, name: 'Fourth Reduction',  reward: 3.125, alchemy: 'Fermentation',  element: 'Ether' },
  { era: 5, name: 'Fifth Reduction',   reward: 1.5625,alchemy: 'Distillation',  element: 'Spirit'},
  { era: 6, name: 'Sixth Reduction',   reward: 0.78125,alchemy:'Coagulation',   element: 'Void'  },
];

// The 7 Òrìṣà mapped to BTC weekday cycle (0-6)
const BTC_ORISA_CYCLE = [
  'Èṣù-Ẹ̀légbára',  // BTC Sunday (block % 1008 → day 0)
  'Ṣàngó',           // BTC Monday
  'Ọṣun',            // BTC Tuesday
  'Ọ̀rúnmìlà',       // BTC Wednesday
  'Ọya',             // BTC Thursday
  'Ògún',            // BTC Friday
  'Ọbàtálá',         // BTC Saturday (Sabbath)
];

class BTCTime {
  /**
   * @param {number} [blockHeight] - Current block height. If omitted, estimates from wall clock.
   */
  constructor(blockHeight) {
    this.blockHeight = blockHeight ?? this.estimateBlockHeight();
  }

  /**
   * Estimates current block height from wall-clock time.
   * Approximate — real integrations should feed actual block height.
   */
  estimateBlockHeight() {
    const elapsed = Date.now() - BTC_GENESIS_MS;
    const minutesElapsed = elapsed / 60000;
    return Math.floor(minutesElapsed / MINUTES_PER_BLOCK);
  }

  /**
   * BTC Day number since genesis
   */
  get btcDay() {
    return Math.floor(this.blockHeight / BLOCKS_PER_DAY);
  }

  /**
   * BTC Week number since genesis
   */
  get btcWeek() {
    return Math.floor(this.blockHeight / BLOCKS_PER_WEEK);
  }

  /**
   * Day index within the current BTC week (0–6)
   */
  get btcWeekday() {
    return Math.floor((this.blockHeight % BLOCKS_PER_WEEK) / BLOCKS_PER_DAY);
  }

  /**
   * The Òrìṣà aligned with the current BTC weekday
   */
  get btcOrisa() {
    return BTC_ORISA_CYCLE[this.btcWeekday];
  }

  /**
   * Whether BTC time says it's Sabbath (Ọbàtálá day = index 6)
   */
  get isSabbath() {
    return this.btcWeekday === 6;
  }

  /**
   * Current halving era (0-based)
   */
  get halvingEra() {
    return Math.floor(this.blockHeight / BLOCKS_PER_HALVING);
  }

  /**
   * Blocks until the next halving event
   */
  get blocksUntilHalving() {
    return BLOCKS_PER_HALVING - (this.blockHeight % BLOCKS_PER_HALVING);
  }

  /**
   * Current block reward in BTC
   */
  get blockReward() {
    const era = this.halvingEra;
    if (era >= 64) return 0; // all BTC mined
    return INITIAL_REWARD / Math.pow(2, era);
  }

  /**
   * Maps the current block to a minute slot in the 1440-wallet grid.
   * block % 1440 → one of the 1440 sacred minutes.
   */
  get minuteSlot() {
    return this.blockHeight % 1440;
  }

  /**
   * Returns the halving epoch metadata
   */
  get epoch() {
    const era = this.halvingEra;
    if (era < HALVING_EPOCHS.length) {
      return HALVING_EPOCHS[era];
    }
    return {
      era,
      name: `Era ${era}`,
      reward: this.blockReward,
      alchemy: 'Beyond Coagulation',
      element: 'Pure Light'
    };
  }

  /**
   * Percentage of total BTC supply already mined
   */
  get supplyMined() {
    let total = 0;
    for (let e = 0; e < this.halvingEra && e < 64; e++) {
      total += BLOCKS_PER_HALVING * (INITIAL_REWARD / Math.pow(2, e));
    }
    // Add blocks in current era
    const blocksInEra = this.blockHeight % BLOCKS_PER_HALVING;
    total += blocksInEra * this.blockReward;
    return Math.min(total / 21_000_000, 1.0);
  }

  /**
   * Full BTC time snapshot for ritual integration
   */
  snapshot() {
    return {
      block_height: this.blockHeight,
      btc_day: this.btcDay,
      btc_week: this.btcWeek,
      btc_weekday: this.btcWeekday,
      btc_orisa: this.btcOrisa,
      is_sabbath: this.isSabbath,
      halving_era: this.halvingEra,
      blocks_until_halving: this.blocksUntilHalving,
      block_reward: this.blockReward,
      epoch: this.epoch,
      minute_slot: this.minuteSlot,
      supply_mined: parseFloat((this.supplyMined * 100).toFixed(4)),
      timestamp: new Date().toISOString()
    };
  }
}

export { BTCTime, BTC_ORISA_CYCLE, HALVING_EPOCHS };
export default BTCTime;
