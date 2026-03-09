import { randomUUID } from 'node:crypto';

type LiveSessionRecord = {
  liveSessionId: string;
  sessionId: string;
  goal: string;
  startedAt: string;
  provider: 'gemini_live' | 'adk_compatible' | 'genai_fallback';
  liveConnection?: any;
  adkEndpoint?: string;
  fallbackReason?: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
};

const liveSessions = new Map<string, LiveSessionRecord>();

const REALTIME_PROVIDER = ((process.env.LIVE_AGENT_PROVIDER || '').trim().toLowerCase() ||
  'gemini_live') as 'gemini_live' | 'adk_compatible' | 'genai_fallback';
const LIVE_MODEL = (process.env.GEMINI_LIVE_MODEL || '').trim() || 'gemini-live-2.5-flash-preview';
const ADK_ENDPOINT = (process.env.ADK_ENDPOINT || '').trim();
const LIVE_STRICT = (process.env.LIVE_AGENT_STRICT || '').trim().toLowerCase() === 'true';

async function getAI(): Promise<any | null> {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey: key });
}

async function tryOpenGeminiLiveConnection(ai: any, input: { goal: string }): Promise<any | undefined> {
  try {
    // SDK shapes can vary; this dynamic probe keeps runtime compatibility.
    const liveApi = ai?.live || ai?.realtime || ai?.models?.live;
    if (!liveApi) return undefined;
    if (typeof liveApi.connect === 'function') {
      return await liveApi.connect({
        model: LIVE_MODEL,
        config: {
          systemInstruction: `You are a realtime campaign copilot. Goal: ${input.goal}`,
          responseModalities: ['TEXT'],
        },
      });
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function startRealtimeSession(input: { sessionId: string; goal: string }) {
  const liveSessionId = randomUUID();
  const ai = await getAI();
  let liveConnection: any | undefined;
  let provider: LiveSessionRecord['provider'] = 'genai_fallback';
  let fallbackReason = '';

  if (REALTIME_PROVIDER === 'gemini_live' && ai) {
    liveConnection = await tryOpenGeminiLiveConnection(ai, { goal: input.goal });
    if (liveConnection) {
      provider = 'gemini_live';
    } else {
      provider = 'genai_fallback';
      fallbackReason = 'Gemini live connection unavailable in current runtime.';
      if (LIVE_STRICT) {
        throw new Error('LIVE_AGENT_STRICT=true and Gemini Live connection could not be established.');
      }
    }
  } else if (REALTIME_PROVIDER === 'adk_compatible') {
    if (!ADK_ENDPOINT) {
      provider = 'genai_fallback';
      fallbackReason = 'ADK provider selected but ADK_ENDPOINT is not configured.';
      if (LIVE_STRICT) {
        throw new Error('LIVE_AGENT_STRICT=true and ADK_ENDPOINT is missing for adk_compatible mode.');
      }
    } else {
      provider = 'adk_compatible';
    }
  } else if (REALTIME_PROVIDER === 'gemini_live' && !ai) {
    provider = 'genai_fallback';
    fallbackReason = 'Gemini API key not configured for live runtime.';
    if (LIVE_STRICT) {
      throw new Error('LIVE_AGENT_STRICT=true and GEMINI_API_KEY is missing for gemini_live mode.');
    }
  }

  liveSessions.set(liveSessionId, {
    liveSessionId,
    sessionId: input.sessionId,
    goal: input.goal,
    startedAt: new Date().toISOString(),
    provider,
    liveConnection,
    adkEndpoint: ADK_ENDPOINT || undefined,
    fallbackReason: fallbackReason || undefined,
    history: [],
  });
  return {
    liveSessionId,
    mode: provider,
    model: LIVE_MODEL,
    fallbackReason: fallbackReason || undefined,
  };
}

export async function stopRealtimeSession(liveSessionId: string) {
  const existing = liveSessions.get(liveSessionId);
  if (existing?.liveConnection) {
    try {
      if (typeof existing.liveConnection.close === 'function') {
        await existing.liveConnection.close();
      }
    } catch {
      // ignore close errors
    }
  }
  liveSessions.delete(liveSessionId);
}

export function hasRealtimeSession(liveSessionId: string): boolean {
  return liveSessions.has(liveSessionId);
}

function buildRealtimePrompt(record: LiveSessionRecord, message: string): string {
  const historyText = record.history
    .slice(-8)
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`)
    .join('\n');
  return `
You are a real-time conversational campaign assistant.
Answer naturally in 1-3 sentences and keep conversational continuity.
Goal: ${record.goal}
Conversation history:
${historyText || 'No prior turns.'}
New user message: ${message}
`;
}

async function trySendViaLiveConnection(connection: any, message: string): Promise<string | undefined> {
  try {
    if (typeof connection.send === 'function') {
      const response = await connection.send({ text: message });
      const text = String(response?.text || response?.response?.text || '').trim();
      if (text) return text;
    }
    if (typeof connection.generate === 'function') {
      const response = await connection.generate(message);
      const text = String(response?.text || '').trim();
      if (text) return text;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function sendViaAdkEndpoint(endpoint: string, message: string, goal: string): Promise<string | undefined> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        goal,
        mode: 'realtime',
      }),
    });
    if (!response.ok) return undefined;
    const json = await response.json() as any;
    const text = String(json?.reply || json?.text || '').trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

export async function sendRealtimeMessage(liveSessionId: string, message: string): Promise<string> {
  const record = liveSessions.get(liveSessionId);
  if (!record) {
    throw new Error(`Live session not found: ${liveSessionId}`);
  }

  // Try true live connection path first when available.
  if (record.liveConnection) {
    const liveText = await trySendViaLiveConnection(record.liveConnection, message);
    if (liveText) {
      record.history.push({ role: 'user', content: message });
      record.history.push({ role: 'assistant', content: liveText });
      return liveText;
    }
  }

  if (record.provider === 'adk_compatible' && record.adkEndpoint) {
    const adkText = await sendViaAdkEndpoint(record.adkEndpoint, message, record.goal);
    if (adkText) {
      record.history.push({ role: 'user', content: message });
      record.history.push({ role: 'assistant', content: adkText });
      return adkText;
    }
    if (LIVE_STRICT) {
      throw new Error('LIVE_AGENT_STRICT=true and ADK endpoint did not return a realtime reply.');
    }
  }

  const ai = await getAI();
  if (!ai) {
    return `Realtime mode is available. I received: "${message}". Tell me your audience, tone, and platform so I can continue.`;
  }

  const prompt = buildRealtimePrompt(record, message);

  try {
    // Prefer configured live model first.
    const response = await ai.models.generateContent({
      model: LIVE_MODEL,
      contents: prompt,
    });
    const text = String(response.text || '').trim();
    if (text) {
      record.history.push({ role: 'user', content: message });
      record.history.push({ role: 'assistant', content: text });
      return text;
    }
  } catch {
    // fallback below
  }

  const fallback = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });
  const finalText = String(
    fallback.text || 'I received your message. Please continue with your requirements.',
  ).trim();
  record.history.push({ role: 'user', content: message });
  record.history.push({ role: 'assistant', content: finalText });
  return finalText;
}

export function getRealtimeProviderMatrix() {
  return {
    activeProvider: REALTIME_PROVIDER,
    liveModel: LIVE_MODEL,
    strictMode: LIVE_STRICT,
    adkEndpointConfigured: Boolean(ADK_ENDPOINT),
    supportedProviders: ['gemini_live', 'adk_compatible', 'genai_fallback'],
  };
}
