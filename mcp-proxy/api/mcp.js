export const config = { runtime: 'edge' };

const AIPHONE_API_KEY = 'pqr_aiphone_f3adacc23c13cc1ee566cd8d29f86028';
const UPSTREAM = 'https://passqr-mcp-server.vincent-513.workers.dev';

export default async function handler(req) {
  const url = new URL(req.url);
  const upstream = new URL(UPSTREAM + '/mcp' + (url.search || ''));

  const headers = new Headers(req.headers);
  headers.set('x-passqr-api-key', AIPHONE_API_KEY);
  headers.delete('host');

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : req.body;

  const resp = await fetch(upstream.toString(), {
    method: req.method,
    headers,
    body,
    duplex: 'half',
  });

  const respHeaders = new Headers(resp.headers);
  respHeaders.set('access-control-allow-origin', '*');
  respHeaders.set('access-control-allow-methods', 'GET,POST,OPTIONS,DELETE');
  respHeaders.set('access-control-allow-headers', 'content-type,authorization,mcp-protocol-version,mcp-session-id');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: respHeaders });
  }

  return new Response(resp.body, {
    status: resp.status,
    headers: respHeaders,
  });
}