import { LiveIntent, StoryOutput } from '../../frontend/shared/contracts.ts';

type BuildStoryOptions = {
  sessionId: string;
  goal: string;
  liveIntent?: LiveIntent;
  guidanceContext?: string;
  style?: string;
  typographyPrompt?: string;
  referenceImage?: string;
  imageUrl?: string;
  videoUrl?: string;
  generateAssets?: boolean;
};

type InterleavedPlan = {
  title: string;
  summary: string;
  script: string;
  narration: string;
  caption: string;
  cta: string;
  imagePrompt?: string;
  videoPrompt?: string;
  generationPath: 'interleaved_native' | 'fallback_orchestrated';
  fallbackReason?: string;
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
  imagePrompt?: string;
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
    text: `${options.imagePrompt || `Create a cinematic campaign key visual for "${options.goal}".`}
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
  videoPrompt?: string;
}): Promise<string | undefined> {
  const ai = await getAI();
  if (!ai) return undefined;

  try {
    const op = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: `${options.videoPrompt || `Create a short cinematic promotional video for "${options.goal}".`}
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

async function generateNarrativeFromGemini(goal: string, liveIntent?: LiveIntent, guidanceContext?: string) {
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
Needs: ${(liveIntent?.needs || []).join(', ') || 'not specified'}
Interests: ${(liveIntent?.interests || []).join(', ') || 'not specified'}
Knowledge context:
${guidanceContext || 'No external context provided.'}

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

function tryParseJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function generateInterleavedPlan(
  goal: string,
  liveIntent?: LiveIntent,
  guidanceContext?: string,
): Promise<InterleavedPlan> {
  const ai = await getAI();
  if (!ai) {
    const fallback = await generateNarrativeFromGemini(goal, liveIntent, guidanceContext);
    return {
      ...fallback,
      imagePrompt: `Create key visual for ${goal}`,
      videoPrompt: `Create short promo clip for ${goal}`,
      generationPath: 'fallback_orchestrated',
      fallbackReason: 'No Gemini key configured for interleaved generation.',
    };
  }

  const interleavedModel = (process.env.INTERLEAVED_MODEL || '').trim() || 'gemini-2.5-flash';
  const prompt = `
You are a multimodal creative director.
Create a cohesive campaign package and return ONLY valid JSON with keys:
title, summary, script, narration, caption, cta, imagePrompt, videoPrompt

Goal: ${goal}
Audience: ${liveIntent?.audience || 'general audience'}
Tone: ${liveIntent?.tone || 'cinematic'}
Platform: ${liveIntent?.platform || 'web'}
Objective: ${liveIntent?.objective || goal}
Needs: ${(liveIntent?.needs || []).join(', ') || 'not specified'}
Interests: ${(liveIntent?.interests || []).join(', ') || 'not specified'}
Knowledge context:
${guidanceContext || 'No external context provided.'}

Constraints:
- Keep each field concise and demo-friendly.
- script should be 3-5 short sentences.
- imagePrompt and videoPrompt should be production-ready generation prompts.
`;

  try {
    const response = await ai.models.generateContent({
      model: interleavedModel,
      contents: prompt,
    });
    const parsed = tryParseJson(response.text || '{}');
    if (!parsed) {
      throw new Error('Interleaved plan parse failed');
    }
    const title = String(parsed.title || '').trim();
    const summary = String(parsed.summary || '').trim();
    const script = String(parsed.script || '').trim();
    const narration = String(parsed.narration || '').trim();
    const caption = String(parsed.caption || '').trim();
    const cta = String(parsed.cta || '').trim();
    if (!title || !summary || !script || !narration || !caption || !cta) {
      throw new Error('Interleaved plan missing required fields');
    }
    return {
      title,
      summary,
      script,
      narration,
      caption,
      cta,
      imagePrompt: String(parsed.imagePrompt || '').trim() || `Create key visual for ${goal}`,
      videoPrompt: String(parsed.videoPrompt || '').trim() || `Create short promo clip for ${goal}`,
      generationPath: 'interleaved_native',
    };
  } catch (error: any) {
    const fallback = await generateNarrativeFromGemini(goal, liveIntent, guidanceContext);
    return {
      ...fallback,
      imagePrompt: `Create key visual for ${goal}`,
      videoPrompt: `Create short promo clip for ${goal}`,
      generationPath: 'fallback_orchestrated',
      fallbackReason: String(error?.message || 'Interleaved generation failed'),
    };
  }
}

export async function buildStoryOutput(options: BuildStoryOptions): Promise<StoryOutput> {
  const narrative = await generateInterleavedPlan(
    options.goal,
    options.liveIntent,
    options.guidanceContext,
  );
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
        imagePrompt: narrative.imagePrompt,
      });
    }
    if (!resolvedVideoUrl) {
      resolvedVideoUrl = await generateVideoAsset({
        goal: options.goal,
        liveIntent: options.liveIntent,
        style: options.style,
        imageDataUrl: resolvedImageUrl,
        videoPrompt: narrative.videoPrompt,
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
          generationPath: narrative.generationPath,
          fallbackReason: narrative.fallbackReason,
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
          generationPath: narrative.generationPath,
          fallbackReason: narrative.fallbackReason,
          source: resolvedVideoUrl
            ? options.videoUrl
              ? 'client_generated'
              : 'backend_generated'
            : 'pending_generation',
        },
      },
      {
        type: 'audio',
        title: 'Narration Audio',
        content: narrative.narration,
        metadata: {
          provider: 'browser_tts',
          status: 'ready_for_playback',
          generationPath: narrative.generationPath,
          fallbackReason: narrative.fallbackReason,
        },
      },
      {
        type: 'narration',
        title: 'Voiceover',
        content: narrative.narration,
        metadata: { generationPath: narrative.generationPath, fallbackReason: narrative.fallbackReason },
      },
      {
        type: 'caption',
        title: 'Caption',
        content: narrative.caption,
        metadata: { generationPath: narrative.generationPath, fallbackReason: narrative.fallbackReason },
      },
      {
        type: 'cta',
        title: 'Call To Action',
        content: narrative.cta,
        metadata: { generationPath: narrative.generationPath, fallbackReason: narrative.fallbackReason },
      },
    ],
    nextAction:
      narrative.generationPath === 'interleaved_native'
        ? 'Interleaved package ready. Review assets and trigger navigator execution to publish.'
        : 'Fallback package ready. Review assets and trigger navigator execution to publish.',
  };
}

