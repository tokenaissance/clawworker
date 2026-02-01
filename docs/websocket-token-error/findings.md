# Findings: WebSocket Token Error Investigation

## Error Details

### What User Sees
```
disconnected (1008): Invalid or missing token.
Visit https://paramitacloud.com?token={REPLACE_WITH_YOUR_TOKEN}
```

### Error Context
- **WebSocket Close Code**: 1008 (Policy Violation)
- **Location**: Control UI chat interface at `/`
- **Gateway Status**: "Health Offline" (red indicator)
- **User Expectation**: Should connect WITHOUT ?token= parameter

## Code Locations to Investigate

### 1. WebSocket Route Handler
Need to find where WebSocket connections are handled in the Worker.

### 2. Token Validation Logic
Need to find where the error message "Invalid or missing token" is generated.

### 3. Error Code 1008
Need to find where WebSocket is closed with code 1008.

## Questions to Answer
1. Is this validation in the Worker (src/) or in the gateway container?
2. Is this checking GATEWAY_TOKEN or device pairing?
3. Where is the error message template defined?
4. Can we make this validation optional?

## Search Keywords
- "1008"
- "Invalid or missing token"
- "WebSocket"
- "ws"
- "REPLACE_WITH_YOUR_TOKEN"
