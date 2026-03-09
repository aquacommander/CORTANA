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

function extractObjective(message: string, fallbackGoal: string): string {
  const trimmed = message.trim();
  if (trimmed.length > 5) return trimmed;
  return fallbackGoal;
}

function nextFollowUp(intent: LiveIntent): string {
  if (!intent.audience) return 'Who is the primary audience for this campaign?';
  if (!intent.tone) return 'What tone should I use (playful, cinematic, professional, etc.)?';
  if (!intent.platform) return 'Which platform should we optimize for (instagram, youtube, tiktok, linkedin, web)?';
  return 'Great, I have enough details. I can hand off to Storyteller now.';
}

export function processLiveMessage(params: {
  message: string;
  goal: string;
  previousIntent?: LiveIntent;
}): LiveAgentResult {
  const message = params.message.trim();
  const previous = params.previousIntent;
  const lower = message.toLowerCase();

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

  const readyForStoryGeneration = Boolean(objective && audience && tone && platform);

  const liveIntent: LiveIntent = {
    intent: intentValue,
    objective,
    audience: audience || '',
    tone: tone || '',
    platform: platform || '',
    readyForStoryGeneration,
    handoffTo: readyForStoryGeneration ? 'storyteller' : 'none',
  };

  const reply = readyForStoryGeneration
    ? `Perfect - I captured your intent for ${platform}. I can hand off to Storyteller now.`
    : nextFollowUp(liveIntent);

  return { liveIntent, reply };
}
