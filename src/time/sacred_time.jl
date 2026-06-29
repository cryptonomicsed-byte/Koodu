# Ritual-Codex v7 — Sacred Time System
# Bínò ÈL Guà — ọmọ Kọ́dà, aṣáájú ọ̀nà tuntun-tuntun

module SacredTime

using Dates, SHA

export BtcTime, from_block_height, is_sabbath, tick_to_minute
export SpiralTime, from_btc, current_veil, current_jubilee, is_eshu_squared
export Òrìṣà, ORISA_CYCLE, day_orisa, week_orisa, moon_orisa, year_orisa, jubilee_orisa
export RitualGate, check_gate, gate_economic_effect
export format_spiral, to_json, from_json

# =============================================================================
# CONSTANTS — Canonical Parameters
# =============================================================================

const BLOCKS_PER_DAY = 144        # 10 min/block × 144 = 1440 min
const BLOCKS_PER_MINUTE = 0.1     # inverse
const GENESIS_BLOCK = 780000      # Ọ̀ṢỌ́VM epoch start
const F1_THRESHOLD = 0.777        # From ecosystem spec
const TITHE_RATE = 0.0369         # Èṣù's tithe
const DAILY_MINT = 1440           # Àṣẹ per day

const ORISA_NAMES = ["Èṣù", "Ṣàngó", "Ọ̀ṣun", "Yemọja", "Ọ̀yá", "Ògún", "Ọbàtálá"]

@enum Òrìṣà begin
    Èṣù        = 0  # Crossroads, opener, trickster
    Ṣàngó      = 1  # Thunder, execution, power
    Ọ̀ṣun       = 2  # River, beauty, love
    Yemọja     = 3  # Ocean, nurture, motherhood
    Ọ̀yá        = 4  # Wind, change, transformation
    Ògún       = 5  # Iron, war, technology
    Ọbàtálá    = 6  # Clarity, justice, rest (Sabbath)
end

const ORISA_CYCLE = [Èṣù, Ṣàngó, Ọ̀ṣun, Yemọja, Ọ̀yá, Ògún, Ọbàtálá]

# =============================================================================
# BTC TIME — Block-Anchored Canonical Time
# =============================================================================

"""
    BtcTime

Deterministic time from Bitcoin block height.
Globally verifiable, tamper-resistant, 1440-minute day.
"""
struct BtcTime
    block_height::Int
    day_number::Int           # Days since GENESIS_BLOCK
    tick_number::Int          # 0–143 (minute-block within day)
    minute_of_day::Int        # 0–1439 (wall-clock minute)
    
    day_of_week::Int          # 0–6 (0=Èṣù/Sunday, 6=Ọbàtálá/Saturday)
    is_sabbath::Bool          # Saturday = settle-only
    is_jubilee_day::Bool      # 49×n = special reset
    is_eshu_node::Bool        # Position divisible by 12
end

function from_block_height(height::Int)::BtcTime
    @assert height >= GENESIS_BLOCK "Before Ọ̀ṢỌ́VM genesis at $GENESIS_BLOCK"
    
    relative = height - GENESIS_BLOCK
    day = div(relative, BLOCKS_PER_DAY)
    tick = mod(relative, BLOCKS_PER_DAY)
    minute = floor(Int, tick / BLOCKS_PER_MINUTE)
    
    # Sacred week: Èṣù starts (Sunday)
    dow = mod(day, 7)
    sabbath = (dow == 6)  # Ọbàtálá day = Saturday
    
    # Jubilee: every 49 days (7×7)
    jubilee_day = (mod(day, 49) == 48)  # Days 48, 97, 146...
    
    # Èṣù node: every 12 ticks (3+9 resonance)
    eshu_node = (mod(tick, 12) == 0)
    
    BtcTime(height, day, tick, minute, dow, sabbath, jubilee_day, eshu_node)
end

function is_sabbath(btc::BtcTime)::Bool
    btc.is_sabbath
end

function tick_to_minute(tick::Int)::Int
    floor(Int, tick / BLOCKS_PER_MINUTE)
end

# =============================================================================
# FIVE-LAYER ÒRÌṢÀ — Fractal Governance
# =============================================================================

function day_orisa(btc::BtcTime)::Òrìṣà
    ORISA_CYCLE[btc.day_of_week + 1]
end

function week_orisa(btc::BtcTime)::Òrìṣà
    week = div(btc.day_number, 7)
    ORISA_CYCLE[mod(week, 7) + 1]
end

function moon_orisa(btc::BtcTime)::Òrìṣà
    # 28-day "moon" = 4 weeks
    moon = div(btc.day_number, 28)
    ORISA_CYCLE[mod(moon, 7) + 1]
end

