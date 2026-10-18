import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';

const root = process.cwd();
const config = { ...loadEnv('development', root, ''), ...process.env };
const python = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, env: {
      ...config, PYTHONUTF8: '1', HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_XET: '1',
    } });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolveRun() : reject(new Error(`A instalação terminou com código ${code}.`)));
  });
}

try {
  if (!existsSync(python)) {
    const candidates = config.PYTHON_EXECUTABLE ? [[config.PYTHON_EXECUTABLE, []]] : process.platform === 'win32'
      ? [['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3.13']], ['python', []]]
      : [['python3', []], ['python', []]];
    const candidate = candidates.find(([command, args]) => {
      const probe = spawnSync(command, [...args, '-c', 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)'], { windowsHide: true, timeout: 10_000, stdio: 'ignore' });
      return probe.status === 0;
    });
    if (!candidate) throw new Error('Instale Python 3.10 a 3.13 ou defina PYTHON_EXECUTABLE com o caminho para uma dessas versões.');
    console.log('Preparando ambiente Python isolado em .venv…');
    await run(candidate[0], [...candidate[1], '-m', 'venv', '.venv']);
  }
  console.log('Instalando o transcritor local…');
  await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--only-binary=:all:', '-r', 'server/requirements.txt']);
  console.log('Baixando e verificando o modelo local (necessário só na primeira instalação)…');
  await run(python, ['server/transcribe.py', '--download']);
  console.log('Áudio pronto. Inicie o chat com npm run dev. Nenhuma chave de API é necessária.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
