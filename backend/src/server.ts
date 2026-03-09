import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';
import {
  ExecutionResult,
  NavigatorPlan,
  Session,
  WorkflowStage,
} from '../../frontend/shared/contracts.ts';
import { analyzeNavigatorTarget } from './navigatorAnalyzer.ts';
import { executeNavigatorPlan } from './navigatorExecutor.ts';
import { processLiveMessage } from './liveAgentService.ts';
import { SessionStore } from './sessionStore.ts';
import { buildStoryOutput } from './storytellerService.ts';
import {
  createSessionSchema,
  generateStorySchema,
  getZodErrorMessage,
  liveMessageSchema,
  navigatorAnalyzeSchema,
  navigatorExecuteSchema,
} from './validators.ts';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const store = new SessionStore();
const allowedHosts = (process.env.NAVIGATOR_ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

const STAGE_ORDER: WorkflowStage[] = [
  'INTAKE',
  'STORY_GENERATION',
  'STORY_REVIEW',
  'NAVIGATOR_ANALYSIS',
  'NAVIGATOR_EXECUTION',
  'COMPLETION',
];

app.use(cors({ origin: ['http://localhost:3000'], credentials: false }));
app.use(express.json({ limit: '10mb' }));

function nowIso() {
  return new Date().toISOString();
}

function getSessionOrThrow(sessionId: string): Session {
  const session = store.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return session;
}

function appendLog(session: Session, message: string) {
  session.logs.push(`[${nowIso()}] ${message}`);
  session.updatedAt = nowIso();
}

function moveStage(session: Session, target: WorkflowStage) {
  const currentIndex = STAGE_ORDER.indexOf(session.workflowStage);
  const targetIndex = STAGE_ORDER.indexOf(target);
  if (targetIndex < currentIndex) {
    throw new Error(`Invalid stage regression: ${session.workflowStage} -> ${target}`);
  }
  if (targetIndex > currentIndex + 1) {
    throw new Error(`Invalid stage jump: ${session.workflowStage} -> ${target}`);
  }
  session.workflowStage = target;
  session.updatedAt = nowIso();
}

function ensureStage(session: Session, target: WorkflowStage) {
  while (session.workflowStage !== target) {
    const currentIndex = STAGE_ORDER.indexOf(session.workflowStage);
    const nextStage = STAGE_ORDER[currentIndex + 1];
    if (!nextStage) break;
    moveStage(session, nextStage);
    appendLog(session, `Stage advanced to ${nextStage}`);
  }
}

function resolveHost(urlValue: string): string {
  return new URL(urlValue).hostname.toLowerCase();
}

function assertTargetUrlAllowed(urlValue: string) {
  if (allowedHosts.length === 0) return;
  const host = resolveHost(urlValue);
  if (!allowedHosts.includes(host)) {
    throw new Error(
      `Target host "${host}" is not allowed. Configure NAVIGATOR_ALLOWED_HOSTS with approved hosts.`,
    );
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', sessions: store.size });
});

app.post('/api/session/create', async (req, res) => {
  const parsed = createSessionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: getZodErrorMessage(parsed.error) });
  }
  const { goal } = parsed.data;

  const timestamp = nowIso();
  const session: Session = {
    sessionId: randomUUID(),
    goal,
    status: 'active',
    workflowStage: 'INTAKE',
    conversationSummary: `Session started for: ${goal}`,
    logs: [`[${timestamp}] Session created`],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await store.set(session);
  return res.json({ session });
});

app.get('/api/session/:sessionId', (req, res) => {
  try {
    const session = getSessionOrThrow(req.params.sessionId);
    return res.json({ session });
  } catch (error: any) {
    return res.status(404).json({ error: error.message || 'Session not found' });
  }
});

app.get('/api/session', (_req, res) => {
  const sessions = store.getAll().map((session) => ({
    sessionId: session.sessionId,
    goal: session.goal,
    status: session.status,
    workflowStage: session.workflowStage,
    updatedAt: session.updatedAt,
  }));
  return res.json({ sessions });
});

app.post('/api/session/:sessionId/restart-from-review', async (req, res) => {
  try {
    const session = getSessionOrThrow(req.params.sessionId);
    if (!session.storyOutput) {
      return res.status(400).json({ error: 'Cannot restart session without story output' });
    }

    session.workflowStage = 'STORY_REVIEW';
    session.status = 'active';
    session.navigatorPlan = undefined;
    session.executionResult = undefined;
    appendLog(session, 'Session restarted from STORY_REVIEW');
    await store.set(session);
    return res.json({ session });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to restart session' });
  }
});

