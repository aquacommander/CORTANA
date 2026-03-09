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
    payload: { sessionId: string; message: string; screenshotBase64?: string },
    options?: { signal?: AbortSignal },
  ) =>
    request<{ liveIntent: LiveIntent; reply: string }>('/live/message', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: options?.signal,
    }),

  sendLiveMessageStream: async (
    payload: { sessionId: string; message: string; screenshotBase64?: string },
    handlers: {
      onDelta: (chunk: string) => void;
      signal?: AbortSignal;
    },
  ): Promise<{ liveIntent: LiveIntent; reply: string }> => {
    const response = await fetch(`${API_BASE}/live/message-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: handlers.signal,
    });
    if (!response.ok || !response.body) {
      let details = '';
      try {
        details = await response.text();
      } catch {
        details = response.statusText;
      }
      throw new Error(`API ${response.status}: ${details || 'Request failed'}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalPayload: { liveIntent: LiveIntent; reply: string } | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.type === 'delta' && typeof parsed.delta === 'string') {
          handlers.onDelta(parsed.delta);
        }
        if (parsed.type === 'final' && parsed.liveIntent && typeof parsed.reply === 'string') {
          finalPayload = { liveIntent: parsed.liveIntent as LiveIntent, reply: parsed.reply };
        }
      }
    }

    if (!finalPayload) {
      throw new Error('Stream ended without final payload');
    }
    return finalPayload;
  },

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

  generateStoryStream: async (
    payload: {
      sessionId: string;
      text?: string;
      style?: string;
      typographyPrompt?: string;
      referenceImage?: string;
      imageUrl?: string;
      videoUrl?: string;
      generateAssets?: boolean;
    },
    handlers: {
      onStatus?: (message: string) => void;
      onBlock?: (block: StoryOutput['blocks'][number]) => void;
      signal?: AbortSignal;
    },
  ): Promise<{ storyOutput: StoryOutput }> => {
    const response = await fetch(`${API_BASE}/story/generate-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: handlers.signal,
    });
    if (!response.ok || !response.body) {
      let details = '';
      try {
        details = await response.text();
      } catch {
        details = response.statusText;
      }
      throw new Error(`API ${response.status}: ${details || 'Request failed'}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalPayload: { storyOutput: StoryOutput } | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.type === 'status' && typeof parsed.message === 'string') {
          handlers.onStatus?.(parsed.message);
        } else if (parsed.type === 'block' && parsed.block) {
          handlers.onBlock?.(parsed.block);
        } else if (parsed.type === 'final' && parsed.storyOutput) {
          finalPayload = { storyOutput: parsed.storyOutput as StoryOutput };
        }
      }
    }
    if (!finalPayload) {
      throw new Error('Stream ended without final story output');
    }
    return finalPayload;
  },

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

  analyzeNavigator: (payload: { sessionId: string; screenshotBase64: string; screenRecordingBase64?: string; targetUrl?: string }) =>
    request<{ navigatorPlan: NavigatorPlan }>('/navigator/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  startRealtimeLiveSession: (payload: { sessionId: string }) =>
    request<{ liveSessionId: string; mode: string }>('/live/realtime/session/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  sendRealtimeLiveMessage: (liveSessionId: string, payload: { message: string }) =>
    request<{ reply: string }>(`/live/realtime/session/${liveSessionId}/message`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  stopRealtimeLiveSession: (liveSessionId: string) =>
    request<{ stopped: boolean; liveSessionId: string }>(`/live/realtime/session/${liveSessionId}/stop`, {
      method: 'POST',
    }),

  executeNavigator: (payload: { sessionId: string; mode?: 'mock' | 'playwright'; targetUrl?: string; headless?: boolean }) =>
    request<{ executionResult: ExecutionResult }>('/navigator/execute', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
