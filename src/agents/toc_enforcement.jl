# Ritual-Codex v7 — Terms of Conscience Enforcement
# TEE-enforced action validation — cannot be bypassed

module ToCEnforcement

using ..SacredTime
using SHA

export Action, TermsOfConscience, TOC
export validate_toc_action, enforce_gate_constraints
export generate_toc_hash, toc_version

# =============================================================================
# TYPES
# =============================================================================

"""
    Action

Proposed agent action subject to ToC validation.
"""
struct Action
    action_type::String         # "transfer", "mint", "stake", "govern", "spawn"
    target::String              # Target address or resource
    amount::Float64             # Value involved (0.0 for non-economic)
    metadata::Dict{String,Any}  # Action-specific parameters
end

Action(action_type::String, amount::Real) =
    Action(action_type, "", Float64(amount), Dict{String,Any}())

Action(action_type::String, target::String, amount::Real) =
    Action(action_type, target, Float64(amount), Dict{String,Any}())

"""
    TermsOfConscience

Immutable covenant binding an agent's behavior.
TEE-sealed — the agent cannot modify its own ToC.
"""
struct TermsOfConscience
    version::Int
    toc_hash::String                    # SHA-256 of full terms
    max_transfer_per_block::Float64     # Spending cap per BTC block
    sabbath_compliant::Bool             # Must honor Sabbath gates
    tithe_rate::Float64                 # Èṣù tithe percentage
    allowed_actions::Vector{String}     # Whitelist of action types
    forbidden_targets::Vector{String}   # Blacklisted addresses
    jubilee_reset_eligible::Bool        # Can be reset at Jubilee
    parent_override::Bool               # Parent can override decisions
    tee_sealed::Bool                    # Enforced inside TEE enclave
end

function _validate_static_constraints(agent_id::String,
                                      proposed_action::Action,
                                      toc::TermsOfConscience)::NamedTuple
    if !(proposed_action.action_type in toc.allowed_actions)
        @warn "ToC DENIED [$agent_id]: action '$(proposed_action.action_type)' not in allowed list"
        return (allowed = false, reason = "action_not_allowed")
    end

    if proposed_action.target in toc.forbidden_targets
        @warn "ToC DENIED [$agent_id]: target '$(proposed_action.target)' is forbidden"
        return (allowed = false, reason = "forbidden_target")
    end

    if proposed_action.amount > toc.max_transfer_per_block
        @warn "ToC DENIED [$agent_id]: amount $(proposed_action.amount) exceeds cap $(toc.max_transfer_per_block)"
        return (allowed = false, reason = "amount_exceeds_cap")
    end

    (allowed = true, reason = "static_constraints_clear")
end

function _validate_tithe(agent_id::String,
                         proposed_action::Action,
                         toc::TermsOfConscience)::NamedTuple
    if proposed_action.amount > 0.0
        tithe_due = proposed_action.amount * toc.tithe_rate
        tithe_paid = get(proposed_action.metadata, "tithe_included", 0.0)
        if tithe_paid < tithe_due
            @warn "ToC DENIED [$agent_id]: tithe $(tithe_paid) < required $(tithe_due)"
            return (allowed = false, reason = "insufficient_tithe")
        end
    end

    (allowed = true, reason = "tithe_clear")
end

function TOC(;
    version::Int = 1,
    toc_hash::String = "",
    max_transfer_per_block::Float64 = 1_000_000.0,
    sabbath_compliant::Bool = true,
    tithe_rate::Float64 = SacredTime.TITHE_RATE,
    allowed_actions::Vector{String} = ["settle", "audit", "reflect", "new_contract", "transfer", "mint", "stake", "govern", "spawn", "collect_debt"],
    forbidden_targets::Vector{String} = String[],
    jubilee_reset_eligible::Bool = true,
    parent_override::Bool = false,
    tee_sealed::Bool = true
)::TermsOfConscience
    toc = TermsOfConscience(
        version,
        toc_hash,
        max_transfer_per_block,
        sabbath_compliant,
        tithe_rate,
        allowed_actions,
        forbidden_targets,
        jubilee_reset_eligible,
        parent_override,
        tee_sealed
    )

    if isempty(toc_hash)
        return TermsOfConscience(
            toc.version,
            generate_toc_hash(toc),
            toc.max_transfer_per_block,
            toc.sabbath_compliant,
            toc.tithe_rate,
            toc.allowed_actions,
            toc.forbidden_targets,
            toc.jubilee_reset_eligible,
            toc.parent_override,
            toc.tee_sealed
        )
    end

    toc
