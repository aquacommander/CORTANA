import { NavigatorPlan } from '../../frontend/shared/contracts.ts';

type AnalyzeNavigatorOptions = {
  targetUrl?: string;
  storyTitle: string;
  goal: string;
};

type SelectorHints = {
  titleInput: string;
  descriptionInput: string;
  submitButton: string;
};

const FALLBACK_SELECTORS: SelectorHints = {
  titleInput: '#title',
  descriptionInput: '#description',
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
  titleValue: string,
  notes: string,
  confidence: number,
): NavigatorPlan {
  return {
    detectedElements: [
      { name: 'Title input', selectorHint: selectors.titleInput, confidence },
      { name: 'Description input', selectorHint: selectors.descriptionInput, confidence: Math.max(0.6, confidence - 0.03) },
      { name: 'Publish button', selectorHint: selectors.submitButton, confidence: Math.max(0.6, confidence - 0.02) },
    ],
    actionPlan: [
      { action: 'click', target: selectors.titleInput, confidence, reason: 'Focus title field' },
      { action: 'type', target: selectors.titleInput, value: titleValue, confidence: Math.max(0.6, confidence - 0.01), reason: 'Set title' },
      { action: 'click', target: selectors.submitButton, confidence: Math.max(0.6, confidence - 0.02), reason: 'Publish story' },
    ],
    confidence,
    notes,
  };
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

      let titleInput: string | null = null;
      let descriptionInput: string | null = null;
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

      return { titleInput, descriptionInput, submitButton };
    });

    if (!selectors.titleInput || !selectors.submitButton) {
      return null;
    }

    return {
      titleInput: selectors.titleInput,
      descriptionInput: selectors.descriptionInput || FALLBACK_SELECTORS.descriptionInput,
      submitButton: selectors.submitButton,
    };
  } finally {
    await browser.close();
  }
}

export async function analyzeNavigatorTarget(options: AnalyzeNavigatorOptions): Promise<NavigatorPlan> {
  const titleValue = `Story for "${options.goal}"`;
  const maybeTargetUrl = options.targetUrl?.trim();

  if (!maybeTargetUrl) {
    return buildPlanFromSelectors(
      FALLBACK_SELECTORS,
      options.storyTitle || titleValue,
      'No target URL provided. Using fallback deterministic selector plan.',
      0.89,
    );
  }

  try {
    const detected = await detectSelectorsFromPage(maybeTargetUrl);
    if (!detected) {
      return buildPlanFromSelectors(
        FALLBACK_SELECTORS,
        options.storyTitle || titleValue,
        `Target URL analyzed (${maybeTargetUrl}), but required elements were not detected. Using fallback plan.`,
        0.72,
      );
    }

    return buildPlanFromSelectors(
      detected,
      options.storyTitle || titleValue,
      `Selector plan generated from live page analysis: ${maybeTargetUrl}`,
      0.93,
    );
  } catch (error: any) {
    return buildPlanFromSelectors(
      FALLBACK_SELECTORS,
      options.storyTitle || titleValue,
      `Live page analysis failed (${summarizeError(error)}). Using fallback plan.`,
      0.7,
    );
  }
}
