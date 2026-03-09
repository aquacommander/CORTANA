import { NavigatorPlan } from '../../frontend/shared/contracts.ts';

type AnalyzeNavigatorOptions = {
  targetUrl?: string;
  storyTitle: string;
  goal: string;
  screenshotBase64?: string;
  screenRecordingBase64?: string;
  storyContext?: {
    summary?: string;
    script?: string;
    caption?: string;
    cta?: string;
    imageAssetUrl?: string;
    videoAssetUrl?: string;
  };
};

type SelectorHints = {
  titleInput?: string;
  descriptionInput?: string;
  captionInput?: string;
  fileInput?: string;
  submitButton?: string;
};

const FALLBACK_SELECTORS: SelectorHints = {
  titleInput: '#title',
  descriptionInput: '#description',
  captionInput: '#caption',
  fileInput: 'input[type="file"]',
  submitButton: 'button[type="submit"]',
};

function summarizeError(error: unknown): string {
  const raw = String((error as any)?.message || error || 'unknown error');
  const noAnsi = raw.replace(/\u001b\[[0-9;]*m/g, '');
  const firstLine = noAnsi.split('\n')[0]?.trim() || 'unknown error';
  if (firstLine.toLowerCase().includes('executable doesn')) {
    return 'Playwright browser executable is missing. Run `npx playwright install chromium`.';
  }
  return firstLine;
}

function buildPlanFromSelectors(
  selectors: SelectorHints,
  values: {
    titleValue: string;
    descriptionValue?: string;
    captionValue?: string;
    imageAssetUrl?: string;
  },
  notes: string,
  confidence: number,
): NavigatorPlan {
  const clamp = (value: number) => Math.max(0.6, Math.min(0.99, Number(value.toFixed(2))));
  const detectedElements: NavigatorPlan['detectedElements'] = [];
  const actionPlan: NavigatorPlan['actionPlan'] = [];

  if (selectors.titleInput) {
    detectedElements.push({ name: 'Title input', selectorHint: selectors.titleInput, confidence: clamp(confidence) });
    actionPlan.push({ action: 'click', target: selectors.titleInput, confidence: clamp(confidence), reason: 'Focus title field' });
    actionPlan.push({
      action: 'type',
      target: selectors.titleInput,
      value: values.titleValue,
      confidence: clamp(confidence - 0.01),
      reason: 'Set title',
    });
  }

  if (selectors.descriptionInput) {
    detectedElements.push({
      name: 'Description input',
      selectorHint: selectors.descriptionInput,
      confidence: clamp(confidence - 0.03),
    });
    if (values.descriptionValue) {
      actionPlan.push({
        action: 'click',
        target: selectors.descriptionInput,
        confidence: clamp(confidence - 0.03),
        reason: 'Focus description field',
      });
      actionPlan.push({
        action: 'type',
        target: selectors.descriptionInput,
        value: values.descriptionValue,
        confidence: clamp(confidence - 0.04),
        reason: 'Fill description/story context',
      });
    }
  }

  if (selectors.captionInput) {
    detectedElements.push({
      name: 'Caption input',
      selectorHint: selectors.captionInput,
      confidence: clamp(confidence - 0.03),
    });
    if (values.captionValue) {
      actionPlan.push({
        action: 'click',
        target: selectors.captionInput,
        confidence: clamp(confidence - 0.03),
        reason: 'Focus caption field',
      });
      actionPlan.push({
        action: 'type',
        target: selectors.captionInput,
        value: values.captionValue,
        confidence: clamp(confidence - 0.04),
        reason: 'Set caption',
      });
    }
  }

  if (selectors.fileInput) {
    detectedElements.push({
      name: 'File upload input',
      selectorHint: selectors.fileInput,
      confidence: clamp(confidence - 0.04),
    });
    if (values.imageAssetUrl) {
      actionPlan.push({
        action: 'upload_file',
        target: selectors.fileInput,
        value: values.imageAssetUrl,
        confidence: clamp(confidence - 0.05),
        reason: 'Upload generated campaign image asset',
      });
    }
  }

  if (selectors.submitButton) {
    detectedElements.push({
      name: 'Publish button',
      selectorHint: selectors.submitButton,
      confidence: clamp(confidence - 0.02),
    });
    actionPlan.push({
      action: 'click',
      target: selectors.submitButton,
      confidence: clamp(confidence - 0.02),
      reason: 'Publish story',
    });
  }

  if (actionPlan.length === 0) {
    actionPlan.push({
      action: 'wait',
      target: 'body',
      value: '500',
      confidence: 0.6,
      reason: 'No actionable selectors detected, keeping workflow deterministic.',
    });
  }

  return {
    detectedElements,
    actionPlan,
    confidence: clamp(confidence),
    notes,
  };
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

async function analyzeFromScreenshotWithGemini(options: AnalyzeNavigatorOptions): Promise<NavigatorPlan | null> {
  if (!options.screenshotBase64) return null;
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              data: options.screenshotBase64.replace(/^data:.*;base64,/, ''),
              mimeType: 'image/png',
            },
          },
          {
            text: `You are a visual UI navigator planner.
Return ONLY valid JSON with keys:
detectedElements, actionPlan, confidence, notes

Requirements:
- detectedElements: array of {name, selectorHint, confidence}
- actionPlan: array of {action, target, value?, confidence, reason}
- action must be one of click|type|upload_file|scroll|wait
- Use practical selector hints based on visual cues even if exact DOM is unknown.
- Include steps to enter title "${options.storyTitle}" and publish.
Goal: ${options.goal}
`,
          },
        ],
      },
    });

    const parsed = tryParseJson(response.text || '{}');
    if (!parsed || !Array.isArray(parsed.actionPlan) || !Array.isArray(parsed.detectedElements)) {
      return null;
    }
    const clamp = (v: number) => Math.max(0.6, Math.min(0.99, Number((Number(v) || 0.75).toFixed(2))));
    return {
      detectedElements: parsed.detectedElements
        .slice(0, 8)
        .map((item: any) => ({
          name: String(item?.name || 'UI element'),
          selectorHint: String(item?.selectorHint || 'body'),
          confidence: clamp(item?.confidence),
        })),
      actionPlan: parsed.actionPlan.slice(0, 8).map((item: any) => ({
        action: ['click', 'type', 'upload_file', 'scroll', 'wait'].includes(item?.action)
          ? item.action
          : 'wait',
        target: String(item?.target || 'body'),
        value: item?.value ? String(item.value) : undefined,
        confidence: clamp(item?.confidence),
        reason: String(item?.reason || 'Visual-first plan step'),
      })),
      confidence: clamp(parsed.confidence),
      notes: String(parsed.notes || 'Generated from screenshot visual analysis.'),
    };
  } catch {
    return null;
  }
}

