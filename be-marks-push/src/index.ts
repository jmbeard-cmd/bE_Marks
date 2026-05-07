export interface Env {
  PUSH_TOKENS: KVNamespace;
  PUSH_SECRET: string;
}

type RegisterPayload = {
  npub?: string;
  expoPushToken?: string;
  platform?: string;
  app?: string;
  registeredAt?: number;
};

type SendTestPayload = {
  npub?: string;
  expoPushToken?: string;
  title?: string;
  body?: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

function getBearerSecret(request: Request) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

function isExpoPushToken(token: string) {
  return (
    token.startsWith('ExponentPushToken[') ||
    token.startsWith('ExpoPushToken[')
  );
}

async function sendExpoPush({
  to,
  title,
  body,
  data,
}: {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}) {
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to,
      title,
      body,
      data: data ?? {},
      sound: 'default',
      priority: 'high',
      channelId: 'messages',
    }),
  });

  const result = await response.json().catch(() => null);

  return {
    ok: response.ok,
    status: response.status,
    result,
  };
}

async function getTokensForNpub(env: Env, npub: string): Promise<string[]> {
  const key = `npub:${npub}:tokens`;
  const existing = await env.PUSH_TOKENS.get<string[]>(key, 'json');
  return Array.isArray(existing) ? existing : [];
}

async function saveTokensForNpub(env: Env, npub: string, tokens: string[]) {
  const key = `npub:${npub}:tokens`;
  const unique = Array.from(new Set(tokens));
  await env.PUSH_TOKENS.put(key, JSON.stringify(unique));
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return json({ ok: true });
    }

    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'be-marks-push',
        time: new Date().toISOString(),
      });
    }

    if (request.method === 'POST' && url.pathname === '/push/register') {
      const secret = getBearerSecret(request);

      if (!env.PUSH_SECRET || secret !== env.PUSH_SECRET) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }

      const body = await request.json<RegisterPayload>().catch(() => null);

      if (!body?.npub || !body?.expoPushToken) {
        return json({ ok: false, error: 'missing npub or expoPushToken' }, 400);
      }

      if (!isExpoPushToken(body.expoPushToken)) {
        return json({ ok: false, error: 'invalid Expo push token' }, 400);
      }

      const existingTokens = await getTokensForNpub(env, body.npub);
      const nextTokens = Array.from(new Set([...existingTokens, body.expoPushToken]));

      await saveTokensForNpub(env, body.npub, nextTokens);

      await env.PUSH_TOKENS.put(
        `token:${body.expoPushToken}`,
        JSON.stringify({
          npub: body.npub,
          platform: body.platform ?? 'unknown',
          app: body.app ?? 'be-marks',
          updatedAt: Date.now(),
        })
      );

      return json({
        ok: true,
        npub: body.npub,
        tokenCount: nextTokens.length,
      });
    }

    if (request.method === 'POST' && url.pathname === '/push/send-test') {
      const secret = getBearerSecret(request);

      if (!env.PUSH_SECRET || secret !== env.PUSH_SECRET) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }

      const body = await request.json<SendTestPayload>().catch(() => null);

      const title = body?.title || 'bE Marks';
      const message = body?.body || 'Test notification from bE Marks.';

      let tokens: string[] = [];

      if (body?.expoPushToken) {
        tokens = [body.expoPushToken];
      } else if (body?.npub) {
        tokens = await getTokensForNpub(env, body.npub);
      }

      if (tokens.length === 0) {
        return json({ ok: false, error: 'no tokens found' }, 404);
      }

      const results = [];

      for (const token of tokens) {
        if (!isExpoPushToken(token)) continue;

        const result = await sendExpoPush({
          to: token,
          title,
          body: message,
          data: {
            type: 'test',
          },
        });

        results.push({
          token: token.slice(0, 28) + '…',
          result,
        });
      }

      return json({
        ok: true,
        sent: results.length,
        results,
      });
    }

    return json({ ok: false, error: 'not found' }, 404);
  },
};