# Backend (Workflow API)

This folder contains the workflow/session backend used by the frontend.

## Endpoints

- `GET /api/health`
- `GET /api/session`
- `POST /api/session/create`
- `GET /api/session/:sessionId`
- `POST /api/session/:sessionId/restart-from-review`
- `POST /api/live/message`
- `POST /api/live/message-stream`
- `WS /api/live/ws` (bidirectional low-latency live intake transport)
- `POST /api/live/realtime/session/start`
- `POST /api/live/realtime/session/:liveSessionId/message`
- `POST /api/live/realtime/session/:liveSessionId/stop`
- `GET /api/live/realtime/provider-matrix`
- `POST /api/story/generate`
- `POST /api/story/generate-stream`
- `POST /api/story/regenerate-block`
- `POST /api/navigator/analyze`
- `POST /api/navigator/execute`

## Navigator Execution Modes

- `mock` (default): deterministic simulated execution
- `playwright`: real browser execution

Control mode with:

- request body: `mode: "mock" | "playwright"`
- env var fallback: `NAVIGATOR_MODE=playwright`

For playwright mode, provide a target page URL via:

- request body `targetUrl`
- or env var `NAVIGATOR_TARGET_URL`

Optional safety guardrail:

- `NAVIGATOR_ALLOWED_HOSTS=example.com,localhost`
- When set, both analyze and execute reject non-allowed hosts.

## Storyteller + Live Agent Notes

- `POST /api/live/message` now runs a follow-up intake loop and only marks
  `readyForStoryGeneration=true` after objective/audience/tone/platform are captured.
- `POST /api/live/message-stream` returns a near-live NDJSON stream with incremental
  reply chunks (`delta`) and a final structured payload (`final` with `liveIntent` + `reply`).
- `WS /api/live/ws` supports events:
  - client -> server: `start_session`, `vision_frame`, `user_message`, `interrupt`
  - server -> client: `ready`, `session_started`, `vision_ack`, `intent_update`, `delta`, `final`, `interrupted`, `error`
- Realtime session endpoints support provider modes via env:
  - `LIVE_AGENT_PROVIDER=gemini_live|adk_compatible|genai_fallback`
  - `GEMINI_LIVE_MODEL` (default: `gemini-live-2.5-flash-preview`)
  - `LIVE_AGENT_STRICT=true|false`
  - `ADK_ENDPOINT` (required for `adk_compatible` mode)
  The backend attempts a live connection when available and gracefully falls back.
- Storyteller interleaved-first mode:
  - `INTERLEAVED_MODEL` (default: `gemini-2.5-flash`)
  - Backend attempts one structured interleaved plan first, then generates image/video
    prompts from that plan. Blocks include metadata (`generationPath`, `fallbackReason`)
    so demo judges can see native-path vs fallback-path behavior clearly.
- `POST /api/story/generate-stream` returns NDJSON interleaved story blocks
  (`status`, `block`, `final`) for fluid mixed-media storytelling UX.
- `POST /api/story/generate` requires a ready live intent and returns a full
  mixed-media `StoryOutput` (summary, script, image block, video block, audio
  narration block, narration text, caption, CTA).
- `POST /api/story/regenerate-block` lets users refine one textual story block
  (`text`, `narration`, `caption`, `cta`) without resetting the entire session.
- Set `GEMINI_API_KEY` to enable backend Gemini text generation for storyline fields.
- Live intake and storyteller now use adaptive knowledge context from
  `backend/resources/*.md|*.txt` (top-ranked by query relevance). This replaces
  single-resource behavior and better adapts to diverse user goals/needs/interests.
- Navigator analysis is visual-first when a screenshot is provided and Gemini key
  is configured; it can also accept screen recording context and falls back to
  deterministic URL/selector heuristics if needed.

## Run

1. `npm install`
2. `npm run dev`

Default port: `8787`.