app.post('/api/live/message', async (req, res) => {
  try {
    const parsed = liveMessageSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: getZodErrorMessage(parsed.error) });
    }
    const { sessionId, message } = parsed.data;

    const session = getSessionOrThrow(sessionId);
    const { liveIntent, reply } = await processLiveMessage({
      message,
      goal: session.goal,
      previousIntent: session.liveIntent,
    });

    session.liveIntent = liveIntent;
    session.conversationSummary = `${session.conversationSummary} | User: ${message}`;
    appendLog(session, 'Live message received and intent updated');

    if (liveIntent.readyForStoryGeneration && session.workflowStage === 'INTAKE') {
      moveStage(session, 'STORY_GENERATION');
      appendLog(session, 'Stage advanced to STORY_GENERATION');
    }
    await store.set(session);

    return res.json({
      liveIntent,
      reply,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to process live message' });
  }
});

app.post('/api/story/generate', async (req, res) => {
  try {
    const parsed = generateStorySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: getZodErrorMessage(parsed.error) });
    }
    const {
      sessionId,
      text,
      style,
      typographyPrompt,
      referenceImage,
      imageUrl,
      videoUrl,
      generateAssets,
    } = parsed.data;
    const session = getSessionOrThrow(sessionId);

    ensureStage(session, 'STORY_GENERATION');
    if (!session.liveIntent?.readyForStoryGeneration) {
      return res.status(400).json({
        error: 'Live intent is incomplete. Continue intake conversation before story generation.',
      });
    }

    const storyOutput = await buildStoryOutput({
      sessionId: randomUUID(),
      goal: text?.trim() || session.goal,
      liveIntent: session.liveIntent,
      style,
      typographyPrompt,
      referenceImage,
      imageUrl,
      videoUrl,
      generateAssets: generateAssets ?? false,
    });

    session.storyOutput = storyOutput;
    appendLog(session, 'Story output generated');
    moveStage(session, 'STORY_REVIEW');
    appendLog(session, 'Stage advanced to STORY_REVIEW');
    await store.set(session);

    return res.json({ storyOutput });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to generate story' });
  }
});

app.post('/api/navigator/analyze', async (req, res) => {
  try {
    const parsed = navigatorAnalyzeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: getZodErrorMessage(parsed.error) });
    }
    const { sessionId, screenshotBase64, targetUrl } = parsed.data;
    if (targetUrl) {
      assertTargetUrlAllowed(targetUrl);
    }

    const session = getSessionOrThrow(sessionId);
    ensureStage(session, 'STORY_REVIEW');
    moveStage(session, 'NAVIGATOR_ANALYSIS');
    appendLog(session, 'Stage advanced to NAVIGATOR_ANALYSIS');

    const navigatorPlan: NavigatorPlan = await analyzeNavigatorTarget({
      targetUrl,
      storyTitle: session.storyOutput?.title || `Story for "${session.goal}"`,
      goal: session.goal,
    });

    session.navigatorPlan = navigatorPlan;
    appendLog(session, `Navigator screenshot received (${screenshotBase64.length} chars)`);
    if (targetUrl) {
      session.navigatorTargetUrl = targetUrl;
      appendLog(session, `Navigator target URL set to ${targetUrl}`);
    }
    appendLog(session, 'Navigator analysis generated');
    await store.set(session);
    return res.json({ navigatorPlan });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to analyze navigator input' });
  }
});

app.post('/api/navigator/execute', async (req, res) => {
  try {
    const parsed = navigatorExecuteSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: getZodErrorMessage(parsed.error) });
    }
    const { sessionId, targetUrl, mode, headless } = parsed.data;

    const session = getSessionOrThrow(sessionId);
    ensureStage(session, 'NAVIGATOR_ANALYSIS');
    moveStage(session, 'NAVIGATOR_EXECUTION');
    appendLog(session, 'Stage advanced to NAVIGATOR_EXECUTION');

    const selectedMode = mode || (process.env.NAVIGATOR_MODE === 'playwright' ? 'playwright' : 'mock');
    const selectedTarget = targetUrl || session.navigatorTargetUrl || process.env.NAVIGATOR_TARGET_URL;
    if (selectedMode === 'playwright') {
      if (!selectedTarget) {
        return res.status(400).json({ error: 'Playwright mode requires targetUrl' });
      }
      assertTargetUrlAllowed(selectedTarget);
    }
    const executionResult: ExecutionResult = await executeNavigatorPlan(session.navigatorPlan, {
      mode: selectedMode,
      targetUrl: selectedTarget,
      headless: headless ?? true,
    });

    session.executionResult = executionResult;
    appendLog(session, `Navigator actions executed (${selectedMode} mode)`);
    moveStage(session, 'COMPLETION');
    session.status = executionResult.status === 'failed' ? 'failed' : 'completed';
    appendLog(session, 'Stage advanced to COMPLETION and session marked completed');
    await store.set(session);

    return res.json({ executionResult });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to execute navigator plan' });
  }
});

async function startServer() {
  await store.initialize();
  app.listen(PORT, () => {
    console.log(`Backend server listening on http://localhost:${PORT}`);
    console.log(`Loaded sessions: ${store.size}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start backend:', error);
  process.exit(1);
});
