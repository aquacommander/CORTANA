import { LiveIntent, StoryOutput } from '../../frontend/shared/contracts.ts';

type BuildStoryOptions = {
  sessionId: string;
  goal: string;
  liveIntent?: LiveIntent;
  imageUrl?: string;
  videoUrl?: string;
};

async function getAI(): Promise<any | null> {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey: key });
}

async function generateNarrativeFromGemini(goal: string, liveIntent?: LiveIntent) {
  const ai = await getAI();
  if (!ai) {
    return {
      title: `Story for "${goal}"`,
      summary: `Create a short promotional campaign for ${goal}.`,
      script: `Opening: introduce ${goal}. Middle: show benefits for ${liveIntent?.audience || 'general audience'}. Ending: clear call to action.`,
      narration: `Discover ${goal}. Built for ${liveIntent?.audience || 'everyone'}. Start now.`,
      caption: `${goal} - cinematic launch for ${liveIntent?.platform || 'web'}.`,
      cta: `Try ${goal} today.`,
    };
  }

  const prompt = `
You are a creative campaign storyteller.
Return a compact JSON object with keys:
title, summary, script, narration, caption, cta

Goal: ${goal}
Audience: ${liveIntent?.audience || 'general audience'}
Tone: ${liveIntent?.tone || 'cinematic'}
Platform: ${liveIntent?.platform || 'web'}
Objective: ${liveIntent?.objective || goal}

Constraints:
- Keep each field concise and demo-friendly.
- script should be 3-5 short sentences.
- caption should be social-post ready.
- cta should be one sentence.
Output only valid JSON.
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    const raw = response.text || '{}';
    const parsed = JSON.parse(raw);
    return {
      title: String(parsed.title || `Story for "${goal}"`),
      summary: String(parsed.summary || `Create a short promotional campaign for ${goal}.`),
      script: String(parsed.script || `Show the value of ${goal} and close with a CTA.`),
      narration: String(parsed.narration || `Discover ${goal}. Start now.`),
      caption: String(parsed.caption || `${goal} - now available.`),
      cta: String(parsed.cta || `Try ${goal} today.`),
    };
  } catch {
    return {
      title: `Story for "${goal}"`,
      summary: `Create a short promotional campaign for ${goal}.`,
      script: `Opening: introduce ${goal}. Middle: show benefits. Ending: clear call to action.`,
      narration: `Discover ${goal}. Built for impact. Start now.`,
      caption: `${goal} - cinematic launch campaign.`,
      cta: `Try ${goal} today.`,
    };
  }
}

export async function buildStoryOutput(options: BuildStoryOptions): Promise<StoryOutput> {
  const narrative = await generateNarrativeFromGemini(options.goal, options.liveIntent);

  return {
    storyId: options.sessionId,
    title: narrative.title,
    blocks: [
      { type: 'text', title: 'Summary', content: narrative.summary },
      { type: 'text', title: 'Script', content: narrative.script },
      {
        type: 'image',
        title: 'Key Visual',
        content: 'Primary campaign visual',
        assetUrl: options.imageUrl,
        metadata: { status: options.imageUrl ? 'ready' : 'missing', source: options.imageUrl ? 'client_generated' : 'pending_generation' },
      },
      {
        type: 'video',
        title: 'Promo Clip',
        content: 'Short cinematic promotional video',
        assetUrl: options.videoUrl,
        metadata: { status: options.videoUrl ? 'ready' : 'missing', source: options.videoUrl ? 'client_generated' : 'pending_generation' },
      },
      { type: 'narration', title: 'Voiceover', content: narrative.narration },
      { type: 'caption', title: 'Caption', content: narrative.caption },
      { type: 'cta', title: 'Call To Action', content: narrative.cta },
    ],
    nextAction: 'Review assets and trigger navigator execution to publish.',
  };
}
