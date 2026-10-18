import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { normalizeAgentResponse } from './services/agentMessages';
import productExample from '../public/examples/products.json';
import singleProductExample from '../public/examples/product.json';
import textExample from '../public/examples/text.json';
import './styles.css';
import './products.css';
import './workspace.css';

const previewResponse = new URLSearchParams(window.location.search).get('preview') === 'products'
  ? normalizeAgentResponse(productExample) || undefined : undefined;

const previewTemplates = previewResponse ? [
  { label: 'Texto', response: normalizeAgentResponse(textExample)! },
  { label: '1 produto', response: normalizeAgentResponse(singleProductExample)! },
  { label: 'Vários produtos', response: previewResponse },
] : undefined;

createRoot(document.getElementById('root')!).render(<StrictMode><App previewResponse={previewResponse} previewTemplates={previewTemplates} /></StrictMode>);
