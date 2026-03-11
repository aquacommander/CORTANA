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
  turnToken: number;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
};

const liveSessions = new Map<string, LiveSessionRecord>();

function getRealtimeProvider(): 'gemini_live' | 'adk_compatible' | 'genai_fallback' {
  return ((process.env.LIVE_AGENT_PROVIDER || '').trim().toLowerCase() ||
    'gemini_live') as 'gemini_live' | 'adk_compatible' | 'genai_fallback';
}

function getLiveModel(): string {
  return (process.env.GEMINI_LIVE_MODEL || '').trim() || 'gemini-live-2.5-flash-preview';
}

function getAdkEndpoint(): string {
  return (process.env.ADK_ENDPOINT || '').trim();
}

function isLiveStrictMode(): boolean {
  return (process.env.LIVE_AGENT_STRICT || '').trim().toLowerCase() === 'true';
}

async function getAI(): Promise<any | null> {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey: key });
}

async function tryOpenGeminiLiveConnection(ai: any, input: { goal: string }): Promise<any | undefined> {
  const liveModel = getLiveModel();
  try {
    // SDK shapes can vary; this dynamic probe keeps runtime compatibility.
    const liveApi = ai?.live || ai?.realtime || ai?.models?.live;
    if (!liveApi) return undefined;
    if (typeof liveApi.connect === 'function') {
      return await liveApi.connect({
        model: liveModel,
        config: {
          systemInstruction: `You are a realtime campaign copilot. Goal: ${input.goal}`,
          responseModalities: ['TEXT', 'AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: (process.env.LIVE_AGENT_VOICE_NAME || '').trim() || 'Kore',
              },
            },
          },
        },
      });
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function startRealtimeSession(input: { sessionId: string; goal: string }) {
  const REALTIME_PROVIDER = getRealtimeProvider();
  const LIVE_MODEL = getLiveModel();
  const ADK_ENDPOINT = getAdkEndpoint();
  const LIVE_STRICT = isLiveStrictMode();
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
    turnToken: 0,
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

export async function interruptRealtimeSession(liveSessionId: string): Promise<void> {
  const record = liveSessions.get(liveSessionId);
  if (!record) return;
  record.turnToken += 1;
  if (record.liveConnection) {
    try {
      if (typeof record.liveConnection.interrupt === 'function') {
        await record.liveConnection.interrupt();
      } else if (typeof record.liveConnection.cancel === 'function') {
        await record.liveConnection.cancel();
      }
    } catch {
      // best-effort interrupt
    }
  }
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

async function trySendViaLiveConnection(
  connection: any,
  message: string,
  screenshotBase64?: string,
): Promise<string | undefined> {
  try {
    const messageParts: any[] = [];
    if (screenshotBase64) {
      messageParts.push({
        inlineData: {
          data: screenshotBase64.replace(/^data:.*;base64,/, ''),
          mimeType: 'image/jpeg',
        },
      });
      messageParts.push({
        text: 'Visual context is attached. Use it to answer accurately.',
      });
    }
    messageParts.push({ text: message });

    if (typeof connection.send === 'function') {
      const response = await connection.send({ text: message, parts: messageParts });
      const text = String(response?.text || response?.response?.text || '').trim();
      if (text) return text;
    }
    if (typeof connection.sendMessage === 'function') {
      const response = await connection.sendMessage({ parts: messageParts, text: message });
      const text = String(response?.text || response?.response?.text || '').trim();
      if (text) return text;
    }
    if (typeof connection.generate === 'function') {
      const response = await connection.generate({ text: message, parts: messageParts });
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
  return sendRealtimeTurn(liveSessionId, { message });
}

function assertNotInterrupted(record: LiveSessionRecord, token: number) {
  if (record.turnToken !== token) {
    throw new Error('Interrupted');
  }
}

function saveTurn(record: LiveSessionRecord, userMessage: string, assistantReply: string): string {
  record.history.push({ role: 'user', content: userMessage });
  record.history.push({ role: 'assistant', content: assistantReply });
  return assistantReply;
}

export async function sendRealtimeTurn(
  liveSessionId: string,
  input: { message: string; screenshotBase64?: string },
): Promise<string> {
  const LIVE_MODEL = getLiveModel();
  const LIVE_STRICT = isLiveStrictMode();
  const record = liveSessions.get(liveSessionId);
  if (!record) {
    throw new Error(`Live session not found: ${liveSessionId}`);
  }
  const localToken = record.turnToken + 1;
  record.turnToken = localToken;

  // Try true live connection path first when available.
  if (record.liveConnection) {
    const liveText = await trySendViaLiveConnection(
      record.liveConnection,
      input.message,
      input.screenshotBase64,
    );
    assertNotInterrupted(record, localToken);
    if (liveText) {
      return saveTurn(record, input.message, liveText);
    }
  }

  if (record.provider === 'adk_compatible' && record.adkEndpoint) {
    const adkText = await sendViaAdkEndpoint(record.adkEndpoint, input.message, record.goal);
    assertNotInterrupted(record, localToken);
    if (adkText) {
      return saveTurn(record, input.message, adkText);
    }
    if (LIVE_STRICT) {
      throw new Error('LIVE_AGENT_STRICT=true and ADK endpoint did not return a realtime reply.');
    }
  }

  const ai = await getAI();
  if (!ai) {
    return `Realtime mode is available. I received: "${input.message}". Tell me your audience, tone, and platform so I can continue.`;
  }

  const visualHint = input.screenshotBase64
    ? '\nVisual context attached by client. Consider what is visible in the frame.'
    : '';
  const prompt = `${buildRealtimePrompt(record, input.message)}${visualHint}`;

  try {
    // Prefer configured live model first.
    const response = await ai.models.generateContent({
      model: LIVE_MODEL,
      contents: prompt,
    });
    const text = String(response.text || '').trim();
    assertNotInterrupted(record, localToken);
    if (text) {
      return saveTurn(record, input.message, text);
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
  assertNotInterrupted(record, localToken);
  return saveTurn(record, input.message, finalText);
}

export function getRealtimeProviderMatrix() {
  const REALTIME_PROVIDER = getRealtimeProvider();
  const LIVE_MODEL = getLiveModel();
  const ADK_ENDPOINT = getAdkEndpoint();
  const LIVE_STRICT = isLiveStrictMode();
  return {
    activeProvider: REALTIME_PROVIDER,
    liveModel: LIVE_MODEL,
    strictMode: LIVE_STRICT,
    adkEndpointConfigured: Boolean(ADK_ENDPOINT),
    supportedProviders: ['gemini_live', 'adk_compatible', 'genai_fallback'],
  };
}
