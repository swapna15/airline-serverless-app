# Implementation Tasks

## Task 1: Create shared agent tools module

- [ ] 1.1 Create `lib/agent-tools.ts` with `AgentTool` and `ToolContext` types
- [ ] 1.2 Implement `search_flights` tool — calls `getFlights(filters?)`, returns flight array
- [ ] 1.3 Implement `get_flight_seats` tool — calls `getFlightById` + `getSeatsByFlightId`, returns `{ flight, seats }`
- [ ] 1.4 Implement `create_booking` tool — requires `userId` in context, calls `createBooking`, returns booking or error
- [ ] 1.5 Implement `get_booking` tool — calls `getBookingById`, returns booking or `{ error }` if not found
- [ ] 1.6 Implement `get_my_bookings` tool — requires `userId` in context, calls `getBookingsByUserId`
- [ ] 1.7 Implement `cancel_flight` tool — calls `cancelFlight`, returns updated flight or error
- [ ] 1.8 Export `AGENT_TOOLS` array and a `executeTool(name, args, context)` helper function

Requirements: 1.1–1.9, 8.1–8.5

---

## Task 2: Upgrade `/api/chat` to agentic loop

- [ ] 2.1 Install `@aws-sdk/client-bedrock-runtime` `ConverseCommand` — already installed, verify import
- [ ] 2.2 Replace `InvokeModelCommand` with `ConverseCommand` in `app/api/chat/route.ts`
- [ ] 2.3 Add `history` field to request body validation — accept optional `{ role, content }[]`
- [ ] 2.4 Build `toolConfig` from `AGENT_TOOLS` and pass to `ConverseCommand`
- [ ] 2.5 Implement agentic loop — on `stopReason === "tool_use"`: extract tool calls, execute via `executeTool`, append tool results, loop (max 10 iterations)
- [ ] 2.6 Extract final text reply when `stopReason === "end_turn"`
- [ ] 2.7 Inject `userId` from session into `ToolContext` for auth-gated tools
- [ ] 2.8 Update system prompt to include booking confirmation instruction and persona rules

Requirements: 2.1–2.7, 3.1–3.5, 9.1–9.5

---

## Task 3: Create MCP server

- [ ] 3.1 Create `app/api/mcp/route.ts` with `export const dynamic = "force-dynamic"`
- [ ] 3.2 Parse JSON-RPC 2.0 request body — return 400 if invalid JSON
- [ ] 3.3 Handle `tools/list` method — return all tools from `AGENT_TOOLS` with name, description, inputSchema
- [ ] 3.4 Handle `tools/call` method — validate `name` and `arguments`, call `executeTool`, return result
- [ ] 3.5 Return JSON-RPC error `-32601` for unknown methods
- [ ] 3.6 Return JSON-RPC error `-32602` for unknown tool name or missing required params
- [ ] 3.7 Return `isError: true` result (not HTTP 500) when tool execution fails
- [ ] 3.8 Pass `userId` from `arguments.userId` as `context.userId` for auth-gated tools

Requirements: 6.1–6.5, 7.1–7.7, 10.4–10.5

---

## Task 4: Update Chat Widget

- [ ] 4.1 Add `history` state — `{ role: "user" | "assistant"; content: string }[]`
- [ ] 4.2 Include `history` in the POST body sent to `/api/chat`
- [ ] 4.3 Append user message and assistant reply to `history` after each turn
- [ ] 4.4 Disable input field and send button while `loading` is true
- [ ] 4.5 Preserve whitespace in assistant messages (`whitespace-pre-wrap`)

Requirements: 4.1–4.5, 5.1–5.5

---

## Task 5: Build and deploy

- [ ] 5.1 Run `npm run build` locally — verify no type errors
- [ ] 5.2 Commit and push to GitHub — Vercel auto-deploys
- [ ] 5.3 Test agentic chat on production — ask "show me flights from ORD to JFK"
- [ ] 5.4 Test MCP endpoint — `curl POST /api/mcp` with `tools/list`
- [ ] 5.5 Update `README.md` with MCP usage instructions for external developers

Requirements: all
