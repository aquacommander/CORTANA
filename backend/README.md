# Backend (Workflow API)

This folder contains the workflow/session backend used by the frontend.

## Endpoints

- `GET /api/health`
- `GET /api/session`
- `POST /api/session/create`
- `GET /api/session/:sessionId`
- `POST /api/session/:sessionId/restart-from-review`
- `POST /api/live/message`
- `POST /api/story/generate`
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
- `POST /api/story/generate` requires a ready live intent and returns a full
  mixed-media `StoryOutput` (summary, script, image block, video block,
  narration, caption, CTA).
- Set `GEMINI_API_KEY` to enable backend Gemini text generation for storyline fields.

## Run

1. `npm install`
2. `npm run dev`

Default port: `8787`.
