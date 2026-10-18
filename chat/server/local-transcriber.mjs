import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function createLocalTranscriber({ root = process.cwd(), model = 'base' } = {}) {
  const python = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  let queue = Promise.resolve();
  let pending = 0;

  function execute(audio, signal) {
    if (!existsSync(python)) return Promise.reject(Object.assign(new Error('A transcrição local ainda não foi instalada. Execute npm run setup:audio no servidor.'), { status: 503 }));
    return new Promise((resolveJob, reject) => {
      const worker = spawn(python, [resolve(root, 'server/transcribe.py')], {
        cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', WHISPER_MODEL: model, HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' },
      });
      let output = '';
      let stderr = '';
      const cancel = () => { worker.kill(); reject(signal.reason || new DOMException('Cancelado', 'AbortError')); };
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) { cancel(); return; }
      worker.stdout.setEncoding('utf8');
      worker.stderr.setEncoding('utf8');
      worker.stdout.on('data', chunk => { output += chunk; });
      worker.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
      worker.stdin.on('error', () => { /* Um worker encerrado pode fechar a entrada antes da escrita. */ });
      worker.on('error', () => {
        signal.removeEventListener('abort', cancel);
        reject(Object.assign(new Error('Não foi possível iniciar o transcritor local. Execute npm run setup:audio.'), { status: 503 }));
      });
      worker.on('close', code => {
        signal.removeEventListener('abort', cancel);
        if (signal.aborted) return;
        try {
          const result = JSON.parse(output.trim());
          if (result.error) return reject(Object.assign(new Error(result.error), { status: result.status || 502 }));
          if (code !== 0 || typeof result.text !== 'string') throw new Error('Resposta inválida do transcritor.');
          resolveJob(result.text);
        } catch {
          if (stderr) console.error('[audio:local]', stderr);
          reject(Object.assign(new Error('Não foi possível executar o transcritor local. Verifique a instalação e tente novamente.'), { status: 502 }));
        }
      });
      worker.stdin.end(audio);
    });
  }

  return (audio, { signal }) => {
    if (pending >= 3) return Promise.reject(Object.assign(new Error('Já há áudios aguardando transcrição. Tente novamente em instantes.'), { status: 429 }));
    pending++;
    const job = queue.catch(() => {}).then(() => {
      signal.throwIfAborted();
      return execute(audio, signal);
    });
    queue = job.catch(() => {});
    return job.finally(() => { pending--; });
  };
}
