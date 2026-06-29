# Ritual-Codex v7 — Spiral Calendar (13 Moons + Jubilee)
# Bínò ÈL Guà — ọmọ Kọ́dà

module SpiralCalendar

using Dates
using ..SacredTime

export Moon, Year, Jubilee, GreatJubilee
export compute_moons, find_gate_days, generate_year_almanac
export to_ritual_codex_json, merge_with_7day

# =============================================================================
# 13-MOON SYSTEM — Lunar-Solar Hybrid
# =============================================================================

"""
    Moon

28-day moon with 4 weeks of 7 days each.
Each moon carries an Òrìṣà archetype.
"""
struct Moon
    number::Int           # 1–13
    name::String
    orisa::String
    start_day::Int        # Day of year (1–364)
    weeks::Vector{Vector{Int}}  # 4 weeks × 7 days
    star_anchor::String   # Pleiades, Orion, Sirius, etc.
end

function create_moon(n::Int, start_day::Int)::Moon
    names = [
        "Dawn Moon", "Stone Moon", "Serpent Moon", "Song Moon",
        "Shadow Moon", "Sword Moon", "Sun Moon", "Phoenix Moon",
        "Night Moon", "Storm Moon", "Star Moon", "Child Moon", "Light Moon"
    ]
    
    orisas = ["Èṣù", "Ṣàngó", "Ọ̀ṣun", "Yemọja", "Ọ̀yá", "Ògún", "Ọbàtálá",
              "Èṣù", "Ṣàngó", "Ọ̀ṣun", "Yemọja", "Ọ̀yá", "Ògún"]
    
    stars = [
        "Pleiades", "Orion's Belt", "Sirius", "Hyades",
        "Spica", "Regulus", "Antares", "Altair",
        "Vega", "Deneb", "Aldebaran", "Fomalhaut", "Polaris"
    ]
    
    # 4 weeks × 7 days
    weeks = [collect(start_day + (w-1)*7 : start_day + w*7 - 1) for w in 1:4]
    
    Moon(n, names[n], orisas[n], start_day, weeks, stars[n])
end

# =============================================================================
# YEAR — 13 Moons + Void Days
# =============================================================================

"""
    Year

364 days = 13 moons × 28 days.
+ 1–2 Void Days (absorbs solar drift).
"""
struct Year
    number::Int           # Year since genesis
    moons::Vector{Moon}
    void_days::Int        # 1 or 2
    equinox_day::Int      # Day 1 = spring equinox anchor
    solstices::Vector{Int} # Approximate: 91, 182, 273, 364
end

function create_year(year_num::Int, is_leap::Bool=false)::Year
    moons = [create_moon(i, 1 + (i-1)*28) for i in 1:13]
    void_days = is_leap ? 2 : 1
    Year(year_num, moons, void_days, 1, [91, 182, 273, 364])
end

# =============================================================================
# JUBILEE — 7×7×50 Cycles
# =============================================================================

"""
    Jubilee

50-year cycle: 49 years of growth, 1 year of release.
Great Jubilee: 50 × 50 = 2,500 years (civilizational epoch).
"""
struct Jubilee
    number::Int           # 1–50 within Great Jubilee
    start_year::Int
    orisa::String         # Rotating ruler
    is_release_year::Bool # 50th year = reset
end

function create_jubilee(jubilee_num::Int, start_year::Int)::Jubilee
    orisas = ["Èṣù", "Ṣàngó", "Ọ̀ṣun", "Yemọja", "Ọ̀yá", "Ògún", "Ọbàtálá"]
    orisa = orisas[mod(jubilee_num-1, 7)+1]
    is_release = (jubilee_num == 50)
    Jubilee(jubilee_num, start_year, orisa, is_release)
end

struct GreatJubilee
    number::Int           # 1–10 (covers 25,920 year precession)
    start_year::Int
    jubilees::Vector{Jubilee}
end

function create_great_jubilee(gj_num::Int, start_year::Int)::GreatJubilee
    jubilees = [create_jubilee(i, start_year + (i-1)*50) for i in 1:50]
    GreatJubilee(gj_num, start_year, jubilees)
end

# =============================================================================
# GATE DAYS — Solar + Ritual Alignment
# =============================================================================

"""
    GateDay

Special days when protocol rules shift.
"""
struct GateDay
    day_of_year::Int
    name::String
    gate_type::String  # "equinox", "solstice", "jubilee", "eshu²", "void"
    economic_effect::Dict{String,Any}
end

