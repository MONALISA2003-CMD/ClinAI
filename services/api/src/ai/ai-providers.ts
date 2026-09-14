import { createHash } from 'node:crypto';

type ProviderKind = 'gemini' | 'openrouter' | 'groq' | 'cerebras';
export type AIModel = {
  id: string;
  provider: ProviderKind;
  label: string;
  tier: 'free' | 'trial' | 'paid';
  roles: string[];
  context: number;
  multimodal: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  publicEndpoint: boolean;
  noPersonalData: boolean;
  enabled: boolean;
  priority: number;
};

const envBool = (key: string, fallback = false) => process.env[key] ? process.env[key] === 'true' : fallback;

export const AI_MODELS: AIModel[] = [
  { id: 'gemini-3.8-flash', provider: 'gemini', label: 'Gemini 3.8 Flash', tier: 'free', roles: ['general','reasoning','multimodal'], context: 1048576, multimodal: true, toolCalling: true, structuredOutput: true, publicEndpoint: true, noPersonalData: false, enabled: true, priority: 40 },
  { id: 'nvidia/nemotron-3-ultra:free', provider: 'openrouter', label: 'Nemotron 3 Ultra', tier: 'free', roles: ['reasoning','agentic','research','long-context'], context: 1048576, multimodal: false, toolCalling: true, structuredOutput: true, publicEndpoint: true, noPersonalData: false, enabled: true, priority: 20 },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', provider: 'openrouter', label: 'Nemotron 3 Super', tier: 'free', roles: ['reasoning','agentic','research','long-context'], context: 262144, multimodal: false, toolCalling: true, structuredOutput: true, publicEndpoint: true, noPersonalData: false, enabled: true, priority: 21 },
  { id: 'inclusionai/ling-3.0-flash-sante:free', provider: 'openrouter', label: 'Ling 3.0 Flash Sante', tier: 'free', roles: ['medical-reasoning','clinical-safety','evidence'], context: 262144, multimodal: false, toolCalling: true, structuredOutput: false, publicEndpoint: true, noPersonalData: false, enabled: true, priority: 22 },
  { id: 'thinkingmachines/inkling:free', provider: 'openrouter', label: 'Inkling', tier: 'free', roles: ['reasoning','multimodal','agentic','rag'], context: 1048576, multimodal: true, toolCalling: true, structuredOutput: false, publicEndpoint: true, noPersonalData: true, enabled: true, priority: 23 },
  { id: 'minimax/minimax-m3:free', provider: 'openrouter', label: 'MiniMax M3', tier: 'free', roles: ['reasoning','multimodal','agentic','long-context'], context: 1048576, multimodal: true, toolCalling: true, structuredOutput: false, publicEndpoint: true, noPersonalData: false, enabled: true, priority: 24 },
  { id: 'nex-agi/nex-n2.5-mini:free', provider: 'openrouter', label: 'Nex N2.5 Mini', tier: 'free', roles: ['coding','agentic','verification'], context: 262144, multimodal: true, toolCalling: true, structuredOutput: true, publicEndpoint: true, noPersonalData: false, enabled: true, priority: 25 },
  { id: 'google/gemma-4-31b-it:free', provider: 'openrouter', label: 'Gemma 4 31B', tier: 'free', roles: ['reasoning','multimodal','medical-document','long-context'], context: 262144, multimodal: true, toolCalling: true, structuredOutput: true, publicEndpoint: true, noPersonalData: false, enabled: true, priority: 26 },
  { id: 'google/gemma-4-26b-a4b-it:free', provider: 'openrouter', label: 'Gemma 4 26B A4B', tier: 'free', roles: ['reasoning','multimodal','fast','structured'], context: 262144, multimodal: true, toolCalling: true, structuredOutput: true, publicEndpoint: true, noPersonalData: false, enabled: true, priority: 27 },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', provider: 'openrouter', label: 'Nemotron 3 Nano Omni', tier: 'free', roles: ['multimodal','perception','audio','video','long-context'], context: 262144, multimodal: true, toolCalling: false, structuredOutput: false, publicEndpoint: true, noPersonalData: false, enabled: true, priority: 28 },
  { id: 'inclusionai/ling-3.0-flash-vl:free', provider: 'openrouter', label: 'Ling 3.0 Flash VL', tier: 'free', roles: ['multimodal','medical','agentic','reasoning'], context: 262144, multimodal: true, toolCalling: true, structuredOutput: false, publicEndpoint: true, noPersonalData: false, enabled: true, priority: 29 },
  { id: 'nex-agi/nex-n2.5-pro:free', provider: 'openrouter', label: 'Nex N2.5 Pro', tier: 'free', roles: ['coding','agentic','research','reasoning','multimodal'], context: 262144, multimodal: true, toolCalling: true, structuredOutput: true, publicEndpoint: true, noPersonalData: false, enabled: true, priority: 30 },
  { id: 'minimax/minimax-m2.7:free', provider: 'openrouter', label: 'MiniMax M2.7', tier: 'free', roles: ['agentic','reasoning','coding','documents'], context: 204800, multimodal: false, toolCalling: true, structuredOutput: false, publicEndpoint: true, noPersonalData: false, enabled: true, priority: 31 },
  { id: 'nvidia/nemotron-3.5-lightning:free', provider: 'openrouter', label: 'Nemotron 3.5 Lightning', tier: 'free', roles: ['fast','agentic','reasoning'], context: 1048576, multimodal: false, toolCalling: true, structuredOutput: true, publicEndpoint: true, noPersonalData: false, enabled: true, priority: 32 },
  { id: 'thinkingmachines/inkling-small:free', provider: 'openrouter', label: 'Inkling Small', tier: 'free', roles: ['reasoning','multimodal','agentic','rag','multilingual'], context: 1048576, multimodal: true, toolCalling: true, structuredOutput: false, publicEndpoint: true, noPersonalData: true, enabled: true, priority: 33 },
  { id: 'openai/gpt-oss-120b', provider: 'groq', label: 'GPT OSS 120B on Groq', tier: 'free', roles: ['reasoning','coding','fast'], context: 131072, multimodal: false, toolCalling: true, structuredOutput: true, publicEndpoint: false, noPersonalData: false, enabled: true, priority: 40 },
  { id: 'gpt-oss-120b', provider: 'cerebras', label: 'GPT OSS 120B on Cerebras', tier: 'trial', roles: ['reasoning','coding','fast'], context: 131072, multimodal: false, toolCalling: true, structuredOutput: true, publicEndpoint: false, noPersonalData: false, enabled: true, priority: 41 },
];

