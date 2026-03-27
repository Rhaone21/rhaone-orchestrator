#!/bin/bash
# Health check for Rhaone Orchestrator subagents

WORKSPACE="/root/.openclaw/workspace/rhaone-orchestrator"
LOG_FILE="$WORKSPACE/logs/health-check.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

# Function to log
log() {
    echo "[$DATE] $1" >> "$LOG_FILE"
}

# Check if there are active subagents for rhaone-orchestrator
ACTIVE_SUBAGENTS=$(openclaw sessions list --limit 20 2>/dev/null | grep -c "subagent" || echo "0")

if [ "$ACTIVE_SUBAGENTS" -eq "0" ]; then
    log "No active subagents found"
    
    # Check if Phase 2 files exist but not integrated
    if [ -f "$WORKSPACE/src/lib/lifecycle-manager.ts" ] && [ ! -f "$WORKSPACE/PHASE2_COMPLETE" ]; then
        log "Phase 2 files exist but not marked complete. Triggering continuation..."
        
        # Trigger Phase 2 continuation
        openclaw sessions spawn --task "Complete Rhaone Orchestrator Phase 2 integration. Files exist in src/lib/, need README update and integration tests." --runtime subagent --mode run
    fi
    
    # Check if Phase 3 needed
    if [ -f "$WORKSPACE/PHASE2_COMPLETE" ] && [ ! -f "$WORKSPACE/PHASE3_COMPLETE" ]; then
        log "Phase 2 complete, Phase 3 pending. Triggering Phase 3..."
        openclaw cron run rhaone-orch-phase-3
    fi
    
    # Check if Phase 4 needed
    if [ -f "$WORKSPACE/PHASE3_COMPLETE" ] && [ ! -f "$WORKSPACE/PHASE4_COMPLETE" ]; then
        log "Phase 3 complete, Phase 4 pending. Triggering Phase 4..."
        openclaw cron run rhaone-orch-phase-4
    fi
    
    # Check if Phase 5 needed
    if [ -f "$WORKSPACE/PHASE4_COMPLETE" ] && [ ! -f "$WORKSPACE/PHASE5_COMPLETE" ]; then
        log "Phase 4 complete, Phase 5 pending. Triggering Phase 5..."
        openclaw cron run rhaone-orch-phase-5
    fi
else
    log "Active subagents found: $ACTIVE_SUBAGENTS"
fi
