import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';
import {
  ExecutionResult,
  LiveIntent,
  NavigatorPlan,
  Session,
  StoryOutput,
  WorkflowStage,
} from '../../shared/contracts.ts';

const app = express();
const PORT = Number(process.env.PORT || 8787);

const STAGE_ORDER: WorkflowStage[] = [
  'INTAKE',
  'STORY_GENERATION',
  'STORY_REVIEW',
  'NAVIGATOR_ANALYSIS',
  'NAVIGATOR_EXECUTION',
  'COMPLETION',
];

const sessions = new Map<string, Session>();

app.use(cors({ origin: ['http://localhost:3000'], credentials: false }));
app.use(express.json({ limit: '10mb' }));

function nowIso() {
  return new Date().toISOString();
}

function getSessionOrThrow(sessionId: string): Session {
  const session = sessions.get(sessionId);
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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

app.post('/api/session/create', (req, res) => {
  const goal = String(req.body?.goal || '').trim();
  if (!goal) {
    return res.status(400).json({ error: 'Goal is required' });
  }

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

  sessions.set(session.sessionId, session);
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

app.post('/api/live/message', (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    const message = String(req.body?.message || '').trim();
    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message are required' });
    }

    const session = getSessionOrThrow(sessionId);
    const lowerMessage = message.toLowerCase();

    const liveIntent: LiveIntent = {
      intent: lowerMessage.includes('post') || lowerMessage.includes('publish') ? 'publish_story' : 'create_story',
      objective: session.goal,
      audience: lowerMessage.includes('kids') ? 'kids' : 'general audience',
      tone: lowerMessage.includes('fun') ? 'playful' : 'cinematic',
      platform: lowerMessage.includes('instagram') ? 'instagram' : 'web',
      readyForStoryGeneration: message.length >= 5,
      handoffTo: message.length >= 5 ? 'storyteller' : 'none',
    };

    session.liveIntent = liveIntent;
    session.conversationSummary = `${session.conversationSummary} | User: ${message}`;
    appendLog(session, 'Live message received and intent updated');

    if (liveIntent.readyForStoryGeneration && session.workflowStage === 'INTAKE') {
      moveStage(session, 'STORY_GENERATION');
      appendLog(session, 'Stage advanced to STORY_GENERATION');
    }

    return res.json({
      liveIntent,
      reply: 'Intent captured. Story generation can begin.',
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to process live message' });
  }
});

app.post('/api/story/generate', (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    const session = getSessionOrThrow(sessionId);

    ensureStage(session, 'STORY_GENERATION');

    const storyOutput: StoryOutput = {
      storyId: randomUUID(),
      title: `Story for "${session.goal}"`,
      blocks: [
        { type: 'text', title: 'Hook', content: `Imagine: ${session.goal}` },
        { type: 'caption', title: 'Caption', content: `Cinematic reveal of ${session.goal}` },
        { type: 'cta', title: 'Call To Action', content: 'Try your own creative prompt next.' },
      ],
      nextAction: 'Review story, then run navigator analysis.',
    };

    session.storyOutput = storyOutput;
    appendLog(session, 'Story output generated');
    moveStage(session, 'STORY_REVIEW');
    appendLog(session, 'Stage advanced to STORY_REVIEW');

    return res.json({ storyOutput });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to generate story' });
  }
});

app.post('/api/navigator/analyze', (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    const screenshotBase64 = String(req.body?.screenshotBase64 || '').trim();
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    if (!screenshotBase64) {
      return res.status(400).json({ error: 'screenshotBase64 is required' });
    }

    const session = getSessionOrThrow(sessionId);
    ensureStage(session, 'STORY_REVIEW');
    moveStage(session, 'NAVIGATOR_ANALYSIS');
    appendLog(session, 'Stage advanced to NAVIGATOR_ANALYSIS');

    const navigatorPlan: NavigatorPlan = {
      detectedElements: [
        { name: 'Title input', selectorHint: '#title', confidence: 0.92 },
        { name: 'Description input', selectorHint: '#description', confidence: 0.87 },
        { name: 'Publish button', selectorHint: 'button[type="submit"]', confidence: 0.9 },
      ],
      actionPlan: [
        { action: 'click', target: '#title', confidence: 0.92, reason: 'Focus title field' },
        { action: 'type', target: '#title', value: session.storyOutput?.title || session.goal, confidence: 0.91, reason: 'Set title' },
        { action: 'click', target: 'button[type="submit"]', confidence: 0.9, reason: 'Publish story' },
      ],
      confidence: 0.89,
      notes: 'MVP deterministic plan from latest screenshot.',
    };

    session.navigatorPlan = navigatorPlan;
    appendLog(session, 'Navigator analysis generated');
    return res.json({ navigatorPlan });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to analyze navigator input' });
  }
});

app.post('/api/navigator/execute', (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const session = getSessionOrThrow(sessionId);
    ensureStage(session, 'NAVIGATOR_ANALYSIS');
    moveStage(session, 'NAVIGATOR_EXECUTION');
    appendLog(session, 'Stage advanced to NAVIGATOR_EXECUTION');

    const steps = (session.navigatorPlan?.actionPlan || []).map((action) => ({
      action: action.action,
      target: action.target,
      status: 'success' as const,
      note: `Executed ${action.action} on ${action.target}`,
    }));

    const executionResult: ExecutionResult = {
      status: 'success',
      steps,
      logs: [
        'Navigator execution started',
        ...steps.map((step) => step.note || ''),
        'Navigator execution finished',
      ],
      completedActions: steps.length,
    };

    session.executionResult = executionResult;
    appendLog(session, 'Navigator actions executed');
    moveStage(session, 'COMPLETION');
    session.status = 'completed';
    appendLog(session, 'Stage advanced to COMPLETION and session marked completed');

    return res.json({ executionResult });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Unable to execute navigator plan' });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server listening on http://localhost:${PORT}`);
});