export function configuredProviders() {
  return {
    gemini: Boolean(process.env.GEMINI_AUTHORIZATION_KEY || process.env.GEMINI_API_KEY),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    cerebras: Boolean(process.env.CEREBRAS_API_KEY),
  };
}

export function availableModels() {
  const configured = configuredProviders();
  return AI_MODELS.map(m => ({ ...m, configured: configured[m.provider], available: m.enabled && configured[m.provider] }));
}

export type AIRequestCapability = 'text' | 'multimodal' | 'image' | 'audio' | 'video' | 'agentic' | 'medical' | 'coding' | 'research' | 'fast';

export function modelSupportsCapability(model: AIModel, capability?: AIRequestCapability) {
  if (!capability || capability === 'text') return true;
  if (capability === 'multimodal' || capability === 'image' || capability === 'audio' || capability === 'video') return model.multimodal;
  if (capability === 'agentic') return model.roles.includes('agentic') && model.toolCalling;
  if (capability === 'medical') return model.roles.includes('medical-reasoning') || model.roles.includes('medical') || model.roles.includes('clinical-safety');
  if (capability === 'coding') return model.roles.includes('coding');
  if (capability === 'research') return model.roles.includes('research') || model.roles.includes('reasoning');
  if (capability === 'fast') return model.roles.includes('fast');
  return true;
}

