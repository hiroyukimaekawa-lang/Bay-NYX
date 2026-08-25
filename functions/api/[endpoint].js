/**
 * Cloudflare Pages Function
 *
 * /api/food-menu -> microCMS food-menu
 * /api/staff     -> microCMS staff
 *
 * APIキーは Cloudflare Pages の Variables and Secrets から取得し、
 * ブラウザへは公開しません。
 */

const ALLOWED_ENDPOINTS = new Set(['food-menu', 'staff']);
const DEFAULT_SERVICE_DOMAIN = 'l9pawk28o1';
const PAGE_LIMIT = 100;
const MAX_CONTENTS = 1000;
const CACHE_CONTROL = 'public, max-age=0, s-maxage=60, stale-while-revalidate=60';

function json(status, body, cacheControl = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function onRequestGet(context) {
  const endpoint = String(context.params?.endpoint || '');

  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    return json(404, { error: 'not_found' });
  }

  const env = context.env || {};
  const apiKey = env.MICROCMS_API_KEY;
  const serviceDomain = env.MICROCMS_SERVICE_DOMAIN || DEFAULT_SERVICE_DOMAIN;

  if (!apiKey) {
    console.warn('[microcms] MICROCMS_API_KEY is not configured.');
    return json(503, { error: 'not_configured' });
  }

  const baseUrl =
    `https://${encodeURIComponent(serviceDomain)}.microcms.io/api/v1/${encodeURIComponent(endpoint)}`;

  const headers = {
    'X-MICROCMS-API-KEY': apiKey,
    Accept: 'application/json',
  };

  const fetchPage = async (offset) => {
    const params = new URLSearchParams({
      orders: 'sortOrder,key',
      limit: String(PAGE_LIMIT),
      offset: String(offset),
    });
    return fetch(`${baseUrl}?${params.toString()}`, { headers });
  };

  try {
    const firstResponse = await fetchPage(0);

    if (!firstResponse.ok) {
      console.warn(`[microcms] ${endpoint} returned ${firstResponse.status}.`);
      return json(502, { error: 'upstream_error', status: firstResponse.status });
    }

    const data = await firstResponse.json();

    if (!data || !Array.isArray(data.contents)) {
      return json(502, { error: 'invalid_response' });
    }

    const total = Math.min(Number(data.totalCount) || data.contents.length, MAX_CONTENTS);

    while (data.contents.length < total) {
      const nextResponse = await fetchPage(data.contents.length);
      if (!nextResponse.ok) break;

      const page = await nextResponse.json();
      if (!page || !Array.isArray(page.contents) || page.contents.length === 0) break;
      data.contents = data.contents.concat(page.contents);
    }

    return json(200, data, CACHE_CONTROL);
  } catch (error) {
    console.warn(
      `[microcms] ${endpoint} fetch failed:`,
      error && error.message ? error.message : error
    );
    return json(502, { error: 'fetch_failed' });
  }
}

// onRequestGet のみ公開しているため、GET以外は Cloudflare Pages が 405 を返します。
