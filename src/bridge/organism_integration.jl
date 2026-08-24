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
    event_type::String        # universal gate name, e.g. "SABBATH", "Access²", "JUBILEE_MAJOR", "VOID"
    btc_height::Int
    spiral_json::String
    economic_rules::Dict{String,Any}
    lobe_routing::Vector{String}  # Which Ọmọ Kọ́dà lobes to notify (universal domain names)
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
    five_layer_domains::Dict{String,String}
    gates_active::Vector{String}
    economic_constraints::Dict{String,Any}
end

function inject_veil_context(spiral::SpiralTime, base_context::Dict)::LobeContext
    LobeContext(
        get(base_context, "breath", "default"),
        get(base_context, "epoch", 0),
        to_json(spiral) |> JSON.parse,
        Dict(
            "day" => SacredTime.universal_domain_name(spiral.day_osa),
            "week" => SacredTime.universal_domain_name(spiral.week_osa),
            "moon" => SacredTime.universal_domain_name(spiral.moon_osa),
            "year" => SacredTime.universal_domain_name(spiral.year_osa),
            "jubilee" => SacredTime.universal_domain_name(spiral.jubilee_osa)
        ),
        [
            spiral.eshu_squared ? "Access²" : nothing,
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
                SacredTime.universal_gate_name(gate),
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
    # Map gates to Ọmọ Kọ́dà lobe activations — universal domain names per
    # OSOVM_CODEX §42 (internal anchor in comments: Ọbàtálá, Ògún, Ọ̀rúnmìlà,
    # Èṣù, Ọ̀yá, Yemọja, Ọ̀ṣun, Ṣàngó).
    routing = Dict(
        SABBATH => ["Policy", "Run", "Query"],        # Rest, audit, wisdom
        ÈṢÙ² => ["Access", "Run", "Sync"],             # Crossroads, tech, change
        JUBILEE_MAJOR => ["Policy", "Spawn", "History"],  # Justice, nurture, wealth
        VOID => ["Query", "Policy"],                   # Oracle, clarity
        CAPSTONE => ["Score", "Policy", "Access"]      # Power, justice, opener
    )

    get(routing, gate, ["Query"])  # Default to oracle
end

end # module OrganismBridge
