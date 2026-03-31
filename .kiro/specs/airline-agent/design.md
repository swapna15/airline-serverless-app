# Technical Design Document — Airline Agent

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Chat Widget)                      │
│  ChatWidget.tsx — sends { message, history[] } to /api/chat  │
└───────────────────────────┬─────────────────────────────────┘
                            │ POST /api/chat
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              app/api/chat/route.ts (Agentic Loop)            │
│  1. auth() → get userId from session                         │
│  2. Build system prompt + tool definitions                   │
│  3. Call Bedrock ConverseCommand                             │
│  4. If stopReason=tool_use → execute tools → loop            │
│  5. Return final text reply                                  │
└───────────┬───────────────────────────────────┬─────────────┘
            │ tool calls                         │ ConverseCommand
            ▼                                   ▼
┌───────────────────────┐          ┌────────────────────────┐
│  lib/agent-tools.ts   │          │   AWS Bedrock           │
│  (shared tool layer)  │          │   amazon.nova-micro-v1  │
│  search_flights       │          │   ConverseCommand API   │
│  get_flight_seats     │          └────────────────────────┘
│  create_booking       │
│  get_booking          │
│  get_my_bookings      │
│  cancel_flight        │
└───────────┬───────────┘
            │ direct DB calls
            ▼
┌───────────────────────┐
│     lib/db.ts         │
│     DynamoDB          │
└───────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│         External AI Agent (Claude Desktop, custom bot)       │
└───────────────────────┬─────────────────────────────────────┘
                        │ POST /api/mcp  (JSON-RPC 2.0)
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              app/api/mcp/route.ts (MCP Server)               │
│  tools/list  → return tool schemas                           │
│  tools/call  → execute via lib/agent-tools.ts                │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Shared Tool Layer (`lib/agent-tools.ts`)

Single source of truth for all tool definitions and implementations.

### Tool type

```ts
export type AgentTool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
};

export type ToolContext = {
  userId?: string; // from session (agentic chat) or request args (MCP)
};
```

### Tool definitions

| Tool | Required args | Auth required | DB function |
|------|--------------|---------------|-------------|
| `search_flights` | none | No | `getFlights(filters?)` |
| `get_flight_seats` | `flightId` | No | `getFlightById` + `getSeatsByFlightId` |
| `create_booking` | `flightId`, `passengers[]` | Yes (userId) | `createBooking` |
| `get_booking` | `bookingId` | No | `getBookingById` |
| `get_my_bookings` | none | Yes (userId) | `getBookingsByUserId` |
| `cancel_flight` | `flightId` | No | `cancelFlight` |

All tools return plain serialisable objects. Errors are returned as `{ error: string }` — never thrown.

---

## 3. Agentic Chat (`app/api/chat/route.ts`)

### Request shape
```ts
POST /api/chat
{
  message: string;           // current user message
  history?: {                // prior conversation turns
    role: "user" | "assistant";
    content: string;
  }[];
}
```

### Response shape
```ts
{ reply: string }
```

### Agentic loop (replaces current InvokeModelCommand)

Switch from `InvokeModelCommand` to `ConverseCommand` which natively supports tool use:

```
1. Build messages array: [...history, { role: "user", content: message }]
2. Call ConverseCommand with toolConfig (all 6 tools)
3. If response.stopReason === "tool_use":
   a. Extract toolUse blocks from response.output.message.content
   b. Execute each tool via lib/agent-tools.ts
   c. Append assistant message + toolResult blocks to messages
   d. Loop back to step 2 (max 10 iterations)
4. If response.stopReason === "end_turn":
   a. Extract text from response.output.message.content
   b. Return { reply: text }
```

### Bedrock ConverseCommand payload structure

```ts
{
  modelId: "amazon.nova-micro-v1:0",
  system: [{ text: systemPrompt }],
  messages: ConversationMessage[],
  toolConfig: {
    tools: tools.map(t => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: { json: t.inputSchema }
      }
    }))
  },
  inferenceConfig: { maxTokens: 512, temperature: 0.7 }
}
```

### Tool result message format