function year_orisa(btc::BtcTime)::Òrìṣà
    # 364-day year = 13 moons
    year = div(btc.day_number, 364)
    ORISA_CYCLE[mod(year, 7) + 1]
end

function jubilee_orisa(btc::BtcTime)::Òrìṣà
    # 50-year jubilee = 50 × 364 days
    jubilee = div(btc.day_number, 18200)
    ORISA_CYCLE[mod(jubilee, 7) + 1]
end

# =============================================================================
# SPIRAL TIME — Multi-Layer Sacred Calendar
# =============================================================================

"""
    SpiralTime

Five-layer Òrìṣà calendar + Veil cycles + Jubilee + Èṣù² nodes.
"""
struct SpiralTime
    btc::BtcTime
    
    # Five simultaneous Òrìṣà layers
    day_osa::Òrìṣà
    week_osa::Òrìṣà
    moon_osa::Òrìṣà
    year_osa::Òrìṣà
    jubilee_osa::Òrìṣà
    
    # Cycles
    veil_number::Int          # 1–50 (350-day cycle: 50 veils × 7 days)
    jubilee_cycle::Int        # 1–50 (50-year cycle)
    
    # Special nodes
    eshu_squared::Bool        # Èṣù²: veil divisible by 12
    capstone_day::Bool        # 7×7×7 = 343 days
    void_day::Bool            # Day 365 (or 366 in leap)
end

function from_btc(btc::BtcTime)::SpiralTime
    # Five Òrìṣà layers
    d_osa = day_orisa(btc)
    w_osa = week_orisa(btc)
    m_osa = moon_orisa(btc)
    y_osa = year_orisa(btc)
    j_osa = jubilee_orisa(btc)
    
    # Veil: 50 veils × 7 days = 350-day cycle
    veil = mod(btc.day_number, 350) + 1
    
    # Jubilee: 50-year cycle
    jubilee = div(btc.day_number, 18200) + 1
    
    # Èṣù²: trickster nodes at veil positions divisible by 12
    eshu_sq = (mod(veil, 12) == 0)
    
    # Capstone: 7×7×7 = 343 days (or 49×7)
    capstone = (mod(btc.day_number, 343) == 342)
    
    # Void day: day 364 (last day of 13×28 year)
    void = (mod(btc.day_number, 364) == 363)
    
    SpiralTime(btc, d_osa, w_osa, m_osa, y_osa, j_osa,
               veil, jubilee, eshu_sq, capstone, void)
end

function current_veil(spiral::SpiralTime)::Int
    spiral.veil_number
end

function current_jubilee(spiral::SpiralTime)::Int
    spiral.jubilee_cycle
end

function is_eshu_squared(spiral::SpiralTime)::Bool
    spiral.eshu_squared
end

# =============================================================================
# RITUAL GATES — Economic Effects
# =============================================================================

"""
    RitualGate

Time-based gates that affect economic behavior.
"""
@enum RitualGate begin
    NO_GATE
    SABBATH           # Saturday: settle-only, no new state
    JUBILEE_MINOR     # 7-year minor reset
    JUBILEE_MAJOR     # 49-year major reset (7×7)
    ÈṢÙ²              # Crossroad: tithe enforcement, branch/merge
    CAPSTONE          # 343-day pyramid completion
    VOID              # Day 365: out-of-time, pure ritual
end

function check_gate(spiral::SpiralTime)::RitualGate
    spiral.void_day && return VOID
    spiral.capstone_day && return CAPSTONE
    spiral.eshu_squared && return ÈṢÙ²
    spiral.btc.is_jubilee_day && return JUBILEE_MAJOR
    spiral.btc.is_sabbath && return SABBATH
    return NO_GATE
end

function gate_economic_effect(gate::RitualGate)::Dict{String,Any}
    effects = Dict(
        "minting_active" => true,
        "new_contracts_allowed" => true,
        "tithe_enforced" => false,
        "multiplier" => 1.0,
        "settle_only" => false
    )
    
    if gate == SABBATH
        effects["new_contracts_allowed"] = false
        effects["settle_only"] = true
        effects["multiplier"] = 1.1  # Clarity bonus
    elseif gate == ÈṢÙ²
        effects["tithe_enforced"] = true
        effects["multiplier"] = 1.369  # 3.69% as growth
    elseif gate == JUBILEE_MAJOR
        effects["debt_reset"] = true
        effects["treasury_redistribution"] = true
        effects["multiplier"] = 2.0
    elseif gate == VOID
        effects["minting_active"] = false
        effects["pure_ritual"] = true
    end
    
    effects
end

# =============================================================================
# FORMATTING & SERIALIZATION
# =============================================================================

