import { createHash, timingSafeEqual } from 'node:crypto';

const COOKIE = 'decide_ai_access';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const digest = value => createHash('sha256').update(String(value)).digest();
const matches = (value, key) => typeof value === 'string' && timingSafeEqual(digest(value), digest(key));

function readCookie(header, name) {
  for (const part of (header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(rest.join('=')); } catch { return undefined; }
    }
  }
  return undefined;
}

const escapeHtml = value => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

function loginPage(error) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Decide Aí</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f4f1ec;color:#1f1f1f}
form{background:#fff;padding:28px;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.08);width:min(320px,calc(100vw - 32px));box-sizing:border-box}
h1{margin:0 0 6px;font-size:20px}p{margin:0 0 16px;color:#666;font-size:14px}
input,button{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;font-size:16px}
input{border:1px solid #ccc;margin-bottom:10px}button{border:0;background:#ea1d2c;color:#fff;font-weight:600;cursor:pointer}
.error{color:#b00020}</style></head><body>
<form method="get" action="/"><h1>Decide Aí</h1><p${error ? ' class="error"' : ''}>${escapeHtml(error || 'Digite a senha da demonstração.')}</p>
<input name="key" type="password" autocomplete="current-password" placeholder="Senha" required autofocus><button>Entrar</button></form>
</body></html>`;
}

/**
 * Protege a demo exposta por túnel: pedidos de fora do localhost precisam da senha.
 * A senha chega uma vez por ?key=, vira um cookie HttpOnly e é removida da URL.
 * Sem accessKey, não protege nada (uso local).
 */
export function createAccessGuard({ accessKey } = {}) {
  return (request, response, next) => {
    if (!accessKey) return next();
    const host = (request.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    // Os túneis se conectam pelo localhost, mas identificam o visitante: cloudflared com cf-connecting-ip, ngrok com x-forwarded-for.
    const proxied = request.headers['cf-connecting-ip'] || request.headers['x-forwarded-for'];
    if (LOCAL_HOSTS.has(host) && !proxied) return next();

    const url = new URL(request.url || '/', 'http://local');
    const key = url.searchParams.get('key');
    if (key !== null) {
      url.searchParams.delete('key');
      const location = `${url.pathname}${url.search}`;
      if (!matches(key, accessKey)) {
        response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return response.end(loginPage('Senha incorreta. Tente de novo.'));
      }
      response.writeHead(303, {
        Location: location,
        'Set-Cookie': `${COOKIE}=${encodeURIComponent(key)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
        'Cache-Control': 'no-store',
      });
      return response.end();
    }
    if (matches(readCookie(request.headers.cookie, COOKIE), accessKey)) return next();

    if (url.pathname.startsWith('/api/')) {
      response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return response.end(JSON.stringify({ error: 'Acesso não autorizado.' }));
    }
    response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return response.end(loginPage());
  };
}
