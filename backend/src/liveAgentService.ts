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

function extractObjective(message: string, fallbackGoal: string): string {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  const looksLikeCommand =
    lower.includes('generate') || lower.includes('go ahead') || lower.includes('continue');
  if (trimmed.length > 5 && !looksLikeCommand) return trimmed;
  return fallbackGoal;
}

function nextFollowUp(intent: LiveIntent): string {
  if (!intent.audience) return 'Who is the primary audience for this campaign?';
  if (!intent.tone) return 'What tone should I use (playful, cinematic, professional, etc.)?';
  if (!intent.platform) return 'Which platform should we optimize for (instagram, youtube, tiktok, linkedin, web)?';
  return 'Great, I have enough details. Say "generate story" to continue.';
}

export function processLiveMessage(params: {
  message: string;
  goal: string;
  previousIntent?: LiveIntent;
}): LiveAgentResult {
  const message = params.message.trim();
  const previous = params.previousIntent;
  const lower = message.toLowerCase();

  const audience = extractHint(message, AUDIENCE_HINTS) || previous?.audience || '';
  const tone = normalizeTone(extractHint(message, TONE_HINTS) || previous?.tone || '');
  const platform = extractHint(message, PLATFORM_HINTS) || previous?.platform || '';
  const objective = previous?.objective || extractObjective(message, params.goal);
  const intentValue =
    lower.includes('publish') || lower.includes('post') ? 'publish_story' : previous?.intent || 'create_story';

  const hasExplicitGenerateRequest =
    lower.includes('generate') || lower.includes('go ahead') || lower.includes('continue');
  const hasAllRequiredFields = Boolean(objective && audience && tone && platform);
  const readyForStoryGeneration =
    Boolean(previous?.readyForStoryGeneration) ||
    (hasAllRequiredFields && (hasExplicitGenerateRequest || !previous));

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
