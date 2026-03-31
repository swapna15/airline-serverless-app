# Requirements Document

## Introduction

This document defines requirements for the **airline-agent** feature — two agentic AI capabilities layered on top of the existing AirApp airline booking system:

1. **Agentic Chat**: The existing chat widget (backed by AWS Bedrock / Amazon Nova Micro) is upgraded from a read-only Q&A assistant into a full booking agent. The agent can take actions on behalf of the authenticated user: search flights, retrieve seat maps, create bookings, retrieve bookings, and cancel flights — using Bedrock's native tool use / function calling API.

2. **MCP Server**: AirApp exposes a Model Context Protocol (MCP) server so that external AI agents (Claude Desktop, custom bots, CI pipelines, etc.) can invoke AirApp's capabilities as structured tools without going through the chat widget.

Both capabilities share the same underlying tool implementations, which call the existing `lib/db.ts` functions directly.

---

## Glossary

- **Agent**: The AWS Bedrock-powered AI that can reason over user intent and invoke Tools to fulfil requests
- **Agentic_Chat**: The upgraded chat widget at `/api/chat` that uses Bedrock tool use to take actions
- **Chat_Widget**: The React component (`app/components/ChatWidget.tsx`) that renders the chat UI
- **Tool**: A named, schema-described function the Agent can call to interact with AirApp data
- **Tool_Result**: The structured data returned to the Agent after a Tool is executed
- **MCP_Server**: The Model Context Protocol server exposed at `/api/mcp` that allows external AI clients to discover and invoke AirApp Tools
- **MCP_Client**: An external AI agent or developer tool (e.g. Claude Desktop, a custom bot) that connects to the MCP_Server
- **Converse_API**: The AWS Bedrock `ConverseCommand` API that supports multi-turn conversations with tool use
- **Agentic_Loop**: The server-side cycle of: send messages → receive tool call → execute tool → send Tool_Result → repeat until the Agent produces a final text response
- **DB_Layer**: The existing `lib/db.ts` module that interfaces with DynamoDB
- **Flights_API**: The existing Next.js API routes under `/api/flights`
- **Bookings_API**: The existing Next.js API routes under `/api/bookings`
- **Session**: The NextAuth.js JWT session identifying the currently authenticated User
- **User**: A registered AirApp account holder

---

## Requirements

### Requirement 1: Bedrock Tool Definitions

**User Story:** As a developer, I want the Agent's available tools to be defined with precise JSON schemas, so that Bedrock can reliably generate well-formed tool calls.

#### Acceptance Criteria

1. THE Agentic_Chat SHALL define the following Tools for the Agent: `search_flights`, `get_flight_seats`, `create_booking`, `get_booking`, `get_my_bookings`, and `cancel_flight`.
2. WHEN a Tool definition is registered, THE Agentic_Chat SHALL provide a `name`, a human-readable `description`, and a JSON Schema `inputSchema` for each Tool.
3. THE `search_flights` Tool SHALL accept optional parameters: `from` (3-char IATA string), `to` (3-char IATA string), and `date` (YYYY-MM-DD string).
4. THE `get_flight_seats` Tool SHALL accept a required `flightId` string parameter.
5. THE `create_booking` Tool SHALL accept a required `flightId` string and a required `passengers` array, where each element contains `seatNumber`, `passengerName`, and `passengerEmail`.
6. THE `get_booking` Tool SHALL accept a required `bookingId` string parameter.
7. THE `get_my_bookings` Tool SHALL accept no parameters.
8. THE `cancel_flight` Tool SHALL accept a required `flightId` string parameter.
9. THE Agentic_Chat SHALL pass all Tool definitions to the Converse_API in every request so the Agent can choose the appropriate Tool at each step.

---

### Requirement 2: Agentic Loop — Tool Execution

**User Story:** As a developer, I want the chat API to run a server-side agentic loop, so that the Agent can call multiple tools in sequence before returning a final answer.

#### Acceptance Criteria

