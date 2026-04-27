import {
  expandNodes,
  parseNodeLinks,
  parsePreferredEndpoints,
  renderRawSubscription,
  renderSurgeSubscription,
  renderTemplateClashSubscription,
  summarizeNodes,
} from './core.js';

const CLASH_TEMPLATE_PATH = '/clash-template.yaml';
const SUB_TTL_SECONDS = 60 * 60 * 24 * 365;

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

function text(body, status = 200, contentType = 'text/plain; charset=utf-8') {
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      'access-control-allow-origin': '*',
    },
  });
}

function requireSubStore(env) {
  if (!env?.SUB_STORE || typeof env.SUB_STORE.get !== 'function' || typeof env.SUB_STORE.put !== 'function') {
    throw new Error('未配置 SUB_STORE 绑定，请在 Cloudflare Worker 的 Bindings 中绑定 KV namespace。');
  }
}

function createShortId(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += chars[bytes[index] % chars.length];
  }
  return out;
}

async function createUniqueShortId(env, tries = 8) {
  for (let index = 0; index < tries; index += 1) {
    const id = createShortId(10);
    const exists = await env.SUB_STORE.get(`sub:${id}`);
    if (!exists) {
      return id;
    }
  }
  throw new Error('无法生成唯一短链接，请稍后再试');
}

function normalizeLines(value = '') {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort()
    .join('\n');
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function buildDedupHash(body) {
  const normalized = {
    nodeLinks: normalizeLines(body.nodeLinks || ''),
    preferredIps: normalizeLines(body.preferredIps || ''),
    namePrefix: String(body.namePrefix || '').trim(),
    nameTemplate: String(body.nameTemplate || '').trim(),
    keepOriginalHost: body.keepOriginalHost !== false,
  };
  return sha256Hex(JSON.stringify(normalized));
}

async function handleGenerate(request, env, url) {
  requireSubStore(env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: '请求体不是合法 JSON' }, 400);
  }

  const options = {
    namePrefix: body.namePrefix || '',
    nameTemplate: body.nameTemplate || '',
    keepOriginalHost: body.keepOriginalHost !== false,
  };

  let parsedNodes;
  let parsedEndpoints;
  let expanded;
  try {
    parsedNodes = parseNodeLinks(body.nodeLinks || '');
    parsedEndpoints = parsePreferredEndpoints(body.preferredIps || '');
    expanded = expandNodes(parsedNodes.nodes, parsedEndpoints.endpoints, options);
  } catch (error) {
    return json({ ok: false, error: error.message || '生成失败' }, 400);
  }

  const warnings = [
    ...parsedNodes.warnings,
    ...parsedEndpoints.warnings,
    ...expanded.warnings,
  ];
  const nodes = expanded.nodes;
  const payload = {
    version: 2,
    createdAt: new Date().toISOString(),
    options,
    nodes,
  };

  const dedupHash = await buildDedupHash(body);
  const dedupKey = `dedup:${dedupHash}`;
  let id = await env.SUB_STORE.get(dedupKey);

  if (!id) {
    id = await createUniqueShortId(env);
    await env.SUB_STORE.put(`sub:${id}`, JSON.stringify(payload), {
      expirationTtl: SUB_TTL_SECONDS,
    });
    await env.SUB_STORE.put(dedupKey, id, {
      expirationTtl: SUB_TTL_SECONDS,
    });
  }

  const accessToken = env.SUB_ACCESS_TOKEN || '';
  const withToken = (target) =>
    `${url.origin}/sub/${id}${
      target
        ? `?target=${target}&token=${encodeURIComponent(accessToken)}`
        : `?token=${encodeURIComponent(accessToken)}`
    }`;

  return json({
    ok: true,
    storage: 'kv',
    deduplicated: true,
    shortId: id,
    urls: {
      auto: withToken(''),
      raw: withToken('raw'),
      clash: withToken('clash'),
      surge: withToken('surge'),
    },
    counts: {
      inputNodes: parsedNodes.nodes.length,
      preferredEndpoints: parsedEndpoints.endpoints.length,
      outputNodes: nodes.length,
    },
    preview: summarizeNodes(nodes, 20),
    warnings: accessToken
      ? warnings
      : [...warnings, '未检测到 SUB_ACCESS_TOKEN，订阅链接将没有第二层访问保护。'],
  });
}

function validateAccessToken(url, env) {
  const expected = env.SUB_ACCESS_TOKEN;
  if (!expected) {
    return { ok: true };
  }

  const provided = url.searchParams.get('token') || '';
  if (!provided || provided !== expected) {
    return { ok: false, response: text('Forbidden: invalid token', 403) };
  }

  return { ok: true };
}

let cachedClashTemplate = null;

async function loadClashTemplate(env, origin) {
  if (cachedClashTemplate) {
    return cachedClashTemplate;
  }

  const response = await env.ASSETS.fetch(new Request(new URL(CLASH_TEMPLATE_PATH, origin)));
  if (!response.ok) {
    throw new Error('Clash 模板加载失败');
  }

  cachedClashTemplate = await response.text();
  return cachedClashTemplate;
}

async function handleSub(url, env) {
  requireSubStore(env);

  const tokenCheck = validateAccessToken(url, env);
  if (!tokenCheck.ok) {
    return tokenCheck.response;
  }

  const id = url.pathname.split('/').pop();
  if (!id) {
    return text('missing id', 400);
  }

  const raw = await env.SUB_STORE.get(`sub:${id}`);
  if (!raw) {
    return text('not found', 404);
  }

  const record = JSON.parse(raw);
  const nodes = record.nodes || [];
  const target = (url.searchParams.get('target') || 'raw').toLowerCase();

  try {
    if (target === 'clash') {
      const templateText = await loadClashTemplate(env, url.origin);
      return text(renderTemplateClashSubscription(templateText, nodes), 200, 'text/yaml; charset=utf-8');
    }

    if (target === 'surge') {
      return text(
        renderSurgeSubscription(nodes, `${url.origin}${url.pathname}?target=surge&token=${encodeURIComponent(env.SUB_ACCESS_TOKEN || '')}`),
        200,
        'text/plain; charset=utf-8',
      );
    }

    return text(renderRawSubscription(nodes), 200, 'text/plain; charset=utf-8');
  } catch (error) {
    return text(error.message || 'subscription render failed', 500);
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET,POST,OPTIONS',
            'access-control-allow-headers': 'content-type',
          },
        });
      }

      if (request.method === 'POST' && url.pathname === '/api/generate') {
        return await handleGenerate(request, env, url);
      }

      if (request.method === 'GET' && url.pathname.startsWith('/sub/')) {
        return await handleSub(url, env);
      }

      return await env.ASSETS.fetch(request);
    } catch (error) {
      return json(
        {
          ok: false,
          error: error?.message || '服务器内部错误',
        },
        500,
      );
    }
  },
};
