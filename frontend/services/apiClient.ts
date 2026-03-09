import { LiveIntent, NavigatorPlan, ExecutionResult, Session, StoryOutput } from '../shared/contracts';

const API_BASE = (import.meta as any).env?.VITE_API_BASE || '/api';

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

  listSessions: () =>
    request<{
      sessions: Array<{
        sessionId: string;
        goal: string;
        status: Session['status'];
        workflowStage: Session['workflowStage'];
        updatedAt: string;
      }>;
    }>('/session'),

  restartSessionFromReview: (sessionId: string) =>
    request<{ session: Session }>(`/session/${sessionId}/restart-from-review`, {
      method: 'POST',
    }),

  sendLiveMessage: (
    payload: { sessionId: string; message: string },
    options?: { signal?: AbortSignal },
  ) =>
    request<{ liveIntent: LiveIntent; reply: string }>('/live/message', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: options?.signal,
    }),

  generateStory: (payload: {
    sessionId: string;
    text?: string;
    style?: string;
    typographyPrompt?: string;
    referenceImage?: string;
    imageUrl?: string;
    videoUrl?: string;
    generateAssets?: boolean;
  }) =>
    request<{ storyOutput: StoryOutput }>('/story/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  regenerateStoryBlock: (payload: {
    sessionId: string;
    blockType: 'text' | 'narration' | 'caption' | 'cta';
    title?: string;
    blockIndex?: number;
    currentContent?: string;
  }) =>
    request<{ storyOutput: StoryOutput }>('/story/regenerate-block', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  analyzeNavigator: (payload: { sessionId: string; screenshotBase64: string; targetUrl?: string }) =>
    request<{ navigatorPlan: NavigatorPlan }>('/navigator/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  executeNavigator: (payload: { sessionId: string; mode?: 'mock' | 'playwright'; targetUrl?: string; headless?: boolean }) =>
    request<{ executionResult: ExecutionResult }>('/navigator/execute', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