function format_spiral(spiral::SpiralTime)::String
    gate = check_gate(spiral)
    effects = gate_economic_effect(gate)
    
    """
    ╔══════════════════════════════════════════════════════════════════╗
    ║  Ọ̀ṢỌ́VM SACRED TIME — Block $(spiral.btc.block_height)                    ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║  Wall: Day $(spiral.btc.day_number), Minute $(spiral.btc.minute_of_day)/1440        ║
    ║  Tick: $(spiral.btc.tick_number)/143 (BTC block-tick)                          ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║  ÒRÌṢÀ LAYERS                                                    ║
    ║    Day:    $(spiral.day_osa) ($(ORISA_NAMES[Int(spiral.day_osa)+1]))              ║
    ║    Week:   $(spiral.week_osa) ($(ORISA_NAMES[Int(spiral.week_osa)+1]))            ║
    ║    Moon:   $(spiral.moon_osa) ($(ORISA_NAMES[Int(spiral.moon_osa)+1]))           ║
    ║    Year:   $(spiral.year_osa) ($(ORISA_NAMES[Int(spiral.year_osa)+1]))           ║
    ║    Jubilee: $(spiral.jubilee_osa) ($(ORISA_NAMES[Int(spiral.jubilee_osa)+1]))    ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║  CYCLES                                                          ║
    ║    Veil: $(spiral.veil_number)/50    Jubilee: $(spiral.jubilee_cycle)/50          ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║  GATES: $(gate)                                                  ║
    ║    Èṣù²: $(spiral.eshu_squared)  |  Capstone: $(spiral.capstone_day)  |  Void: $(spiral.void_day)  ║
    ╠══════════════════════════════════════════════════════════════════╣
    ║  ECONOMIC EFFECTS                                                ║
    ║    Minting: $(effects["minting_active"]) | Contracts: $(effects["new_contracts_allowed"])  ║
    ║    Tithe: $(effects["tithe_enforced"]) | Multiplier: $(effects["multiplier"])x          ║
    ╚══════════════════════════════════════════════════════════════════╝
    """
end

function to_json(spiral::SpiralTime)::String
    dict = Dict(
        "block_height" => spiral.btc.block_height,
        "day_number" => spiral.btc.day_number,
        "tick_number" => spiral.btc.tick_number,
        "minute_of_day" => spiral.btc.minute_of_day,
        "day_of_week" => spiral.btc.day_of_week,
        "is_sabbath" => spiral.btc.is_sabbath,
        "five_layer_orisa" => Dict(
            "day" => ORISA_NAMES[Int(spiral.day_osa)+1],
            "week" => ORISA_NAMES[Int(spiral.week_osa)+1],
            "moon" => ORISA_NAMES[Int(spiral.moon_osa)+1],
            "year" => ORISA_NAMES[Int(spiral.year_osa)+1],
            "jubilee" => ORISA_NAMES[Int(spiral.jubilee_osa)+1]
        ),
        "veil_number" => spiral.veil_number,
        "jubilee_cycle" => spiral.jubilee_cycle,
        "gates" => Dict(
            "eshu_squared" => spiral.eshu_squared,
            "capstone" => spiral.capstone_day,
            "void" => spiral.void_day,
            "current" => string(check_gate(spiral))
        ),
        "economic_effects" => gate_economic_effect(check_gate(spiral))
    )
    JSON.json(dict)
end

# =============================================================================
# RITUAL-CODEX INTEGRATION — 7-Day + Spiral Overlay
# =============================================================================

"""
    DailyResonance

Enhanced 7-day resonance with spiral calendar overlay.
"""
struct DailyResonance
    day::String                    # Sunday–Saturday
    yoruba_name::String
    archetype::String
    
    # Spiral overlay
    spiral::SpiralTime
    veil_metadata::Dict{String,Any}
    
    # Ritual practice
    frequency_hz::Float64
    mantra::String
    crypto_activity::String
    hidden_message::String
end

