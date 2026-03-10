import WebSocket from 'ws';

const baseUrl = process.env.BASE_URL || 'ws://localhost:8787';
const apiBase = process.env.API_BASE || 'http://localhost:8787';

async function requestJson(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  console.log('=== Live WebSocket Test ===');
  const created = await requestJson('POST', `${apiBase}/api/session/create`, {
    goal: 'Live websocket validation',
  });
  const sessionId = created.session.sessionId;
  assertTrue(Boolean(sessionId), 'sessionId should exist');

  const socket = new WebSocket(`${baseUrl}/api/live/ws`);
  let aggregate = '';
  let gotFinal = false;

  await new Promise((resolve, reject) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'start_session', sessionId }));
      socket.send(
        JSON.stringify({
          type: 'user_message',
          message: 'I want help for a sports campaign for students on instagram in a playful tone',
        }),
      );
    });

    socket.on('message', (raw) => {
      const event = JSON.parse(String(raw));
      if (event.type === 'delta') {
        aggregate += event.delta;
      }
      if (event.type === 'final') {
        gotFinal = true;
        aggregate = event.reply || aggregate;
        resolve();
      }
      if (event.type === 'error') {
        reject(new Error(event.error || 'ws error'));
      }
    });

    socket.on('error', (error) => reject(error));
    socket.on('close', () => {
      if (!gotFinal) reject(new Error('socket closed before final'));
    });
  });

  assertTrue(aggregate.length > 0, 'final reply should not be empty');
  console.log(`WS final reply: ${aggregate}`);
  socket.close();
  console.log('PASS: websocket live flow works.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
