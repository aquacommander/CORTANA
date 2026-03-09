## Run Locally

**Prerequisites:** Node.js 18+

### Project Structure

- `App.tsx`, `services/`, `shared/`: frontend app and shared contracts
- `backend/`: Express API for session workflow stages

### 1) Install dependencies

- Frontend deps: `npm install`
- Backend deps: `npm --prefix backend install`

### 2) Create frontend env file

Create `.env.local` in the project root:

```env
GEMINI_API_KEY=your_key_here
```

### 3) Start backend

`npm run dev:backend`

Backend runs at [http://localhost:8787](http://localhost:8787) with API under `/api/*`.

### 4) Start frontend

In another terminal: `npm run dev:frontend`

Open [http://localhost:3000](http://localhost:3000).

## Notes

- Frontend proxies `/api` to backend (`localhost:8787`) in dev mode.
- This app supports a standard local env-key flow and does not require AI Studio host integration.
- Veo/video generation may require a billed Google Cloud project and supported API access.
