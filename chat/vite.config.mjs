import { defineConfig, loadEnv } from 'vite';
import { createTranscriptionHandler } from './server/transcription.mjs';
import { createLocalTranscriber } from './server/local-transcriber.mjs';
import { createImageHandlers } from './server/images.mjs';
import { createAgentHandler } from './server/agent.mjs';
import { createAccessGuard } from './server/access.mjs';
import { createEventStore } from './server/events.mjs';
import { createReverseGeocoder } from './server/geocode.mjs';
import { createRestaurantAgentHandler } from './server/restaurant-agent.mjs';

// Domínios dos túneis usados para expor a demo (Cloudflare Tunnel e ngrok).
const TUNNEL_HOSTS = ['.trycloudflare.com', '.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app'];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const transcription = createTranscriptionHandler({
    transcribe: createLocalTranscriber({ model: process.env.WHISPER_MODEL || env.WHISPER_MODEL || 'base' }),
  });
  const latitude = Number(process.env.USER_LATITUDE || env.USER_LATITUDE);
  const longitude = Number(process.env.USER_LONGITUDE || env.USER_LONGITUDE);
  const read = name => process.env[name] || env[name];
  // Banco SQLite da Inteligência de Demanda (data/decide-ai.db, fora do Git).
  const events = createEventStore();
  const agent = createAgentHandler({
    model: read('CLAUDE_MODEL') || undefined,
    events,
    geocode: createReverseGeocoder(),
    // Sem USER_LATITUDE/USER_LONGITUDE, o agente usa o GPS do navegador ou pergunta o endereço no chat.
    fallbackLocation: Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : undefined,
  });
  const closingHour = Number.parseInt(read('RESTAURANT_CLOSING_HOUR') ?? '', 10);
  const restaurantAgent = createRestaurantAgentHandler({
    store: events,
    model: read('CLAUDE_MODEL') || undefined,
    restaurant: {
      name: read('RESTAURANT_NAME') || undefined,
      closingHour: closingHour >= 0 && closingHour <= 23 ? closingHour : undefined,
      city: read('RESTAURANT_CITY') || undefined,
    },
  });
  // Com DEMO_ACCESS_KEY, acessos vindos do túnel precisam da senha; o localhost continua livre.
  const access = createAccessGuard({ accessKey: process.env.DEMO_ACCESS_KEY || env.DEMO_ACCESS_KEY });
  const configure = server => {
    const images = createImageHandlers();
    server.middlewares.use(access);
    server.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] === '/api/transcriptions') return transcription(request, response);
      if (request.url?.split('?')[0] === '/api/agent') {
        // Cada mensagem do cliente conta para apagar as imagens da pasta temp após 10 mensagens.
        if (request.method === 'POST') void images.messageSent();
        return agent(request, response);
      }
      if (request.url?.split('?')[0] === '/api/restaurant/agent') return restaurantAgent(request, response);
      if (request.url?.split('?')[0] === '/api/images') return images.upload(request, response);
      if (request.url?.startsWith('/api/images/')) return images.serve(request, response);
      next();
    });
  };
  return {
    server: { allowedHosts: TUNNEL_HOSTS },
    preview: { allowedHosts: TUNNEL_HOSTS },
    plugins: [{ name: 'decide-ai-transcription', configureServer: configure, configurePreviewServer: configure }],
  };
});
