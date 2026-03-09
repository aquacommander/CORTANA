import { LiveIntent, StoryOutput } from '../../frontend/shared/contracts.ts';

type BuildStoryOptions = {
  sessionId: string;
  goal: string;
  liveIntent?: LiveIntent;
  style?: string;
  typographyPrompt?: string;
  referenceImage?: string;
  imageUrl?: string;
  videoUrl?: string;
  generateAssets?: boolean;
};

async function getAI(): Promise<any | null> {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey: key });
}

function cleanBase64(data: string): string {
  return data.replace(/^data:.*,/, '');
}

async function generateImageAsset(options: {
  goal: string;
  liveIntent?: LiveIntent;
  style?: string;
  typographyPrompt?: string;
  referenceImage?: string;
}): Promise<string | undefined> {
  const ai = await getAI();
  if (!ai) return undefined;

  const parts: any[] = [];
  if (options.referenceImage) {
    const [prefix, data] = options.referenceImage.split(';base64,');
    if (data && prefix) {
      parts.push({
        inlineData: {
          data,
          mimeType: prefix.replace('data:', ''),
        },
      });
    }
  }
  parts.push({
    text: `Create a cinematic campaign key visual for "${options.goal}".
Audience: ${options.liveIntent?.audience || 'general audience'}
Tone: ${options.liveIntent?.tone || 'cinematic'}
Platform: ${options.liveIntent?.platform || 'web'}
Style: ${options.style || 'high quality cinematic'}
Typography: ${options.typographyPrompt || 'clean, legible campaign typography'}
Return image only.`,
  });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image-preview',
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: '16:9',
          imageSize: '1K',
        },
      },
    });
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) {
        const mimeType = part.inlineData.mimeType || 'image/png';
        return `data:${mimeType};base64,${part.inlineData.data}`;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function generateVideoAsset(options: {
  goal: string;
  liveIntent?: LiveIntent;
  style?: string;
  imageDataUrl?: string;
}): Promise<string | undefined> {
  const ai = await getAI();
  if (!ai) return undefined;

  try {
    const op = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: `Create a short cinematic promotional video for "${options.goal}".
Audience: ${options.liveIntent?.audience || 'general audience'}
Tone: ${options.liveIntent?.tone || 'cinematic'}
Platform: ${options.liveIntent?.platform || 'web'}
Style: ${options.style || 'high quality campaign style'}`,
      config: {
        numberOfVideos: 1,
        aspectRatio: '16:9',
        resolution: '720p',
      },
    });

    let current = op;
    const start = Date.now();
    while (!current.done && Date.now() - start < 120000) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      current = await ai.operations.getVideosOperation({ operation: current });
    }
    const uri = current.response?.generatedVideos?.[0]?.video?.uri;
    if (!uri) return undefined;
    const key = (process.env.GEMINI_API_KEY || '').trim();
    return key ? `${uri}${uri.includes('?') ? '&' : '?'}key=${key}` : uri;
  } catch {
    return undefined;
  }
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
  let resolvedImageUrl = options.imageUrl;
  let resolvedVideoUrl = options.videoUrl;

  if (options.generateAssets) {
    if (!resolvedImageUrl) {
      resolvedImageUrl = await generateImageAsset({
        goal: options.goal,
        liveIntent: options.liveIntent,
        style: options.style,
        typographyPrompt: options.typographyPrompt,
        referenceImage: options.referenceImage,
      });
    }
    if (!resolvedVideoUrl) {
      resolvedVideoUrl = await generateVideoAsset({
        goal: options.goal,
        liveIntent: options.liveIntent,
        style: options.style,
        imageDataUrl: resolvedImageUrl,
      });
    }
  }

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
        assetUrl: resolvedImageUrl,
        metadata: {
          status: resolvedImageUrl ? 'ready' : 'missing',
          source: resolvedImageUrl
            ? options.imageUrl
              ? 'client_generated'
              : 'backend_generated'
            : 'pending_generation',
        },
      },
      {
        type: 'video',
        title: 'Promo Clip',
        content: 'Short cinematic promotional video',
        assetUrl: resolvedVideoUrl,
        metadata: {
          status: resolvedVideoUrl ? 'ready' : 'missing',
          source: resolvedVideoUrl
            ? options.videoUrl
              ? 'client_generated'
              : 'backend_generated'
            : 'pending_generation',
        },
      },
      { type: 'narration', title: 'Voiceover', content: narrative.narration },
      { type: 'caption', title: 'Caption', content: narrative.caption },
      { type: 'cta', title: 'Call To Action', content: narrative.cta },
    ],
    nextAction: 'Review assets and trigger navigator execution to publish.',
  };
}
