async function getAI(): Promise<any | null> {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey: key });
}

export async function transcribeAudioChunk(input: {
  audioBase64: string;
  mimeType: string;
  goal: string;
}): Promise<string | undefined> {
  const ai = await getAI();
  if (!ai) return undefined;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              data: input.audioBase64.replace(/^data:.*;base64,/, ''),
              mimeType: input.mimeType || 'audio/webm',
            },
          },
          {
            text: `Transcribe this user speech into plain text.
Goal context: ${input.goal}
Return only the transcript with no extra commentary.`,
          },
        ],
      },
    });
    const transcript = String(response.text || '').trim();
    return transcript || undefined;
  } catch {
    return undefined;
  }
}
