# Ritual-Codex v7 — Organism-Core Bridge
# Enables ritual-codex to emit events consumed by organism-core/Ọmọ Kọ́dà

module OrganismBridge

using ..SacredTime
using ..SpiralCalendar
using JSON, HTTP

export RitualEvent, emit_event, subscribe_spiral
export LobeContext, inject_veil_context

"""
    RitualEvent

Time-based event for organism-core routing.
"""
struct RitualEvent
    event_type::String        # "sabbath_begin", "eshu_squared", "jubilee", "void"
    btc_height::Int
    spiral_json::String
    economic_rules::Dict{String,Any}
    lobe_routing::Vector{String}  # Which Ọmọ Kọ́dà lobes to notify
end

function emit_event(event::RitualEvent, organism_endpoint::String="http://localhost:7777/events")
    payload = Dict(
        "type" => event.event_type,
        "btc_height" => event.btc_height,
        "spiral" => JSON.parse(event.spiral_json),
        "economic_rules" => event.economic_rules,
        "lobe_routing" => event.lobe_routing,
        "timestamp" => string(now())
    )
    
    try
        HTTP.post(organism_endpoint,
                  ["Content-Type" => "application/json"],
                 JSON.json(payload))
        @info "Ritual event emitted: $(event.event_type) at $(event.btc_height)"
    catch e
        @warn "Failed to emit ritual event: $e"
    end
end

"""
    LobeContext

Context injected into Ọmọ Kọ́dà's 11 lobes.
"""
struct LobeContext
    breath::String            # From Ọmọ Kọ́dà
    epoch::Int
    veil_day::Dict{String,Any}  # Spiral time context
    five_layer_orisa::Dict{String,String}
    gates_active::Vector{String}
    economic_constraints::Dict{String,Any}
end

function inject_veil_context(spiral::SpiralTime, base_context::Dict)::LobeContext
    LobeContext(
        get(base_context, "breath", "default"),
        get(base_context, "epoch", 0),
        to_json(spiral) |> JSON.parse,
        Dict(
            "day" => SacredTime.ORISA_NAMES[Int(spiral.day_osa)+1],
            "week" => SacredTime.ORISA_NAMES[Int(spiral.week_osa)+1],
            "moon" => SacredTime.ORISA_NAMES[Int(spiral.moon_osa)+1],
            "year" => SacredTime.ORISA_NAMES[Int(spiral.year_osa)+1],
            "jubilee" => SacredTime.ORISA_NAMES[Int(spiral.jubilee_osa)+1]
        ),
        [
            spiral.eshu_squared ? "Èṣù²" : nothing,
            spiral.btc.is_sabbath ? "Sabbath" : nothing,
            spiral.void_day ? "Void" : nothing
        ] |> x -> filter(!isnothing, x),
        gate_economic_effect(check_gate(spiral))
    )
end

"""
    subscribe_spiral

Continuous monitoring for organism-core integration.
"""
function subscribe_spiral(btc_poll_interval::Int=600,  # 10 min = 1 BTC block
                         organism_endpoint::String="http://localhost:7777/events")
    @info "Spiral calendar subscription started. Polling every $(btc_poll_interval)s"
    
    last_emitted_gate = nothing
    
    while true
        # Get current BTC height (simplified — real implementation queries node)
        current_height = estimate_btc_height()
        
        btc = from_block_height(current_height)
        spiral = from_btc(btc)
        gate = check_gate(spiral)
        
        # Emit on gate transitions
        if gate != last_emitted_gate && gate != NO_GATE
            event = RitualEvent(
                string(gate),
                current_height,
                to_json(spiral),
                gate_economic_effect(gate),
                route_to_lobes(gate, spiral)
            )
            
            emit_event(event, organism_endpoint)
            last_emitted_gate = gate
        end
        
        sleep(btc_poll_interval)
    end
end

function estimate_btc_height()::Int
    # Placeholder — real implementation queries Bitcoin RPC
    # For now, use system time approximation from genesis
    elapsed = time() - 1700000000  # Approx genesis timestamp
    Int(SacredTime.GENESIS_BLOCK + div(elapsed, 600))
end

function route_to_lobes(gate::RitualGate, spiral::SpiralTime)::Vector{String}
    # Map gates to Ọmọ Kọ́dà lobe activations
    routing = Dict(
        SABBATH => ["Ọbàtálá", "Ògún", "Orunmila"],  # Rest, audit, wisdom
        ÈṢÙ² => ["Èṣù", "Ògún", "Ọ̀yá"],             # Crossroads, tech, change
        JUBILEE_MAJOR => ["Ọbàtálá", "Yemọja", "Ọ̀ṣun"],  # Justice, nurture, wealth
        VOID => ["Orunmila", "Ọbàtálá"],           # Oracle, clarity
        CAPSTONE => ["Ṣàngó", "Ọbàtálá", "Èṣù"]    # Power, justice, opener
    )
    
    get(routing, gate, ["Orunmila"])  # Default to oracle
end

end # module OrganismBridge
