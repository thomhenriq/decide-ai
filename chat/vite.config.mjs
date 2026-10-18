import { defineConfig, loadEnv } from 'vite';
import { createTranscriptionHandler } from './server/transcription.mjs';
import { createLocalTranscriber } from './server/local-transcriber.mjs';
import { createImageHandlers } from './server/images.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const transcription = createTranscriptionHandler({
    transcribe: createLocalTranscriber({ model: process.env.WHISPER_MODEL || env.WHISPER_MODEL || 'base' }),
  });
  const configure = server => {
    const images = createImageHandlers();
    server.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] === '/api/transcriptions') return transcription(request, response);
      if (request.url?.split('?')[0] === '/api/images') return images.upload(request, response);
      if (request.url?.startsWith('/api/images/')) return images.serve(request, response);
      next();
    });
  };
  return {
    plugins: [{ name: 'decide-ai-transcription', configureServer: configure, configurePreviewServer: configure }],
  };
});