async function analyzeFromScreenRecordingWithGemini(options: AnalyzeNavigatorOptions): Promise<NavigatorPlan | null> {
  if (!options.screenRecordingBase64) return null;
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              data: options.screenRecordingBase64.replace(/^data:.*;base64,/, ''),
              mimeType: 'video/mp4',
            },
          },
          {
            text: `Analyze this UI recording and produce executable publish actions.
Return ONLY JSON with keys detectedElements, actionPlan, confidence, notes.
Use action enum: click|type|upload_file|scroll|wait.
Target title should be "${options.storyTitle}".`,
          },
        ],
      },
    });
    const parsed = tryParseJson(response.text || '{}');
    if (!parsed || !Array.isArray(parsed.actionPlan) || !Array.isArray(parsed.detectedElements)) return null;
    const clamp = (v: number) => Math.max(0.6, Math.min(0.99, Number((Number(v) || 0.75).toFixed(2))));
    return {
      detectedElements: parsed.detectedElements.slice(0, 8).map((item: any) => ({
        name: String(item?.name || 'UI element'),
        selectorHint: String(item?.selectorHint || 'body'),
        confidence: clamp(item?.confidence),
      })),
      actionPlan: parsed.actionPlan.slice(0, 8).map((item: any) => ({
        action: ['click', 'type', 'upload_file', 'scroll', 'wait'].includes(item?.action) ? item.action : 'wait',
        target: String(item?.target || 'body'),
        value: item?.value ? String(item.value) : undefined,
        confidence: clamp(item?.confidence),
        reason: String(item?.reason || 'Video-based visual action'),
      })),
      confidence: clamp(parsed.confidence),
      notes: String(parsed.notes || 'Generated from screen recording visual analysis.'),
    };
  } catch {
    return null;
  }
}

