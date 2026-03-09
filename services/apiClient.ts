import { LiveIntent, NavigatorPlan, ExecutionResult, Session, StoryOutput } from '../shared/contracts';

const API_BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let details = '';
    try {
      details = await response.text();
    } catch {
      details = response.statusText;
    }
    throw new Error(`API ${response.status}: ${details || 'Request failed'}`);
  }

  return (await response.json()) as T;
}

export const apiClient = {
  createSession: (goal: string) =>
    request<{ session: Session }>('/session/create', {
      method: 'POST',
      body: JSON.stringify({ goal }),
    }),

  getSession: (sessionId: string) => request<{ session: Session }>(`/session/${sessionId}`),

  sendLiveMessage: (payload: { sessionId: string; message: string }) =>
    request<{ liveIntent: LiveIntent; reply: string }>('/live/message', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  generateStory: (payload: { sessionId: string }) =>
    request<{ storyOutput: StoryOutput }>('/story/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  analyzeNavigator: (payload: { sessionId: string; screenshotBase64: string }) =>
    request<{ navigatorPlan: NavigatorPlan }>('/navigator/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  executeNavigator: (payload: { sessionId: string }) =>
    request<{ executionResult: ExecutionResult }>('/navigator/execute', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
