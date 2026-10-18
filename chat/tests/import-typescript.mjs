import { readFile, access } from 'node:fs/promises';
import ts from 'typescript';

const cache = new Map();
async function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href);
  const pending = (async () => {
    const source = await readFile(url, 'utf8');
    if (url.pathname.endsWith('.json')) return `data:text/javascript;base64,${Buffer.from(`export default ${JSON.stringify(JSON.parse(source))}`).toString('base64')}`;
    let code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const pattern = /\bfrom\s*(['"])([^'"]+)\1/g;
    const replacements = new Map();
    for (const [, , specifier] of code.matchAll(pattern)) {
      if (replacements.has(specifier)) continue;
      if (!specifier.startsWith('.')) { replacements.set(specifier, import.meta.resolve(specifier)); continue; }
      const target = new URL(specifier, url);
      let resolved;
      for (const suffix of ['', '.ts', '.tsx', '.mjs', '.js', '.json']) {
        const candidate = new URL(target.href + suffix);
        try { await access(candidate); resolved = candidate; break; } catch { /* Tenta a próxima extensão. */ }
      }
      if (!resolved) throw new Error(`Não foi possível resolver ${specifier}`);
      replacements.set(specifier, await moduleUrl(resolved));
    }
    code = code.replace(pattern, (_, quote, specifier) => `from ${quote}${replacements.get(specifier)}${quote}`);
    return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  })();
  cache.set(url.href, pending);
  return pending;
}

export async function importTypeScript(path) { return import(await moduleUrl(new URL(path, import.meta.url))); }