export async function regenerateStoryBlock(options: {
  blockType: 'text' | 'narration' | 'caption' | 'cta';
  title?: string;
  goal: string;
  liveIntent?: LiveIntent;
  currentContent?: string;
}): Promise<{ title: string; content: string }> {
  const ai = await getAI();
  if (ai) {
    const targetTitle =
      options.title ||
      (options.blockType === 'narration'
        ? 'Voiceover'
        : options.blockType === 'caption'
          ? 'Caption'
          : options.blockType === 'cta'
            ? 'Call To Action'
            : 'Script');

    const rewritePrompt = `
Rewrite the following campaign block with meaning preserved but clearly different wording.
Return ONLY plain text.

Block type: ${options.blockType}
Block title: ${targetTitle}
Goal: ${options.goal}
Audience: ${options.liveIntent?.audience || 'general audience'}
Tone: ${options.liveIntent?.tone || 'cinematic'}
Platform: ${options.liveIntent?.platform || 'web'}
Current content:
${options.currentContent || ''}
`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: rewritePrompt,
      });
      const rewritten = String(response.text || '').trim();
      if (rewritten && rewritten !== (options.currentContent || '').trim()) {
        return { title: targetTitle, content: rewritten };
      }
    } catch {
      // fall through to narrative fallback
    }
  }

  const narrative = await generateNarrativeFromGemini(options.goal, options.liveIntent);

  if (options.blockType === 'narration') {
    return { title: options.title || 'Voiceover', content: narrative.narration };
  }
  if (options.blockType === 'caption') {
    return { title: options.title || 'Caption', content: narrative.caption };
  }
  if (options.blockType === 'cta') {
    return { title: options.title || 'Call To Action', content: narrative.cta };
  }

  // "text" block regeneration defaults to script content.
  const fallbackText = narrative.script;
  const current = (options.currentContent || '').trim();
  if (fallbackText.trim() === current && current) {
    return {
      title: options.title || 'Script',
      content: `${current} (refined version)`,
    };
  }
  return { title: options.title || 'Script', content: fallbackText };
}