function find_gate_days(year::Year, spiral_ref::Function)::Vector{GateDay}
    gates = GateDay[]
    
    # Equinoxes and solstices (approximate)
    push!(gates, GateDay(1, "Spring Equinox", "equinox",
         Dict("new_beginnings" => true, "treasury_open" => true)))
    push!(gates, GateDay(91, "Summer Solstice", "solstice",
        Dict("expansion" => true, "yield_boost" => 1.5)))
    push!(gates, GateDay(182, "Autumn Equinox", "equinox",
        Dict("balance" => true, "rebalancing" => true)))
    push!(gates, GateDay(273, "Winter Solstice", "solstice",
        Dict("contraction" => true, "ancestor_rites" => true)))
    
    # Jubilee gates
    for moon in year.moons
        if moon.number == 13  # Last moon
            push!(gates, GateDay(364, "Year End", "jubilee",
                Dict("debt_reset" => true, "field_rest" => true)))
        end
    end
    
    # Void days
    for d in 365:(365+year.void_days-1)
        push!(gates, GateDay(d, "Void Day", "void",
            Dict("out_of_time" => true, "pure_ritual" => true, "minting_paused" => true)))
    end
    
    # Èṣù² nodes (every 12 days in veil cycle)
    for day in 1:365
        veil = mod(day-1, 350) + 1
        if mod(veil, 12) == 0
            push!(gates, GateDay(day, "Èṣù² Node", "eshu²",
                Dict("tithe_enforced" => true, "crossroads" => true, "branch_merge" => true)))
        end
    end
    
    sort(gates, by=g -> g.day_of_year)
end

# =============================================================================
# ALMANAC GENERATION
# =============================================================================

"""
    generate_year_almanac

Complete 365-day almanac with all overlays.
"""
function generate_year_almanac(year_num::Int, btc_start_height::Int)::Dict{String,Any}
    year = create_year(year_num)
    
    # Compute BTC heights for each day
    days = Dict{String,Any}[]
    
    for day_of_year in 1:(364 + year.void_days)
        btc_height = btc_start_height + (day_of_year - 1) * SacredTime.BLOCKS_PER_DAY
        
        # Get spiral time
        spiral = from_btc(from_block_height(btc_height))
        
        # Find moon
        moon_num = min(div(day_of_year-1, 28) + 1, 13)
        moon = year.moons[moon_num]
        
        # Day in moon
        day_in_moon = mod(day_of_year-1, 28) + 1
        
        # Check gates
        gate = check_gate(spiral)
        gate_effects = gate_economic_effect(gate)
        
        push!(days, Dict(
            "day_of_year" => day_of_year,
            "btc_height" => btc_height,
            "date_gregorian" => Dates.format(Dates.Date(2026,1,1) + Dates.Day(day_of_year-1), "yyyy-mm-dd"),
            "moon" => Dict(
                "number" => moon.number,
                "name" => moon.name,
                "orisa" => moon.orisa,
                "star_anchor" => moon.star_anchor
            ),
            "day_in_moon" => day_in_moon,
            "five_layer_orisa" => Dict(
                "day" => SacredTime.ORISA_NAMES[Int(spiral.day_osa)+1],
                "week" => SacredTime.ORISA_NAMES[Int(spiral.week_osa)+1],
                "moon" => SacredTime.ORISA_NAMES[Int(spiral.moon_osa)+1],
                "year" => SacredTime.ORISA_NAMES[Int(spiral.year_osa)+1],
                "jubilee" => SacredTime.ORISA_NAMES[Int(spiral.jubilee_osa)+1]
            ),
            "veil" => Dict(
                "number" => spiral.veil_number,
                "esoteric" => veil_to_esoteric(spiral.veil_number),
                "archetypal" => veil_to_archetypal(spiral.veil_number)
            ),
            "gates" => Dict(
                "active" => string(gate),
                "eshu_squared" => spiral.eshu_squared,
                "sabbath" => spiral.btc.is_sabbath,
                "void" => spiral.void_day
            ),
            "economic_rules" => gate_effects,
            "ritual_cues" => generate_ritual_cues(spiral, moon)
        ))
    end
    
    Dict(
        "year_number" => year_num,
        "btc_start_height" => btc_start_height,
        "total_days" => 364 + year.void_days,
        "void_days" => year.void_days,
        "moons" => length(year.moons),
        "days" => days
    )
end

function generate_ritual_cues(spiral::SpiralTime, moon::Moon)::Vector{String}
    cues = String[]
    
    if spiral.btc.is_sabbath
        push!(cues, "SABBATH: Rest, reflect, settle. No new ventures.")
    end
    
    if spiral.eshu_squared
        push!(cues, "ÈṢÙ²: Crossroads decision. Tithe 3.69% before proceeding.")
    end
    
    if spiral.void_day
        push!(cues, "VOID: Out of time. Pure ritual, no economic action.")
    end
    
    if spiral.capstone_day
        push!(cues, "CAPSTONE: 7×7×7 completion. Pyramid ritual, seal and release.")
    end
    
    # Moon-specific
    if moon.number == 1
        push!(cues, "Dawn Moon: New beginnings, seed intentions at Pleiades rising.")
    elseif moon.number == 13
        push!(cues, "Light Moon: Culmination at Polaris. Anchor truth for next cycle.")
    end
    
    cues
