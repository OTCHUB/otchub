// Cloudflare Pages Function — same-origin proxy for the Base44 backend.
//
// src/api/base44Client.js deliberately uses serverUrl: '' (relative /api/*
// calls), which only works when something on this origin forwards /api/* to
// Base44. Cloudflare Pages' _redirects can't do this itself — its 200-status
// "proxying" only supports relative URLs on the same site, not external
// domains (see developers.cloudflare.com/pages/configuration/redirects).
// A Pages Function has the full Workers `fetch` API, so it can reach an
// external origin directly. Mirrors the same proxy pattern rufomo/worker.js
// uses for its own backend.
//
// Catches every path under /api/* (Pages' [[path]] catch-all segment) and
// forwards it verbatim — method, headers, query string, and body — to the
// Base44 app's own hosted origin, then streams the response back unchanged.
const BASE44_ORIGIN = 'https://otchubdev.base44.app';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, BASE44_ORIGIN);

  const headers = new Headers(request.headers);
  headers.set('host', target.host);
  headers.delete('cf-connecting-ip');

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = request.body;
  }

  return fetch(target, init);
}
