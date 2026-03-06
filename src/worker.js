import {
  buildShareUrls,
  decryptPayload,
  detectTarget,
  encryptPayload,
  ensureSecret,
  expandNodes,
  parseNodeLinks,
  parsePreferredEndpoints,
  renderSubscription,
  summarizeNodes,
} from './core.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export default {
  async fetch(request, env) {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 400;
      return json(
        {
          ok: false,
          error: error?.message || '请求处理失败。',
        },
        status,
      );
    }
  },
};

async function routeRequest(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === 'GET' && pathname === '/api/health') {
    return json({ ok: true, status: 'ok' });
  }

  if (request.method === 'POST' && pathname === '/api/generate') {
    return handleGenerate(request, env, url);
  }

  if (request.method === 'GET' && pathname.startsWith('/sub/')) {
    return handleSubscription(request, env, url);
  }

  if (env.ASSETS) {
    return env.ASSETS.fetch(request);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleGenerate(request, env, url) {
  const secret = ensureSecret(env.SUB_LINK_SECRET);
  const body = await request.json();
  const nodeLinks = String(body?.nodeLinks || '');
  const preferredIps = String(body?.preferredIps || '');
  const keepOriginalHost = body?.keepOriginalHost !== false;
  const namePrefix = String(body?.namePrefix || '').trim();

  const parsedNodes = parseNodeLinks(nodeLinks);
  const parsedEndpoints = parsePreferredEndpoints(preferredIps);
  const expanded = expandNodes(parsedNodes.nodes, parsedEndpoints.endpoints, {
    keepOriginalHost,
    namePrefix,
  });

  const payload = {
    version: 1,
    keepOriginalHost,
    namePrefix,
    createdAt: new Date().toISOString(),
    nodes: expanded.nodes,
  };

  const token = await encryptPayload(payload, secret);
  const origin = url.origin;
  const urls = buildShareUrls(origin, token);

  const capabilities = {
    raw: expanded.nodes.length > 0,
    clash: expanded.nodes.length > 0,
    surge: expanded.nodes.some((node) => node.type === 'vmess' || node.type === 'trojan'),
  };

  return json({
    ok: true,
    token,
    urls,
    counts: {
      inputNodes: parsedNodes.nodes.length,
      preferredEndpoints: parsedEndpoints.endpoints.length,
      outputNodes: expanded.nodes.length,
    },
    capabilities,
    preview: summarizeNodes(expanded.nodes, 20),
    warnings: [
      ...parsedNodes.warnings,
      ...parsedEndpoints.warnings,
      ...expanded.warnings,
    ],
  });
}

async function handleSubscription(request, env, url) {
  const secret = ensureSecret(env.SUB_LINK_SECRET);
  const token = url.pathname.split('/').filter(Boolean)[1];
  if (!token) {
    throw new Error('缺少订阅令牌。');
  }

  const payload = await decryptPayload(token, secret);
  if (!payload?.nodes?.length) {
    throw new Error('订阅内容为空。');
  }

  const target = detectTarget(request.headers.get('user-agent'), url.searchParams.get('target') || url.searchParams.get('format'));
  const rendered = renderSubscription(target, payload.nodes, request.url);

  return new Response(rendered.body, {
    status: 200,
    headers: {
      'content-type': rendered.contentType,
      'cache-control': 'no-store',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(rendered.filename)}`,
      'x-subscription-target': target,
    },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}
