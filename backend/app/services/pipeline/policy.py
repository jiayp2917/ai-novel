from enum import Enum

from backend.app.services.pipeline.state_machine import PipelineState


class PipelineDecision(str, Enum):
    CONTINUE = "continue"
    FIX = "fix"
    APPROVE = "approve"
    MANUAL_REQUIRED = "manual_required"
    PAUSE_BUDGET = "pause_budget"
    FAIL_RETRYABLE = "fail_retryable"
    FAIL_TERMINAL = "fail_terminal"


def status_for_decision(decision: PipelineDecision) -> PipelineState:
    if decision == PipelineDecision.FIX:
        return PipelineState.FIXING
    if decision == PipelineDecision.APPROVE:
        return PipelineState.APPROVED
    if decision == PipelineDecision.MANUAL_REQUIRED:
        return PipelineState.MANUAL_REQUIRED
    if decision == PipelineDecision.PAUSE_BUDGET:
        return PipelineState.PAUSED_BUDGET
    if decision == PipelineDecision.FAIL_RETRYABLE:
        return PipelineState.FAILED_RETRYABLE
    if decision == PipelineDecision.FAIL_TERMINAL:
        return PipelineState.FAILED_TERMINAL
    return PipelineState.QUEUED

