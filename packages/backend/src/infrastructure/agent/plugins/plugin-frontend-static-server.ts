import fs from 'node:fs';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';

const SAFE_SEGMENT = /^[A-Za-z0-9_.-]{1,128}$/;
const SAFE_ASSET_SEGMENT = /^[A-Za-z0-9_.-]{1,255}$/;
const SDK_FRONTEND_V1_PATH = '/sdk/frontend-v1.mjs';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

const applySecurityHeaders = (response: ServerResponse, publicOrigin: string): void => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors ${publicOrigin}`,
  );
};

const fail = (response: ServerResponse, statusCode: number, publicOrigin: string): void => {
  response.statusCode = statusCode;
  applySecurityHeaders(response, publicOrigin);
  response.setHeader('Cache-Control', 'no-store');
  response.end();
};

const decodeSegment = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const resolveSdkAsset = (request: IncomingMessage): string | null => {
  if (!request.url) return null;
  let url: URL;
  try {
    url = new URL(request.url, 'http://plugin-frontend.invalid');
  } catch {
    return null;
  }
  if (url.search || url.hash || url.pathname !== SDK_FRONTEND_V1_PATH) return null;
  const asset = path.resolve(__dirname, 'frontend-sdk', 'frontend-v1.mjs');
  return fs.existsSync(asset) ? asset : null;
};

const resolveAsset = (dataDirectory: string, request: IncomingMessage): string | null => {
  if (!request.url) return null;
  let url: URL;
  try {
    url = new URL(request.url, 'http://plugin-frontend.invalid');
  } catch {
    return null;
  }
  if (url.search || url.hash) return null;
  const raw = url.pathname.split('/');
  if (raw.length < 5 || raw[0] !== '' || raw[1] !== 'plugins') return null;
  const appId = decodeSegment(raw[2]!);
  const version = decodeSegment(raw[3]!);
  if (!appId || !version || !SAFE_SEGMENT.test(appId) || !SAFE_SEGMENT.test(version)) return null;
  const relativeSegments = raw.slice(4).map(decodeSegment);
  if (
    relativeSegments.length === 0 ||
    relativeSegments.some(
      (segment) =>
        !segment || !SAFE_ASSET_SEGMENT.test(segment) || segment === '.' || segment === '..' || segment.startsWith('.'),
    )
  ) {
    return null;
  }

  const frontendRoot = path.resolve(dataDirectory, 'agent', 'plugins', appId, 'versions', version, 'frontend');
  const marker = path.resolve(frontendRoot, '..', '.nexus-package-hash');
  if (!fs.existsSync(marker)) return null;
  const candidate = path.resolve(frontendRoot, ...relativeSegments.map((segment) => segment!));
  const prefix = `${frontendRoot}${path.sep}`;
  if (!candidate.startsWith(prefix)) return null;
  try {
    const rootReal = fs.realpathSync(frontendRoot);
    const candidateReal = fs.realpathSync(candidate);
    if (!candidateReal.startsWith(`${rootReal}${path.sep}`)) return null;
    const stat = fs.lstatSync(candidateReal);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return candidateReal;
  } catch {
    return null;
  }
};

export const createPluginFrontendStaticServer = (options: { dataDirectory: string; publicOrigin: string }): Server =>
  http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.setHeader('Allow', 'GET, HEAD');
      fail(response, 405, options.publicOrigin);
      return;
    }
    const asset = resolveSdkAsset(request) ?? resolveAsset(options.dataDirectory, request);
    if (!asset) {
      fail(response, 404, options.publicOrigin);
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(asset);
    } catch {
      fail(response, 404, options.publicOrigin);
      return;
    }
    response.statusCode = 200;
    applySecurityHeaders(response, options.publicOrigin);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('Content-Length', stat.size);
    response.setHeader('Content-Type', CONTENT_TYPES[path.extname(asset).toLowerCase()] ?? 'application/octet-stream');
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = fs.createReadStream(asset);
    stream.once('error', () => {
      if (!response.headersSent) fail(response, 500, options.publicOrigin);
      else response.destroy();
    });
    stream.pipe(response);
  });