end

# =============================================================================
# RITUAL-CODEX INTEGRATION
# =============================================================================

"""
    to_ritual_codex_json

Export almanac in format compatible with existing ritual-codex 7-day system.
"""
function to_ritual_codex_json(almanac::Dict{String,Any})::String
    # Transform to match existing ritual-codex schema
    codex_format = Dict(
        "version" => "7.0.0-spiral",
        "year" => almanac["year_number"],
        "btc_anchor" => almanac["btc_start_height"],
        "total_days" => almanac["total_days"],
        "daily_resonance" => Dict[]
    )
    
    for day in almanac["days"]
        resonance = Dict(
            "day" => day_to_english(day["day_of_year"]),
            "yoruba_name" => day_to_yoruba(day["day_of_year"]),
            "archetype" => "$(day["five_layer_orisa"]["day"])-$(day["moon"]["orisa"])²",
            
            # Spiral overlay (new)
            "spiral_time" => Dict(
                "btc_height" => day["btc_height"],
                "veil_number" => day["veil"]["number"],
                "veil_esoteric" => day["veil"]["esoteric"],
                "veil_archetypal" => day["veil"]["archetypal"],
                "five_layer_orisa" => day["five_layer_orisa"],
                "moon" => day["moon"],
                "gates" => day["gates"]
            ),
            
            # Frequency from base 7-day
            "frequency_hz" => day_to_frequency(day["day_of_year"]),
            
            # Enhanced ritual practice
            "ritual_practice" => Dict(
                "mantra" => generate_mantra(day),
                "crypto" => day["economic_rules"],
                "offerings" => generate_offerings(day),
                "prohibitions" => generate_prohibitions(day)
            ),
            
            "hidden_message" => generate_hidden_message(day)
        )
        
        push!(codex_format["daily_resonance"], resonance)
    end
    
    JSON.json(codex_format, 2)
end

# Helpers for integration
function day_to_english(doy::Int)::String
    days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    days[mod(doy-1, 7)+1]
end

function day_to_yoruba(doy::Int)::String
    days = ["Ọjọ́ Àìkú", "Ọjọ́ Ajé", "Ọjọ́ Ìṣẹ́gun", "Ọjọ́ Rú",
             "Ọjọ́ Bọ̀", "Ọjọ́ Ẹ̀tì", "Ọjọ́ Àbámẹ́ta"]
    days[mod(doy-1, 7)+1]
end

function day_to_frequency(doy::Int)::Float64
    freqs = [396.0, 417.0, 528.0, 639.0, 741.0, 852.0, 963.0]
    freqs[mod(doy-1, 7)+1]
end

function generate_mantra(day::Dict)::String
    base = day["five_layer_orisa"]["day"]
    veil = day["veil"]["archetypal"]
    "I align with $(base) at the crossroads of $(veil), trusting the spiral."
end

function generate_offerings(day::Dict)::Vector{String}
    offerings = String[]
    
    if day["gates"]["eshu_squared"]
        push!(offerings, "Èṣù: Palm oil, corn, rum at crossroads")
    end
    
    if day["gates"]["sabbath"]
        push!(offerings, "Ọbàtálá: White cloth, coconut milk, calm reflection")
    end
    
    moon = day["moon"]["orisa"]
    if moon == "Ọ̀ṣun"
        push!(offerings, "Ọ̀ṣun: Honey, pumpkin, brass bell at river")
    elseif moon == "Ṣàngó"
        push!(offerings, "Ṣàngó: Bitter kola, red cloth, thunderstone")
    end
    
    offerings
end

function generate_prohibitions(day::Dict)::Vector{String}
    prohs = String[]
    
    if day["gates"]["sabbath"]
        push!(prohs, "No new contract signatures")
        push!(prohs, "No aggressive trading")
        push!(prohs, "Settle-only mode in treasury")
    end
    
    if day["gates"]["void"]
        push!(prohs, "All economic activity suspended")
        push!(prohs, "Pure ritual only")
    end
    
    prohs
end

function generate_hidden_message(day::Dict)::String
    veil_num = day["veil"]["number"]
    if veil_num == 1
        "The first step is not the smallest — it is the only step that exists."
    elseif veil_num == 50
        "Jubilee: What was bound is free. What was free is bound. The spiral turns."
    else
        "Veil $(veil_num): $(day["veil"]["esoteric"]) masks $(day["veil"]["archetypal"])."
    end
end

end # module SpiralCalendar
