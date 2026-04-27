import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  decryptPayload,
  encryptPayload,
  expandNodes,
  parseNameMappings,
  parseNodeLinks,
  parsePreferredEndpoints,
  renderClashSubscription,
  renderRawSubscription,
  renderSurgeSubscription,
  renderTemplateClashSubscription,
} from '../src/core.js';
import worker from '../src/worker.js';

const vmess = 'vmess://ewogICJ2IjogIjIiLAogICJwcyI6ICJkZW1vLXdzLXRscyIsCiAgImFkZCI6ICJlZGdlLmV4YW1wbGUuY29tIiwKICAicG9ydCI6ICI0NDMiLAogICJpZCI6ICIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLAogICJzY3kiOiAiYXV0byIsCiAgIm5ldCI6ICJ3cyIsCiAgInRscyI6ICJ0bHMiLAogICJwYXRoIjogIi93cyIsCiAgImhvc3QiOiAiZWRnZS5leGFtcGxlLmNvbSIsCiAgInNuaSI6ICJlZGdlLmV4YW1wbGUuY29tIiwKICAiZnAiOiAiY2hyb21lIiwKICAiYWxwbiI6ICJoMixodHRwLzEuMSIKfQ==';

const { nodes } = parseNodeLinks(vmess);
assert.equal(nodes.length, 1);
assert.equal(nodes[0].type, 'vmess');
assert.equal(nodes[0].server, 'edge.example.com');

const { endpoints } = parsePreferredEndpoints('104.16.1.2#HK\n104.17.2.3:2053#US');
assert.equal(endpoints.length, 2);

const { mappings } = parseNameMappings('demo-ws-tls=自定义主节点');
assert.equal(mappings['demo-ws-tls'], '自定义主节点');

const expanded = expandNodes(nodes, endpoints, { keepOriginalHost: true, namePrefix: 'CF' });
assert.equal(expanded.nodes.length, 2);
assert.equal(expanded.nodes[0].server, '104.16.1.2');
assert.equal(expanded.nodes[0].hostHeader, 'edge.example.com');
assert.equal(expanded.nodes[1].port, 2053);

const renamed = expandNodes(nodes, endpoints, {
  keepOriginalHost: true,
  nameTemplate: 'Node-{remark}-{index}',
});
assert.equal(renamed.nodes[0].name, 'Node-HK-1');
assert.equal(renamed.nodes[1].name, 'Node-US-2');

const mapped = expandNodes(nodes, endpoints, {
  keepOriginalHost: true,
  nameMappings: mappings,
});
assert.equal(mapped.nodes[0].name, '自定义主节点 | HK');
assert.equal(mapped.nodes[1].name, '自定义主节点 | US');

const raw = renderRawSubscription(expanded.nodes);
assert.ok(raw.length > 10);

const clash = renderClashSubscription(expanded.nodes);
assert.match(clash, /proxies:/);
assert.match(clash, /edge\.example\.com/);

const surge = renderSurgeSubscription(expanded.nodes, 'https://sub.example.com/sub/demo?target=surge');
assert.match(surge, /\[Proxy]/);
assert.match(surge, /vmess/);

const mergedClash = renderTemplateClashSubscription(
  [
    'mixed-port: 7890',
    'proxies:',
    '  - {name: "Old Proxy", server: "old.example.com", port: 443, type: vless, uuid: "old"}',
    'proxy-groups:',
    '  - name: 🚀 节点选择',
    '    type: select',
    '    proxies:',
    '      - ♻️ 自动选择',
    '      - DIRECT',
    '      - Old Proxy',
    '  - name: 🎯 全球直连',
    '    type: select',
    '    proxies:',
    '      - DIRECT',
    '      - 🚀 节点选择',
    '  - name: 🐟 漏网之鱼',
    '    type: select',
    '    proxies:',
    '      - 🚀 节点选择',
    '      - Old Proxy',
    'rules:',
    '  - MATCH,🐟 漏网之鱼',
  ].join('\n'),
  renamed.nodes,
);
assert.match(mergedClash, /Node-HK-1/);
assert.match(mergedClash, /MATCH,🐟 漏网之鱼/);
assert.doesNotMatch(mergedClash, /Old Proxy/);
assert.doesNotMatch(mergedClash, /old\.example\.com/);

const secret = 'this-is-a-very-secret-key';
const token = await encryptPayload({ nodes: expanded.nodes }, secret);
const payload = await decryptPayload(token, secret);
assert.equal(payload.nodes.length, 2);

const templateText = await readFile(new URL('../public/clash-template.yaml', import.meta.url), 'utf8');
const store = new Map();
const puts = [];
const env = {
  SUB_ACCESS_TOKEN: 'secret-token',
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/clash-template.yaml') {
        return new Response(templateText, {
          status: 200,
          headers: { 'content-type': 'text/yaml; charset=utf-8' },
        });
      }
      return new Response('asset', { status: 200 });
    },
  },
  SUB_STORE: {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value, options = {}) {
      store.set(key, value);
      puts.push({ key, options });
    },
  },
};

const workerRequest = new Request('https://example.test/api/generate', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    nodeLinks:
      'vless://d5164d2c-97b9-46f8-bf6e-bbec818e76f5@cf.cloudflare.182682.xyz:8443?encryption=none&security=tls&sni=cc.341225.xyz&fp=chrome&alpn=h2%2Chttp%2F1.1&insecure=0&allowInsecure=0&type=ws&host=cc.341225.xyz&path=%2Fretevddsfre#341225-57ru4foh',
    preferredIps: '104.16.1.2#US',
    subscriptionName: '我的订阅',
    nameMappings: '341225-57ru4foh=凤凰城定制',
    nameTemplate: '自定义-{index}-{remark}',
    keepOriginalHost: true,
  }),
});

const generateResponse = await worker.fetch(workerRequest, env);
assert.equal(generateResponse.status, 200);
const generatePayload = await generateResponse.json();
assert.equal(generatePayload.ok, true);
assert.equal(generatePayload.preview[0].name, '自定义-1-US');
assert.equal(
  puts.find((entry) => entry.key.startsWith('sub:')).options.expirationTtl,
  60 * 60 * 24 * 365,
);

const clashResponse = await worker.fetch(new Request(generatePayload.urls.clash), env);
assert.equal(clashResponse.status, 200);
assert.equal(
  clashResponse.headers.get('content-disposition'),
  "attachment; filename*=UTF-8''%E6%88%91%E7%9A%84%E8%AE%A2%E9%98%85",
);
const clashBody = await clashResponse.text();
assert.match(clashBody, /自定义-1-US/);
assert.match(clashBody, /proxy-groups:/);
assert.match(clashBody, /MATCH,🐟 漏网之鱼/);

const missingBindingResponse = await worker.fetch(
  new Request('https://example.test/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeLinks: vmess,
      preferredIps: '104.16.1.2#HK',
    }),
  }),
  {
    ASSETS: env.ASSETS,
    SUB_ACCESS_TOKEN: 'secret-token',
  },
);
assert.equal(missingBindingResponse.status, 500);
const missingBindingPayload = await missingBindingResponse.json();
assert.equal(missingBindingPayload.ok, false);
assert.match(missingBindingPayload.error, /SUB_STORE/);

console.log('smoke test passed');
