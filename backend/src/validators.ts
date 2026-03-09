import { z } from 'zod';

const requiredString = (label: string, max = 5000) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value : ''),
    z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`),
  );

export const createSessionSchema = z.object({
  goal: requiredString('Goal', 500),
});

export const liveMessageSchema = z.object({
  sessionId: requiredString('sessionId', 120),
  message: requiredString('message', 5000),
});

export const generateStorySchema = z.object({
  sessionId: requiredString('sessionId', 120),
  text: z.string().trim().max(2000, 'text is too long').optional(),
  style: z.string().trim().max(2000, 'style is too long').optional(),
  typographyPrompt: z.string().trim().max(2000, 'typographyPrompt is too long').optional(),
  referenceImage: z.string().trim().max(30000000, 'referenceImage is too long').optional(),
  imageUrl: z.string().trim().url('imageUrl must be a valid URL').optional(),
  videoUrl: z.string().trim().url('videoUrl must be a valid URL').optional(),
  generateAssets: z.boolean().optional(),
});

export const regenerateStoryBlockSchema = z.object({
  sessionId: requiredString('sessionId', 120),
  blockType: z.enum(['text', 'narration', 'caption', 'cta']),
  title: z.string().trim().max(120, 'title is too long').optional(),
  blockIndex: z.number().int().min(0).max(200).optional(),
  currentContent: z.string().trim().max(12000, 'currentContent is too long').optional(),
});

export const navigatorAnalyzeSchema = z.object({
  sessionId: requiredString('sessionId', 120),
  screenshotBase64: requiredString('screenshotBase64', 20000000),
  targetUrl: z.string().trim().url('targetUrl must be a valid URL').optional(),
});

export const navigatorExecuteSchema = z.object({
  sessionId: requiredString('sessionId', 120),
  mode: z.enum(['mock', 'playwright']).optional(),
  targetUrl: z.string().trim().url('targetUrl must be a valid URL').optional(),
  headless: z.boolean().optional(),
});

export function getZodErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request payload';
  const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  return `${path}${issue.message}`;
}
