import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import {
  ExecutionResult,
  NavigatorPlan,
  Session,
  WorkflowStage,
} from '../../frontend/shared/contracts.ts';
import { analyzeNavigatorTarget } from './navigatorAnalyzer.ts';
import { executeNavigatorPlan } from './navigatorExecutor.ts';
import { getKnowledgeContext } from './knowledgeService.ts';
import { processLiveMessage } from './liveAgentService.ts';
import { attachLiveWsGateway } from './liveWsGateway.ts';
import {
  getRealtimeProviderMatrix,
  hasRealtimeSession,
  sendRealtimeMessage,
  startRealtimeSession,
  stopRealtimeSession,
} from './liveRealtimeService.ts';
import { SessionStore } from './sessionStore.ts';
import { buildStoryOutput, regenerateStoryBlock } from './storytellerService.ts';
import {
  createSessionSchema,
  generateStorySchema,
  getZodErrorMessage,
  liveMessageSchema,
  liveRealtimeMessageSchema,
  liveRealtimeStartSchema,
  navigatorAnalyzeSchema,
  navigatorExecuteSchema,
  regenerateStoryBlockSchema,
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

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function processAndPersistLiveMessage(sessionId: string, message: string, screenshotBase64?: string) {
  const session = getSessionOrThrow(sessionId);
  const knowledgeContext = await getKnowledgeContext(`${session.goal}\n${message}`);
  const { liveIntent, reply } = await processLiveMessage({
    message,
    goal: session.goal,
    previousIntent: session.liveIntent,
    knowledgeContext,
    screenshotBase64,
  });

  session.liveIntent = liveIntent;
  session.conversationSummary = `${session.conversationSummary} | User: ${message}`;
  appendLog(session, 'Live message received and intent updated');

  if (liveIntent.readyForStoryGeneration && session.workflowStage === 'INTAKE') {
    moveStage(session, 'STORY_GENERATION');
    appendLog(session, 'Stage advanced to STORY_GENERATION');
  }
  await store.set(session);
  return { liveIntent, reply };
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
    const { sessionId, message, screenshotBase64 } = parsed.data;
    const { liveIntent, reply } = await processAndPersistLiveMessage(sessionId, message, screenshotBase64);

    return res.json({
      liveIntent,
      reply,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to process live message' });
  }
});

app.post('/api/live/message-stream', async (req, res) => {
  try {
    const parsed = liveMessageSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: getZodErrorMessage(parsed.error) });
    }
    const { sessionId, message, screenshotBase64 } = parsed.data;
    const { liveIntent, reply } = await processAndPersistLiveMessage(sessionId, message, screenshotBase64);

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const words = reply.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += 1) {
      const chunk = `${words[i]}${i < words.length - 1 ? ' ' : ''}`;
      res.write(`${JSON.stringify({ type: 'delta', delta: chunk })}\n`);
      await sleep(45);
    }
    res.write(`${JSON.stringify({ type: 'final', liveIntent, reply })}\n`);
    return res.end();
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to stream live message' });
  }
});

app.post('/api/live/realtime/session/start', async (req, res) => {
  const parsed = liveRealtimeStartSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: getZodErrorMessage(parsed.error) });
  }
  try {
    const session = getSessionOrThrow(parsed.data.sessionId);
    const live = await startRealtimeSession({
      sessionId: session.sessionId,
      goal: session.goal,
    });
    appendLog(session, `Realtime session started (${live.liveSessionId})`);
    return res.json(live);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to start realtime session' });
  }
});

app.post('/api/live/realtime/session/:liveSessionId/message', async (req, res) => {
  const parsed = liveRealtimeMessageSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: getZodErrorMessage(parsed.error) });
  }
  try {
    const { liveSessionId } = req.params;
    if (!hasRealtimeSession(liveSessionId)) {
      return res.status(404).json({ error: `Live session not found: ${liveSessionId}` });
    }
    const reply = await sendRealtimeMessage(liveSessionId, parsed.data.message);
    return res.json({ reply });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to process realtime message' });
  }
});

app.post('/api/live/realtime/session/:liveSessionId/stop', async (req, res) => {
  const { liveSessionId } = req.params;
  await stopRealtimeSession(liveSessionId);
  return res.json({ stopped: true, liveSessionId });
});

