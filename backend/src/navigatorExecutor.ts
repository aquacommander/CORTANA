import { ExecutionResult, NavigatorAction, NavigatorPlan } from '../../frontend/shared/contracts.ts';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type NavigatorExecutionMode = 'mock' | 'playwright';

type ExecuteNavigatorOptions = {
  mode: NavigatorExecutionMode;
  targetUrl?: string;
  headless?: boolean;
};

type ExecutableStep = {
  action: NavigatorAction['action'];
  target: string;
  value?: string;
};

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, '');
}

function buildMockResult(actionPlan: NavigatorAction[]): ExecutionResult {
  const steps = actionPlan.map((action) => ({
    action: action.action,
    target: action.target,
    status: 'success' as const,
    note: `Executed ${action.action} on ${action.target}`,
  }));

  return {
    status: 'success',
    steps,
    logs: [
      'Navigator execution started (mock mode)',
      ...steps.map((step) => step.note || ''),
      'Navigator execution finished',
    ],
    completedActions: steps.length,
  };
}

async function resolveUploadPath(value: string): Promise<string> {
  if (value.startsWith('data:')) {
    const matches = value.match(/^data:(.*?);base64,(.*)$/);
    if (!matches) throw new Error('Invalid data URL for upload_file action');
    const mimeType = matches[1] || 'application/octet-stream';
    const base64 = matches[2];
    const extension =
      mimeType.includes('png') ? '.png' :
      mimeType.includes('jpeg') || mimeType.includes('jpg') ? '.jpg' :
      mimeType.includes('gif') ? '.gif' :
      mimeType.includes('webp') ? '.webp' :
      mimeType.includes('mp4') ? '.mp4' : '.bin';
    const tempPath = path.join(os.tmpdir(), `navigator-upload-${randomUUID()}${extension}`);
    await writeFile(tempPath, Buffer.from(base64, 'base64'));
    return tempPath;
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    const response = await fetch(value);
    if (!response.ok) {
      throw new Error(`Failed to download upload_file source: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const extension =
      contentType.includes('png') ? '.png' :
      contentType.includes('jpeg') || contentType.includes('jpg') ? '.jpg' :
      contentType.includes('gif') ? '.gif' :
      contentType.includes('webp') ? '.webp' :
      contentType.includes('mp4') ? '.mp4' : '.bin';
    const tempPath = path.join(os.tmpdir(), `navigator-upload-${randomUUID()}${extension}`);
    await writeFile(tempPath, Buffer.from(arrayBuffer));
    return tempPath;
  }
  return value;
}

async function executeWithPlaywright(
  actionPlan: NavigatorAction[],
  targetUrl: string,
  headless: boolean,
): Promise<ExecutionResult> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  const steps: ExecutionResult['steps'] = [];
  const logs: string[] = ['Navigator execution started (playwright mode)'];

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    logs.push(`Opened ${targetUrl}`);

    for (const action of actionPlan) {
      const step: ExecutableStep = {
        action: action.action,
        target: action.target,
        value: action.value,
      };

      try {
        if (step.action === 'click') {
          await page.click(step.target, { timeout: 5000 });
        } else if (step.action === 'type') {
          await page.fill(step.target, step.value || '');
        } else if (step.action === 'wait') {
          const ms = Number(step.value || 1000);
          await page.waitForTimeout(Number.isFinite(ms) ? ms : 1000);
        } else if (step.action === 'scroll') {
          await page.locator(step.target).scrollIntoViewIfNeeded();
        } else if (step.action === 'upload_file') {
          if (!step.value) throw new Error('Missing file path in step.value');
          const uploadPath = await resolveUploadPath(step.value);
          await page.setInputFiles(step.target, uploadPath);
        } else {
          throw new Error(`Unsupported action: ${step.action}`);
        }

        steps.push({
          action: step.action,
          target: step.target,
          status: 'success',
          note: `Executed ${step.action} on ${step.target}`,
        });
      } catch (error: any) {
        const rawMessage = String(error?.message || 'unknown error');
        const failNote = `Failed ${step.action} on ${step.target}: ${stripAnsi(rawMessage)}`;
        steps.push({
          action: step.action,
          target: step.target,
          status: 'failed',
          note: failNote,
        });
        logs.push(failNote);
      }
    }

    const completedActions = steps.filter((step) => step.status === 'success').length;
    const failed = steps.length - completedActions;
    const status: ExecutionResult['status'] =
      failed === 0 ? 'success' : completedActions > 0 ? 'partial' : 'failed';

    logs.push('Navigator execution finished');

    return {
      status,
      steps,
      logs,
      completedActions,
      error: failed > 0 ? `${failed} step(s) failed during browser execution` : undefined,
    };
  } finally {
    await browser.close();
  }
}

export async function executeNavigatorPlan(
  navigatorPlan: NavigatorPlan | undefined,
  options: ExecuteNavigatorOptions,
): Promise<ExecutionResult> {
  const actionPlan = navigatorPlan?.actionPlan || [];

  if (options.mode === 'mock') {
    return buildMockResult(actionPlan);
  }

  if (!options.targetUrl) {
    throw new Error('Playwright mode requires a targetUrl');
  }

  return executeWithPlaywright(actionPlan, options.targetUrl, options.headless ?? true);
}