```ts
{
  role: "user",
  content: [{
    toolResult: {
      toolUseId: "<id from tool call>",
      content: [{ text: JSON.stringify(result) }],
      status: "success" | "error"
    }
  }]
}
```

### System prompt

```
You are AirApp's flight booking assistant. You help passengers search flights,
book seats, and manage reservations.

IMPORTANT RULES:
- Always use your tools to get real data — never guess flight details
- Before calling create_booking, confirm the flight, seats, and passenger
  details with the user
- Present flight results in a clear, readable format
- If the user is not signed in and tries to book, tell them to sign in first

[If authenticated]: The passenger's name is {name}.
```

---

## 4. MCP Server (`app/api/mcp/route.ts`)

### Protocol

JSON-RPC 2.0 over HTTP POST. No WebSocket — stateless per request.

### Request shape
```ts
POST /api/mcp
Content-Type: application/json

{
  jsonrpc: "2.0",
  id: string | number,
  method: "tools/list" | "tools/call",
  params?: {
    name?: string;       // for tools/call
    arguments?: Record<string, unknown>;  // for tools/call
  }
}
```

### Response shapes

**tools/list**
```ts
{
  jsonrpc: "2.0",
  id: <matching id>,
  result: {
    tools: [{
      name: string;
      description: string;
      inputSchema: object;
    }]
  }
}
```

**tools/call success**
```ts
{
  jsonrpc: "2.0",
  id: <matching id>,
  result: {
    content: [{ type: "text", text: "<JSON string of result>" }],
    isError: false
  }
}
```

**tools/call error**
```ts
{
  jsonrpc: "2.0",
  id: <matching id>,
  result: {
    content: [{ type: "text", text: "<error message>" }],
    isError: true
  }
}
```

**JSON-RPC error (method not found, invalid params)**
```ts
{
  jsonrpc: "2.0",
  id: <matching id>,
  error: { code: -32601 | -32602, message: string }
}
```

### Auth for MCP

Since MCP has no session, `create_booking` and `get_my_bookings` require `userId` in the `arguments` object. The MCP server passes it as `context.userId`.

### MCP client usage example

```bash
# Discover tools
curl -X POST https://your-app.vercel.app/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Search flights
curl -X POST https://your-app.vercel.app/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_flights","arguments":{"from":"ORD","to":"JFK"}}}'
```

---

## 5. Chat Widget Updates (`app/components/ChatWidget.tsx`)

### State changes
- Add `history` state: `{ role: "user" | "assistant"; content: string }[]`
- Send `history` with each request
- Append to history after each turn

### UX changes
- Disable input + button while `loading`
- Show "Thinking..." indicator (already exists)
- Display multi-line assistant responses with whitespace preserved

### Request body
```ts
{ message: string; history: { role: string; content: string }[] }
```

---

## 6. File Change Summary

| File | Change |
|------|--------|
| `lib/agent-tools.ts` | New — shared tool definitions + implementations |
| `app/api/chat/route.ts` | Replace InvokeModelCommand with ConverseCommand + agentic loop |
| `app/api/mcp/route.ts` | New — MCP JSON-RPC 2.0 server |
| `app/components/ChatWidget.tsx` | Add history state, send history, disable during loading |

---

## 7. How Others Can Use AirApp as an Agent

### Option A — MCP Client (Claude Desktop)

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "airapp": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-app.vercel.app/api/mcp"]
    }
  }
}
```

Claude Desktop will discover all 6 tools and can book flights on your behalf.

### Option B — Custom AI Agent (any LLM)

```python
import requests

# Discover tools
tools = requests.post("https://your-app.vercel.app/api/mcp",
  json={"jsonrpc":"2.0","id":1,"method":"tools/list"}).json()

# Call a tool
result = requests.post("https://your-app.vercel.app/api/mcp",
  json={"jsonrpc":"2.0","id":2,"method":"tools/call",
        "params":{"name":"search_flights","arguments":{"from":"SFO","to":"LAX"}}}).json()
```

### Option C — Kiro / VS Code MCP

Add to `.kiro/settings/mcp.json`:
```json
{
  "mcpServers": {
    "airapp": {
      "url": "https://your-app.vercel.app/api/mcp"
    }
  }
}
```