export function selectModel(opts: { mode?: string; patientData?: boolean; preferredModel?: string; allowPublic?: boolean; capability?: AIRequestCapability }) {
  const configured = configuredProviders();
  const allowPublic = opts.allowPublic === true;
  const preferred = opts.preferredModel ? AI_MODELS.find(m => m.id === opts.preferredModel) : undefined;
  const candidates = AI_MODELS.filter(m => m.enabled && configured[m.provider] && (!opts.patientData || (!m.noPersonalData && (!m.publicEndpoint || allowPublic))));
  if (!candidates.length) return null;

  const capability = opts.capability;
  const compatible = candidates.filter(m => modelSupportsCapability(m, capability));
  const pool = compatible.length ? compatible : candidates;

  if (preferred && pool.some(m => m.id === preferred.id)) return preferred;

  const role = capability || (opts.mode === 'research' ? 'research' : opts.mode === 'analysis' ? 'reasoning' : (opts.patientData ? 'medical-reasoning' : 'general'));
  const ranked = pool.sort((a,b) => {
    const aRole = a.roles.includes(role) ? 0 : 1;
    const bRole = b.roles.includes(role) ? 0 : 1;
    const aCapability = capability && (capability === 'multimodal' ? a.multimodal : capability === 'agentic' ? a.toolCalling : true) ? 0 : 1;
    const bCapability = capability && (capability === 'multimodal' ? b.multimodal : capability === 'agentic' ? b.toolCalling : true) ? 0 : 1;
    return aRole - bRole || aCapability - bCapability || a.priority - b.priority;
  });
  return ranked[0] || null;
}

function openAIHeaders(apiKey: string, provider: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(provider === 'openrouter' ? { 'HTTP-Referer': process.env.CLINAI_PUBLIC_URL || 'https://clin-ai-nine.vercel.app', 'X-Title': 'ClinAI' } : {}),
  };
}

function extractChatText(data: any) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((x:any) => typeof x === 'string' ? x : x?.text || '').join('');
  return data?.output_text || '';
}

export async function callOpenAICompatible(model: AIModel, prompt: string, system: string, schema: any, opts: { maxTokens?: number; reasoning?: boolean; tools?: any[]; messages?: any[] } = {}) {
  const configured = configuredProviders();
  let url = '';
  let key = '';
  if (model.provider === 'openrouter') { url = 'https://openrouter.ai/api/v1/chat/completions'; key = process.env.OPENROUTER_API_KEY || ''; }
  if (model.provider === 'groq') { url = 'https://api.groq.com/openai/v1/chat/completions'; key = process.env.GROQ_API_KEY || ''; }
  if (model.provider === 'cerebras') { url = 'https://api.cerebras.ai/v1/chat/completions'; key = process.env.CEREBRAS_API_KEY || ''; }
  if (!key || !configured[model.provider]) throw Object.assign(new Error(`${model.label} is not configured.`), { code: 'PROVIDER_NOT_CONFIGURED', statusCode: 503 });
  const messages = opts.messages || [{ role: 'system', content: system }, { role: 'user', content: prompt }];
  const body: any = { model: model.id, messages, temperature: 0.2, max_tokens: opts.maxTokens || 4096 };
  if (opts.tools?.length && model.toolCalling) { body.tools = opts.tools; body.tool_choice = 'auto'; }
  if (model.structuredOutput) body.response_format = { type: 'json_schema', json_schema: { name: 'clinai_answer', strict: true, schema } };
  const controller = new AbortController();
  const timeoutMs = Math.max(3000, Number(process.env.CLINAI_PROVIDER_TIMEOUT_MS || 15000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: openAIHeaders(key, model.provider), body: JSON.stringify(body), signal: controller.signal });
  } catch (error: any) {
    const message = error?.name === 'AbortError' ? `${model.label} took too long to respond.` : (error?.message || `${model.label} connection failed.`);
    throw Object.assign(new Error(message), { statusCode: 504, code: error?.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK_ERROR', provider: model.provider });
  } finally { clearTimeout(timeout); }
  const text = await response.text();
  let data:any; try { data = JSON.parse(text); } catch { data = { error: { message: text } }; }
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || `${model.label} request failed`), { statusCode: response.status, providerMessage: data?.error?.message || text, provider: model.provider });
  return { text: extractChatText(data), message: data?.choices?.[0]?.message || {}, usage: data?.usage || {}, provider: model.provider, model: model.id };
}

export function stableRequestKey(input: any) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