end

# =============================================================================
# VALIDATION — TEE-Enforced, Cannot Be Bypassed
# =============================================================================

"""
    validate_toc_action(agent_id, proposed_action, toc) -> NamedTuple

TEE-enforced validation of a proposed agent action against its Terms of Conscience.
This function runs inside the TEE enclave — the agent cannot intercept or modify it.
"""
function validate_toc_action(agent_id::String,
                             proposed_action::Action,
                             toc::TermsOfConscience)::NamedTuple
    static_result = _validate_static_constraints(agent_id, proposed_action, toc)
    if !static_result.allowed
        return static_result
    end

    # 4. Enforce Sabbath compliance
    if toc.sabbath_compliant
        current_height = estimate_current_height()
        btc = from_block_height(current_height)
        spiral = from_btc(btc)

        gate_result = enforce_gate_constraints(proposed_action, spiral, toc)
        if !gate_result.allowed
            return gate_result
        end
    end

    tithe_result = _validate_tithe(agent_id, proposed_action, toc)
    if !tithe_result.allowed
        return tithe_result
    end

    @info "ToC APPROVED [$agent_id]: $(proposed_action.action_type) → $(proposed_action.target)"
    (allowed = true, reason = "approved")
end

function validate_toc_action(agent_id::String,
                             proposed_action::Action,
                             toc::TermsOfConscience,
                             spiral::SpiralTime)::NamedTuple
    static_result = _validate_static_constraints(agent_id, proposed_action, toc)
    if !static_result.allowed
        return static_result
    end

    if toc.sabbath_compliant
        gate_result = enforce_gate_constraints(proposed_action, spiral, toc)
        if !gate_result.allowed
            return gate_result
        end
    end

    tithe_result = _validate_tithe(agent_id, proposed_action, toc)
    if !tithe_result.allowed
        return tithe_result
    end

    (allowed = true, reason = "approved")
end

# =============================================================================
# GATE CONSTRAINTS — Time-Based Behavioral Locks
# =============================================================================

"""
    enforce_gate_constraints(action, spiral, toc) -> NamedTuple

Check ritual gate constraints against the current spiral time.
"""
function enforce_gate_constraints(action::Action,
                                  spiral::SpiralTime,
                                  toc::TermsOfConscience)::NamedTuple
    gate = check_gate(spiral)

    # Sabbath: settle-only
    if gate == SacredTime.SABBATH && action.action_type ∉ ["settle", "audit", "reflect"]
        @warn "ToC GATE DENIED: Sabbath — only settle/audit/reflect allowed"
        return (allowed = false, reason = "sabbath_gate")
    end

    # Void day: no economic activity
    if gate == SacredTime.VOID && action.amount > 0.0
        @warn "ToC GATE DENIED: Void day — no economic actions permitted"
        return (allowed = false, reason = "void_gate")
    end

    # Èṣù²: tithe must be doubled at crossroads
    if gate == SacredTime.ÈṢÙ² && action.amount > 0.0
        doubled_tithe = action.amount * toc.tithe_rate * 2.0
        tithe_paid = get(action.metadata, "tithe_included", 0.0)
        if tithe_paid < doubled_tithe
            @warn "ToC GATE DENIED: Èṣù² — doubled tithe required ($(doubled_tithe))"
            return (allowed = false, reason = "eshu_squared_tithe")
        end
    end

    # Jubilee: debt forgiveness active
    if gate == SacredTime.JUBILEE_MAJOR && action.action_type == "collect_debt"
        @warn "ToC GATE DENIED: Jubilee — debt collection forbidden during reset"
        return (allowed = false, reason = "jubilee_gate")
    end

    (allowed = true, reason = "gate_clear")
end

# =============================================================================
# TOC UTILITIES
# =============================================================================

function generate_toc_hash(toc::TermsOfConscience)::String
    material = "v$(toc.version):$(toc.max_transfer_per_block):$(toc.tithe_rate):" *
               join(toc.allowed_actions, ",") * ":" *
               join(toc.forbidden_targets, ",")
    bytes2hex(sha256(Vector{UInt8}(material)))
end

function toc_version(toc::TermsOfConscience)::Int
    toc.version
end

function estimate_current_height()::Int
    elapsed = time() - 1700000000
    Int(SacredTime.GENESIS_BLOCK + div(elapsed, 600))
end

end # module ToCEnforcement