1. WHEN the Converse_API returns a response with `stopReason` of `tool_use`, THE Agentic_Chat SHALL extract all tool call blocks from the response, execute each Tool, and send the Tool_Results back to the Converse_API in the next turn.
2. THE Agentic_Chat SHALL continue the Agentic_Loop until the Converse_API returns a `stopReason` of `end_turn` or a maximum of 10 iterations is reached.
3. IF the Agentic_Loop reaches 10 iterations without an `end_turn`, THEN THE Agentic_Chat SHALL return the last available text response to the user.
4. WHEN a Tool call is received, THE Agentic_Chat SHALL execute the Tool by calling the corresponding DB_Layer function directly (not via HTTP).
5. WHEN a Tool execution succeeds, THE Agentic_Chat SHALL return a `toolResult` block with `status: "success"` and the serialised result.
6. IF a Tool execution throws an error, THEN THE Agentic_Chat SHALL return a `toolResult` block with `status: "error"` and a descriptive error message, allowing the Agent to recover gracefully.
7. THE Agentic_Chat SHALL maintain the full conversation history (user messages, assistant messages, and tool results) within a single request's Agentic_Loop.

---

### Requirement 3: Authentication and Authorisation in Agentic Chat

**User Story:** As a passenger, I want the Agent to act on my behalf using my authenticated identity, so that bookings are created under my account and I can only access my own data.

#### Acceptance Criteria

1. WHEN the `create_booking` Tool is invoked, THE Agentic_Chat SHALL use the authenticated User's `userId` from the active Session as the `userId` field of the booking.
2. WHEN the `get_my_bookings` Tool is invoked, THE Agentic_Chat SHALL use the authenticated User's `userId` from the active Session to retrieve only that user's bookings.
3. IF the `create_booking` or `get_my_bookings` Tool is invoked without an active Session, THEN THE Agentic_Chat SHALL return a Tool_Result with an error message instructing the user to sign in.
4. THE `search_flights`, `get_flight_seats`, `get_booking`, and `cancel_flight` Tools SHALL be executable without an authenticated Session.
5. THE Agentic_Chat SHALL read the Session server-side using the existing `auth()` function from `auth.ts` — the Session SHALL NOT be passed from the client.

---

### Requirement 4: Conversation History

**User Story:** As a passenger, I want the Agent to remember earlier messages in our conversation, so that I can ask follow-up questions without repeating context.

#### Acceptance Criteria

1. THE Chat_Widget SHALL maintain a local conversation history as an array of `{ role, content }` message objects.
2. WHEN the user sends a new message, THE Chat_Widget SHALL include the full prior conversation history in the request body sent to `/api/chat`.
3. THE Agentic_Chat SHALL accept a `history` array in the request body and prepend it to the messages sent to the Converse_API.
4. THE Chat_Widget SHALL append both the user's new message and the Agent's final text reply to the local conversation history after each turn.
5. THE Chat_Widget SHALL display all messages in the conversation history in chronological order.

---

### Requirement 5: Chat Widget — Agentic UX

**User Story:** As a passenger, I want the chat widget to show me when the Agent is working and what actions it took, so that I understand what is happening during longer operations.

#### Acceptance Criteria

1. WHILE the Agentic_Loop is running, THE Chat_Widget SHALL display a "Thinking..." loading indicator.
2. WHEN the Agent's final text response is received, THE Chat_Widget SHALL display it as an assistant message and remove the loading indicator.
3. THE Chat_Widget SHALL send the full conversation history with each request so the Agent has context for follow-up questions.
4. IF the `/api/chat` request fails with a network or server error, THEN THE Chat_Widget SHALL display a user-friendly error message without crashing.
5. THE Chat_Widget SHALL disable the send button and input field while a request is in progress to prevent duplicate submissions.

---

### Requirement 6: MCP Server — Tool Discovery

**User Story:** As an external AI developer, I want to connect my AI agent to AirApp's MCP server and discover available tools, so that I can integrate AirApp capabilities into my own AI workflows.

#### Acceptance Criteria

1. THE MCP_Server SHALL be exposed at the HTTP endpoint `POST /api/mcp`.
2. WHEN an MCP_Client sends a `tools/list` request, THE MCP_Server SHALL respond with the full list of available Tools including each Tool's `name`, `description`, and `inputSchema`.
3. THE MCP_Server SHALL expose the same set of Tools as the Agentic_Chat: `search_flights`, `get_flight_seats`, `create_booking`, `get_booking`, `get_my_bookings`, and `cancel_flight`.
4. THE MCP_Server SHALL implement the MCP JSON-RPC 2.0 protocol, responding with `jsonrpc: "2.0"`, a matching `id`, and a `result` or `error` field.
5. IF an MCP_Client sends a request with an unrecognised `method`, THEN THE MCP_Server SHALL respond with a JSON-RPC error code `-32601` (Method not found).

