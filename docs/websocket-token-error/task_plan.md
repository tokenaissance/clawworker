# Task Plan: Fix WebSocket Token Requirement Error

## Objective
Investigate why the WebSocket connection still requires a token and shows error "disconnected (1008): Invalid or missing token" even after we removed the GATEWAY_TOKEN requirement.

## User Report
- Error: `disconnected (1008): Invalid or missing token. Visit https://paramitacloud.com?token={REPLACE_WITH_YOUR_TOKEN}`
- Location: Control UI at `/` (Chat interface)
- Status: Gateway shows "Health Offline"

## Previous Context
We completed Option B implementation:
- ✅ Made GATEWAY_TOKEN optional (removed from required validation)
- ✅ Made CF Access required for admin routes
- ✅ Control UI at `/` should be accessible without token parameter

## Phases

### Phase 1: Research - Find WebSocket Token Validation
- [ ] Search for WebSocket connection handling code
- [ ] Find where error code 1008 is generated
- [ ] Identify where "Invalid or missing token" message originates
- [ ] Check if validation is in Worker code or gateway container
- [ ] Document all token validation points

### Phase 2: Analysis - Determine Root Cause
- [ ] Analyze why token is still required for WebSocket
- [ ] Check if this is frontend or backend validation
- [ ] Determine if this is device pairing check or token check
- [ ] Identify what needs to be changed

### Phase 3: Implementation - Fix Token Requirement
- [ ] Remove or make optional the WebSocket token validation
- [ ] Ensure device pairing still works
- [ ] Update any related error messages
- [ ] Test the fix

### Phase 4: Verification
- [ ] Deploy changes
- [ ] Access Control UI without ?token= parameter
- [ ] Verify WebSocket connects successfully
- [ ] Verify device pairing workflow still works

## Current Status
Phase 1 - Starting research

## Notes
- Error code 1008 = WebSocket close code for policy violation
- The error message specifically mentions token, not device pairing
- User should NOT need to add ?token= to URL