app.get('/api/live/realtime/provider-matrix', (_req, res) => {
  return res.json(getRealtimeProviderMatrix());
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
      guidanceContext: await getKnowledgeContext(
        `${text?.trim() || session.goal}\n${session.conversationSummary}\n${JSON.stringify(session.liveIntent || {})}`,
      ),
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

app.post('/api/story/generate-stream', async (req, res) => {
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
      guidanceContext: await getKnowledgeContext(
        `${text?.trim() || session.goal}\n${session.conversationSummary}\n${JSON.stringify(session.liveIntent || {})}`,
      ),
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

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.write(`${JSON.stringify({ type: 'status', message: 'Story generation started' })}\n`);
    for (const block of storyOutput.blocks) {
      res.write(`${JSON.stringify({ type: 'block', block })}\n`);
      await sleep(40);
    }
    res.write(`${JSON.stringify({ type: 'final', storyOutput })}\n`);
    return res.end();
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to stream story generation' });
  }
});

app.post('/api/story/regenerate-block', async (req, res) => {
  try {
    const parsed = regenerateStoryBlockSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: getZodErrorMessage(parsed.error) });
    }
    const { sessionId, blockType, title, blockIndex, currentContent } = parsed.data;
    const session = getSessionOrThrow(sessionId);
    if (!session.storyOutput) {
      return res.status(400).json({ error: 'No story output exists for this session' });
    }

    const targetIndex =
      typeof blockIndex === 'number'
        ? blockIndex
        : session.storyOutput.blocks.findIndex((block) => {
            if (block.type !== blockType) return false;
            if (!title) return true;
            return block.title.trim().toLowerCase() === title.trim().toLowerCase();
          });
    if (targetIndex < 0) {
      return res.status(404).json({ error: `Target block not found for type: ${blockType}` });
    }
    if (targetIndex >= session.storyOutput.blocks.length) {
      return res.status(400).json({ error: `blockIndex out of range: ${targetIndex}` });
    }

    const targetBlock = session.storyOutput.blocks[targetIndex];
    if (targetBlock.type !== blockType) {
      return res.status(400).json({
        error: `blockIndex type mismatch: expected ${blockType}, found ${targetBlock.type}`,
      });
    }

    const updated = await regenerateStoryBlock({
      blockType,
      title: title || targetBlock.title,
      goal: session.goal,
      liveIntent: session.liveIntent,
      currentContent: currentContent || targetBlock.content,
    });

    session.storyOutput.blocks[targetIndex] = {
      ...targetBlock,
      title: updated.title,
      content: updated.content,
    };
    appendLog(session, `Story block regenerated (${blockType})`);
    await store.set(session);

    return res.json({ storyOutput: session.storyOutput });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to regenerate story block' });
  }
});

app.post('/api/navigator/analyze', async (req, res) => {
  try {
    const parsed = navigatorAnalyzeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: getZodErrorMessage(parsed.error) });
    }
    const { sessionId, screenshotBase64, screenRecordingBase64, targetUrl } = parsed.data;
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
      screenshotBase64,
      screenRecordingBase64,
      storyContext: session.storyOutput
        ? {
            summary: session.storyOutput.blocks.find((block) => block.type === 'text' && block.title === 'Summary')?.content,
            script: session.storyOutput.blocks.find((block) => block.type === 'text' && block.title === 'Script')?.content,
            caption: session.storyOutput.blocks.find((block) => block.type === 'caption')?.content,
            cta: session.storyOutput.blocks.find((block) => block.type === 'cta')?.content,
            imageAssetUrl: session.storyOutput.blocks.find((block) => block.type === 'image')?.assetUrl,
            videoAssetUrl: session.storyOutput.blocks.find((block) => block.type === 'video')?.assetUrl,
            platform: session.liveIntent?.platform,
          }
        : undefined,
    });

    session.navigatorPlan = navigatorPlan;
    appendLog(session, `Navigator screenshot received (${screenshotBase64.length} chars)`);
    if (screenRecordingBase64) {
      appendLog(session, `Navigator screen recording received (${screenRecordingBase64.length} chars)`);
    }
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
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer });
  attachLiveWsGateway({
    wss,
    processMessage: processAndPersistLiveMessage,
    resolveGoal: (sessionId: string) => getSessionOrThrow(sessionId).goal,
  });

  httpServer.listen(PORT, () => {
    console.log(`Backend server listening on http://localhost:${PORT}`);
    console.log(`Live websocket endpoint: ws://localhost:${PORT}/api/live/ws`);
    console.log(`Loaded sessions: ${store.size}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start backend:', error);
  process.exit(1);
});
