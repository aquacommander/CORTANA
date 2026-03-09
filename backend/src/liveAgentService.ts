import { LiveIntent } from '../../frontend/shared/contracts.ts';

type LiveAgentResult = {
  liveIntent: LiveIntent;
  reply: string;
};

const AUDIENCE_HINTS = ['kids', 'developers', 'marketers', 'students', 'founders', 'creators'];
const TONE_HINTS = ['playful', 'cinematic', 'professional', 'friendly', 'bold', 'inspirational', 'fun'];
const PLATFORM_HINTS = ['instagram', 'youtube', 'tiktok', 'linkedin', 'x', 'web'];

function extractHint(message: string, hints: string[]): string | undefined {
  const lower = message.toLowerCase();
  return hints.find((hint) => lower.includes(hint));
}

function normalizeTone(value: string): string {
  if (value === 'fun') return 'playful';
  return value;
}

function normalizePlatform(value: string): string {
  if (value === 'ig') return 'instagram';
  if (value === 'twitter') return 'x';
  return value;
}

function extractLabeledValue(message: string, label: string): string | undefined {
  const regex = new RegExp(`${label}\\s*(?:is|:)?\\s*([a-zA-Z0-9\\s_-]{2,80})`, 'i');
  const match = message.match(regex);
  return match?.[1]?.trim();
}

async function getAI(): Promise<any | null> {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({ apiKey: key });
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

function buildMissingFields(intent: {
  objective: string;
  audience: string;
  tone: string;
  platform: string;
}): Array<'objective' | 'audience' | 'tone' | 'platform'> {
  const missing: Array<'objective' | 'audience' | 'tone' | 'platform'> = [];
  if (!intent.objective) missing.push('objective');
  if (!intent.audience) missing.push('audience');
  if (!intent.tone) missing.push('tone');
  if (!intent.platform) missing.push('platform');
  return missing;
}

function extractObjective(message: string, fallbackGoal: string): string {
  const trimmed = message.trim();
  if (trimmed.length > 5) return trimmed;
  return fallbackGoal;
}

function nextFollowUp(intent: LiveIntent): string {
  if (!intent.objective) return 'What is the main objective of this campaign?';
  if (!intent.audience) return 'Who is the primary audience for this campaign?';
  if (!intent.tone) return 'What tone should I use (playful, cinematic, professional, etc.)?';
  if (!intent.platform) return 'Which platform should we optimize for (instagram, youtube, tiktok, linkedin, web)?';
  return 'Great, I have enough details. I can hand off to Storyteller now.';
}

export function processLiveMessage(params: {
  message: string;
  goal: string;
  previousIntent?: LiveIntent;
}): Promise<LiveAgentResult> {
  return processLiveMessageInternal(params);
}

async function processLiveMessageInternal(params: {
  message: string;
  goal: string;
  previousIntent?: LiveIntent;
}): Promise<LiveAgentResult> {
  const message = params.message.trim();
  const previous = params.previousIntent;
  const lower = message.toLowerCase();
  const interruptionRequested =
    lower === 'stop' ||
    lower === 'cancel' ||
    lower.includes('stop for now') ||
    lower.includes('pause intake');

  if (interruptionRequested) {
    const previousIntent: LiveIntent = previous || {
      intent: 'create_story',
      objective: '',
      audience: '',
      tone: '',
      platform: '',
      readyForStoryGeneration: false,
      handoffTo: 'none',
      missingFields: ['objective', 'audience', 'tone', 'platform'],
      confidence: 0.5,
    };
    return {
      liveIntent: {
        ...previousIntent,
        readyForStoryGeneration: false,
        handoffTo: 'none',
      },
      reply: 'Understood. I paused intake. Send your next message when you want to continue.',
    };
  }

  const ai = await getAI();
  if (ai) {
    const extractionPrompt = `
You are an intake agent for a creative campaign system.
Extract intent fields from user message and previous state.
Return ONLY JSON with keys:
intent, objective, audience, tone, platform, confidence

Allowed intent values: create_story, publish_story
If a field is unknown, return empty string.

Goal: ${params.goal}
Previous state: ${JSON.stringify(previous || {})}
User message: ${message}
`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: extractionPrompt,
      });
      const parsed = tryParseJson(response.text || '{}');
      if (parsed) {
        const objective = String(parsed.objective || previous?.objective || '').trim();
        const audience = String(parsed.audience || previous?.audience || '').trim();
        const tone = normalizeTone(String(parsed.tone || previous?.tone || '').trim().toLowerCase());
        const platform = normalizePlatform(String(parsed.platform || previous?.platform || '').trim().toLowerCase());
        const intentValue =
          String(parsed.intent || '').trim() === 'publish_story' || lower.includes('publish') || lower.includes('post')
            ? 'publish_story'
            : 'create_story';

        const missingFields = buildMissingFields({ objective, audience, tone, platform });
        const readyForStoryGeneration = missingFields.length === 0;
        const liveIntent: LiveIntent = {
          intent: intentValue,
          objective,
          audience,
          tone,
          platform,
          readyForStoryGeneration,
          handoffTo: readyForStoryGeneration ? 'storyteller' : 'none',
          missingFields,
          confidence: Number.isFinite(Number(parsed.confidence))
            ? Math.max(0, Math.min(1, Number(parsed.confidence)))
            : readyForStoryGeneration
              ? 0.85
              : 0.65,
        };

        return {
          liveIntent,
          reply: readyForStoryGeneration
            ? `Perfect - I captured your intent for ${platform}. I can hand off to Storyteller now.`
            : nextFollowUp(liveIntent),
        };
      }
    } catch {
      // Fall back to heuristic parser below.
    }
  }

  const extractedAudience = extractLabeledValue(message, 'audience') || extractHint(message, AUDIENCE_HINTS);
  const extractedTone = extractLabeledValue(message, 'tone') || extractHint(message, TONE_HINTS);
  const extractedPlatform =
    extractLabeledValue(message, 'platform') || extractHint(message, [...PLATFORM_HINTS, 'ig', 'twitter']);

  const audience = extractedAudience || previous?.audience || '';
  const tone = normalizeTone(extractedTone || previous?.tone || '');
  const platform = normalizePlatform(extractedPlatform || previous?.platform || '');
  const objective = extractLabeledValue(message, 'objective') || previous?.objective || extractObjective(message, params.goal);
  const intentValue =
    lower.includes('publish') || lower.includes('post') ? 'publish_story' : previous?.intent || 'create_story';

  const missingFields = buildMissingFields({ objective, audience, tone, platform });
  const readyForStoryGeneration = missingFields.length === 0;

  const liveIntent: LiveIntent = {
    intent: intentValue,
    objective,
    audience: audience || '',
    tone: tone || '',
    platform: platform || '',
    readyForStoryGeneration,
    handoffTo: readyForStoryGeneration ? 'storyteller' : 'none',
    missingFields,
    confidence: readyForStoryGeneration ? 0.8 : 0.6,
  };

  const reply = readyForStoryGeneration
    ? `Perfect - I captured your intent for ${platform}. I can hand off to Storyteller now.`
    : nextFollowUp(liveIntent);

  return { liveIntent, reply };
}
