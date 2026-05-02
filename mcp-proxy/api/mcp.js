// Vercel Edge — Aiphone Residence MCP proxy.
//
// Thin pass-through to the multi-tenant Supabase mcp-proxy edge function.
// The Supabase mcp-proxy/<businessId> endpoint pulls the per-business
// x-passqr-api-key from business.config server-side, so this Vercel
// function holds NO credentials. Drop-in replacement for any existing
// MCP client (Claude Desktop, etc.) configured against the Vercel URL.
//
// Architecture:
//   Client → Vercel /api/mcp → Supabase mcp-proxy/<businessId> → PassQR MCP
//
// Why keep the Vercel layer at all?
//   - Stable external URL for already-configured MCP clients
//   - CORS handling for browser-based clients
//   - Insulation from Supabase URL changes
//
// To migrate to a different business, change AIPHONE_BUSINESS_ID. To add
// more tenants, deploy parallel functions (or accept the businessId via
// query param — current design hard-codes it for the Aiphone deployment).

export const config = { runtime: 'edge' };

const AIPHONE_BUSINESS_ID = '61d295a1-b94d-4679-afe7-1acbf6549ea0';
const UPSTREAM = `https://gyllfnsnniuqaarsulsk.supabase.co/functions/v1/mcp-proxy/${AIPHONE_BUSINESS_ID}`;

export default async function handler(req) {
  const url = new URL(req.url);
  const upstream = UPSTREAM + (url.search || '');

  // Forward most headers untouched. Strip 'host' (causes Cloudflare/Vercel issues)
  // and any inbound Authorization (the Supabase function uses business.config,
  // not caller-provided creds — passing through could confuse upstream).
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('authorization');

  const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : req.body;

  // Handle CORS preflight at the edge (no need to round-trip Supabase)
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  let resp;
  try {
    resp = await fetch(upstream, {
      method: req.method,
      headers,
      body,
      duplex: 'half',
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Upstream unreachable', detail: String(err) }),
      { status: 502, headers: { 'content-type': 'application/json', ...corsHeaders() } },
    );
  }

  const respHeaders = new Headers(resp.headers);
  for (const [k, v] of Object.entries(corsHeaders())) respHeaders.set(k, v);

  return new Response(resp.body, {
    status: resp.status,
    headers: respHeaders,
  });
}

function corsHeaders() {
  return {
    'access-control-allow-origin':  '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS,DELETE',
    'access-control-allow-headers': 'content-type,authorization,mcp-protocol-version,mcp-session-id',
  };
}