---

### Requirement 7: MCP Server — Tool Invocation

**User Story:** As an external AI developer, I want to call AirApp tools via the MCP server, so that my AI agent can search flights and manage bookings programmatically.

#### Acceptance Criteria

1. WHEN an MCP_Client sends a `tools/call` request with a valid `name` and `arguments`, THE MCP_Server SHALL execute the corresponding Tool and return the result.
2. THE MCP_Server SHALL execute Tools by calling the same DB_Layer functions used by the Agentic_Chat.
3. WHEN a Tool executes successfully, THE MCP_Server SHALL return a `result` object containing a `content` array with a `text` field holding the JSON-serialised Tool output.
4. IF an MCP_Client invokes a Tool with an unrecognised `name`, THEN THE MCP_Server SHALL respond with a JSON-RPC error code `-32602` (Invalid params) and a descriptive message.
5. IF a Tool execution throws an error, THEN THE MCP_Server SHALL return a `result` object with `isError: true` and a descriptive error message in the `content` array.
6. THE `create_booking` and `get_my_bookings` Tools on the MCP_Server SHALL require a `userId` to be supplied in the request arguments, since the MCP_Server has no Session context.
7. THE MCP_Server SHALL validate that required Tool parameters are present before executing the Tool, returning a JSON-RPC `-32602` error if any required parameter is missing.

---

### Requirement 8: Shared Tool Implementation

**User Story:** As a developer, I want the Agentic_Chat and MCP_Server to share a single tool implementation layer, so that behaviour is consistent and there is no duplication.

#### Acceptance Criteria

1. THE System SHALL define all Tool implementations in a single shared module (e.g. `lib/agent-tools.ts`).
2. WHEN a Tool is invoked from either the Agentic_Chat or the MCP_Server, THE System SHALL call the same underlying function in the shared module.
3. THE shared module SHALL export each Tool's `name`, `description`, `inputSchema`, and an `execute` function.
4. THE shared module SHALL call DB_Layer functions directly and SHALL NOT make HTTP calls to internal API routes.
5. FOR ALL Tool invocations, the shared module SHALL return a plain serialisable JavaScript object so results can be embedded in both Bedrock tool results and MCP responses without transformation.

---

### Requirement 9: System Prompt and Agent Persona

**User Story:** As a passenger, I want the Agent to have a helpful, airline-focused persona, so that interactions feel natural and on-brand.

#### Acceptance Criteria

1. THE Agentic_Chat SHALL send a system prompt to the Converse_API that instructs the Agent to act as AirApp's flight booking assistant.
2. THE system prompt SHALL instruct the Agent to use the available Tools to answer questions rather than guessing from training data.
3. WHERE a Session is active, THE system prompt SHALL include the authenticated user's name so the Agent can personalise responses.
4. THE system prompt SHALL instruct the Agent to confirm booking details with the user before invoking the `create_booking` Tool.
5. THE system prompt SHALL instruct the Agent to present flight search results in a readable, structured format.

---

### Requirement 10: Input Validation and Error Handling

**User Story:** As a system operator, I want all agent and MCP inputs to be validated, so that malformed requests do not corrupt data or cause unhandled exceptions.

#### Acceptance Criteria

1. THE Agentic_Chat SHALL validate that the incoming `message` field is a non-empty string, returning a 400 error if absent.
2. THE Agentic_Chat SHALL validate that the incoming `history` field, if present, is an array, returning a 400 error if it is not.
3. IF the Converse_API call fails, THEN THE Agentic_Chat SHALL return a 200 response with a user-friendly error message in the `reply` field rather than a 500 error.
4. THE MCP_Server SHALL return a 400 HTTP error if the request body is not valid JSON.
5. THE MCP_Server SHALL return a JSON-RPC error response (not an HTTP 500) for all application-level errors so MCP_Clients can handle them programmatically.
6. IF a Tool receives an `flightId` or `bookingId` that does not exist in the DB_Layer, THEN THE shared tool module SHALL return a structured error object rather than throwing an exception.