async function detectSelectorsFromPage(targetUrl: string): Promise<SelectorHints | null> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const selectors = await page.evaluate(() => {
      const titleCandidates = [
        '#title',
        'input[name="title"]',
        'input[id*="title"]',
        'input[placeholder*="title" i]',
        'input[type="text"]',
        'textarea[name="title"]',
      ];
      const descriptionCandidates = [
        '#description',
        'textarea[name="description"]',
        'textarea[id*="description"]',
        'textarea[placeholder*="description" i]',
        'textarea',
      ];
      const submitCandidates = [
        'button[type="submit"]',
        'button[id*="publish" i]',
        'button',
        'input[type="submit"]',
      ];
      const captionCandidates = [
        '#caption',
        'textarea[name="caption"]',
        'textarea[id*="caption"]',
        'textarea[placeholder*="caption" i]',
      ];
      const fileCandidates = [
        'input[type="file"]',
        'input[name*="image" i]',
        'input[id*="image" i]',
        'input[name*="upload" i]',
      ];

      let titleInput: string | null = null;
      let descriptionInput: string | null = null;
      let captionInput: string | null = null;
      let fileInput: string | null = null;
      let submitButton: string | null = null;

      for (const selector of titleCandidates) {
        try {
          if (document.querySelector(selector)) {
            titleInput = selector;
            break;
          }
        } catch {
          // Ignore invalid selectors in browser context.
        }
      }

      for (const selector of descriptionCandidates) {
        try {
          if (document.querySelector(selector)) {
            descriptionInput = selector;
            break;
          }
        } catch {
          // Ignore invalid selectors in browser context.
        }
      }

      for (const selector of submitCandidates) {
        try {
          if (document.querySelector(selector)) {
            submitButton = selector;
            break;
          }
        } catch {
          // Ignore invalid selectors in browser context.
        }
      }

      for (const selector of captionCandidates) {
        try {
          if (document.querySelector(selector)) {
            captionInput = selector;
            break;
          }
        } catch {
          // Ignore invalid selectors in browser context.
        }
      }

      for (const selector of fileCandidates) {
        try {
          if (document.querySelector(selector)) {
            fileInput = selector;
            break;
          }
        } catch {
          // Ignore invalid selectors in browser context.
        }
      }

      return { titleInput, descriptionInput, captionInput, fileInput, submitButton };
    });

    if (!selectors.titleInput && !selectors.submitButton) {
      return null;
    }

    return {
      titleInput: selectors.titleInput || undefined,
      descriptionInput: selectors.descriptionInput || undefined,
      captionInput: selectors.captionInput || undefined,
      fileInput: selectors.fileInput || undefined,
      submitButton: selectors.submitButton || undefined,
    };
  } finally {
    await browser.close();
  }
}

export async function analyzeNavigatorTarget(options: AnalyzeNavigatorOptions): Promise<NavigatorPlan> {
  const titleValue = options.storyTitle || `Story for "${options.goal}"`;
  const descriptionValue =
    options.storyContext?.script ||
    options.storyContext?.summary ||
    `Campaign description for ${options.goal}`;
  const captionValue = [options.storyContext?.caption, options.storyContext?.cta]
    .filter(Boolean)
    .join('\n');
  const maybeTargetUrl = options.targetUrl?.trim();

  const recordingPlan = await analyzeFromScreenRecordingWithGemini(options);
  if (recordingPlan) {
    return {
      ...recordingPlan,
      notes: `${recordingPlan.notes} Source: Gemini screen-recording analysis.`,
    };
  }

  const visualPlan = await analyzeFromScreenshotWithGemini(options);
  if (visualPlan) {
    return {
      ...visualPlan,
      notes: `${visualPlan.notes} Source: Gemini screenshot analysis.`,
    };
  }

  if (!maybeTargetUrl) {
    return buildPlanFromSelectors(
      FALLBACK_SELECTORS,
      {
        titleValue,
        descriptionValue,
        captionValue,
        imageAssetUrl: options.storyContext?.imageAssetUrl,
      },
      'No target URL provided. Using fallback deterministic selector plan.',
      0.89,
    );
  }

  try {
    const detected = await detectSelectorsFromPage(maybeTargetUrl);
    if (!detected) {
      return buildPlanFromSelectors(
        FALLBACK_SELECTORS,
        {
          titleValue,
          descriptionValue,
          captionValue,
          imageAssetUrl: options.storyContext?.imageAssetUrl,
        },
        `Target URL analyzed (${maybeTargetUrl}), but required elements were not detected. Using fallback plan.`,
        0.72,
      );
    }

    return buildPlanFromSelectors(
      detected,
      {
        titleValue,
        descriptionValue,
        captionValue,
        imageAssetUrl: options.storyContext?.imageAssetUrl,
      },
      `Selector plan generated from live page analysis: ${maybeTargetUrl}`,
      0.93,
    );
  } catch (error: any) {
    return buildPlanFromSelectors(
      FALLBACK_SELECTORS,
      {
        titleValue,
        descriptionValue,
        captionValue,
        imageAssetUrl: options.storyContext?.imageAssetUrl,
      },
      `Live page analysis failed (${summarizeError(error)}). Using fallback plan.`,
      0.7,
    );
  }
}
