type SynthesizedVoice = {
  mimeType: string;
  audioBase64: string;
  provider: 'gemini_tts' | 'none';
};

const VOICE_MODEL = (process.env.LIVE_AGENT_VOICE_MODEL || '').trim() || 'gemini-2.5-flash';
const VOICE_NAME = (process.env.LIVE_AGENT_VOICE_NAME || '').trim() || 'Kore';

async function getAI(): Promise<any | null> {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey: key });
}

function extractInlineAudio(response: any): { mimeType: string; data: string } | undefined {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const inlineData = part?.inlineData;
      if (inlineData?.data) {
        return {
          mimeType: String(inlineData.mimeType || 'audio/wav'),
          data: String(inlineData.data || ''),
        };
      }
    }
  }
  return undefined;
}

export async function synthesizeLiveReplyVoice(text: string): Promise<SynthesizedVoice | undefined> {
  const cleaned = String(text || '').trim();
  if (!cleaned) return undefined;
  const ai = await getAI();
  if (!ai) return undefined;

  try {
    const response = await ai.models.generateContent({
      model: VOICE_MODEL,
      contents: cleaned,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: VOICE_NAME },
          },
        },
      },
    });
    const audio = extractInlineAudio(response);
    if (!audio?.data) return undefined;
    return {
      mimeType: audio.mimeType,
      audioBase64: audio.data,
      provider: 'gemini_tts',
    };
  } catch {
    return undefined;
  }
}