function generate_daily_resonance(btc_height::Int)::DailyResonance
    btc = from_block_height(btc_height)
    spiral = from_btc(btc)
    
    # Base 7-day mapping (from existing ritual-codex)
    days = [
        ("Sunday", "Ọjọ́ Àìkú", "Èṣù-Ẹ̀légbára", 396.0,
          "I open the paths before me with clarity and courage.",
         "L1 tokens, gatekeeper access protocols",
         "The first step opens the journey — choose wisely."),
        ("Monday", "Ọjọ́ Ajé", "Ọ̀ṣun-Olódùmarè", 417.0,
         "I attract abundance through flow and right alignment.",
         "DeFi yields, liquidity provision, oracle staking",
         "Wealth follows those who serve the river's course."),
        ("Tuesday", "Ọjọ́ Ìṣẹ́gun", "Ṣàngó-Àrà", 528.0,
         "I speak truth with the force of thunder behind me.",
         "Governance votes, protocol upgrades, dispute resolution",
         "Justice without power is empty; power without justice is tyranny."),
        ("Wednesday", "Ọjọ́ Rú", "Ọ̀rúnmìlà-Ifá", 639.0,
         "I divine the pattern and walk the path of wisdom.",
         "Research, analysis, long-term strategy, vault management",
         "The oracle speaks in patterns — learn to read, not just hear."),
        ("Thursday", "Ọjọ́ Bọ̀", "Ògún-Onírè", 741.0,
         "I forge the path through obstacles with iron will.",
         "Development, deployment, infrastructure, hard tech",
         "The blade is useless without the arm that wields it."),
        ("Friday", "Ọjọ́ Ẹ̀tì", "Yemọja-Ìyá", 852.0,
         "I nurture what I have built with oceanic patience.",
         "Community, education, mentorship, treasury nurturing",
         "The mother receives all rivers; the wise give back to the source."),
        ("Saturday", "Ọjọ́ Àbámẹ́ta", "Ọbàtálá-Àlá", 963.0,
         "I rest in clarity, for the crown is heavy but pure.",
         "Settlement, reflection, audit, Sabbath protocols",
         "Rest is not absence — it is the white cloth that reveals all colors.")
    ]
    
    idx = spiral.btc.day_of_week + 1
    day, yoruba, archetype, freq, mantra, crypto, hidden = days[idx]
    
    # Veil metadata from spiral
    veil_meta = Dict(
        "veil_number" => spiral.veil_number,
        "esoteric_mask" => veil_to_esoteric(spiral.veil_number),
        "archetypal_mask" => veil_to_archetypal(spiral.veil_number),
        "moon_phase" => compute_moon_phase(spiral),
        "gates_active" => [
            spiral.eshu_squared ? "Èṣù²" : nothing,
            spiral.capstone_day ? "Capstone" : nothing,
            spiral.void_day ? "Void" : nothing,
            spiral.btc.is_sabbath ? "Sabbath" : nothing
        ] |> x -> filter(!isnothing, x)
    )
    
    DailyResonance(day, yoruba, archetype, spiral, veil_meta, freq, mantra, crypto, hidden)
end

# Helper: Veil masks (simplified — full registry in Ọ̀ṢỌ́VM)
function veil_to_esoteric(n::Int)::String
    masks = [
        "Binary Bones", "Cultural Cycles", "Mathematical Constants", "Temple Codes",
        "Cosmic Cycles", "Chaos & Fractals", "Harmonics", "Meta-Grids",
        "Recursive Mirrors", "Archetypal Forms", "Energetics", "Meta-Consciousness",
        "The Nameless Source", "Symmetry", "Codes & Designs", "Modular Forms",
        "Information", "Topology", "Quasicrystals", "Non-commutative",
        "Magic Squares", "Measure", "Cosmological", "Planck Units",
        "Particle Ratios", "Neutrino", "Dark Energy", "Large Numbers",
        "Black Hole", "Yuga", "Gematria", "Unicode", "Complexity",
        "Busy Beaver", "Category", "Homotopy", "Knot Codes", "Entropy",
        "Anthropic", "Multiverse", "Simulation", "Platonic", "Enochian",
        "Kabbalah", "Sexagesimal", "Islamic", "Christian", "Norse",
        "Modern Physics", "The Absolute Unknown"
    ]
    masks[mod(n-1, length(masks))+1]
end

function veil_to_archetypal(n::Int)::String
    archetypes = [
        "Intention", "Breath", "Fire", "Waters", "Stone", "Rhythm", "Union",
        "Seed", "Serpent", "Mirror", "Dream", "Blood", "Song", "Dance",
        "Mask", "Path", "Shadow", "Flame", "Word", "Covenant",
        "Sword", "Crown", "Throne", "Chalice", "Sun", "Eye", "Heart",
        "Tower", "Phoenix", "Balance", "Abyss", "Bones", "Night",
        "Maskless", "Chains", "Key", "Labyrinth", "Storm", "Vessel",
        "Gatekeeper", "Star", "Ocean", "Mountain", "Child", "Union Crown",
        "Silence", "Light", "Circle", "Ancestors", "Jubilee"
    ]
    archetypes[mod(n-1, length(archetypes))+1]
end

function compute_moon_phase(spiral::SpiralTime)::String
    day_in_moon = mod(spiral.btc.day_number, 28) + 1
    if day_in_moon <= 7
        "waxing_crescent"
    elseif day_in_moon <= 14
        "waxing_gibbous"
    elseif day_in_moon <= 21
        "waning_gibbous"
    else
        "waning_crescent"
    end
end

end # module SacredTime
