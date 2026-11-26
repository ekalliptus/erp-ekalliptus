import net from 'node:net';
import {
  AI_PROVIDER_PRESETS,
  PORTFOLIO_AVAILABILITY_STATUSES,
  PORTFOLIO_CATEGORIES,
  PORTFOLIO_OFFER_TYPES,
  PORTFOLIO_PRICE_TYPES,
  type AiProvider,
  type PortfolioAvailabilityStatus,
  type PortfolioCategory,
  type PortfolioOfferType,
  type PortfolioPriceType,
} from '@ekalliptus/contracts';
import { slugifyPortfolioTitle, isSafeHttpsUrl } from './security-policy.js';
import type { WebpageContext } from './demo-capture.js';

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiUsageMetrics {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
}

export type AiCompletionResult =
  | {
      ok: true;
      content: string;
      latencyMs: number;
      usage: AiUsageMetrics;
      finishReason: string | null;
    }
  | {
      ok: false;
      error: string;
      statusCode: number;
      latencyMs: number;
    };

export interface PortfolioAutofillDraft {
  title: string;
  slug: string;
  tagline: string;
  summary: string;
  category: PortfolioCategory;
  offer_type: PortfolioOfferType;
  availability_status: PortfolioAvailabilityStatus;
  price_type: PortfolioPriceType;
  price_amount: string | null;
  delivery_estimate: string;
  client_name: string;
  demo_url: string | null;
  tech_stack: string[];
  highlights: string[];
  whatsapp_prefill: string;
}

const PRIVATE_HOSTNAME_RE =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

function isPrivateIpv4Host(hostname: string): boolean {
  const ipVersion = net.isIP(hostname);
  if (ipVersion === 6) return true;
  if (ipVersion !== 4) return false;
  return true;
}

export function isSafeAiEndpointUrl(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.port && parsed.port !== '443') return false;
  const host = parsed.hostname.toLowerCase();
  if (!host || !host.includes('.')) return false;
  if (PRIVATE_HOSTNAME_RE.test(host)) return false;
  if (isPrivateIpv4Host(host)) return false;
  return true;
}

export function resolveEndpointUrl(
  provider: AiProvider,
  customEndpoint?: string | null,
): string | null {
  if (provider === 'custom') {
    const trimmed = customEndpoint?.trim() ?? '';
    if (!isSafeAiEndpointUrl(trimmed)) return null;
    const parsed = new URL(trimmed);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    const lowerPath = cleanPath.toLowerCase();
    const hasCompletionSuffix =
      lowerPath.endsWith('/chat/completions') ||
      lowerPath.endsWith('/completions') ||
      lowerPath.endsWith('/responses');
    const finalPath = hasCompletionSuffix ? cleanPath : `${cleanPath}/chat/completions`;
    return `${parsed.origin}${finalPath}${parsed.search}`;
  }
  const preset = AI_PROVIDER_PRESETS[provider];
  return preset?.endpoint || null;
}

function inspectCompletionPayload(payload: unknown): {
  content: string;
  finishReason: string | null;
  hasReasoning: boolean;
} {
  if (!payload || typeof payload !== 'object') {
    return { content: '', finishReason: null, hasReasoning: false };
  }
  const data = payload as {
    output_text?: string;
    choices?: Array<{
      finish_reason?: string | null;
      text?: string;
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
        reasoning_content?: string;
        reasoning?: string;
      };
    }>;
  };
  const firstChoice = data.choices?.[0];
  const finishReason =
    typeof firstChoice?.finish_reason === 'string' ? firstChoice.finish_reason : null;
  const reasoningRaw =
    typeof firstChoice?.message?.reasoning_content === 'string'
      ? firstChoice.message.reasoning_content
      : typeof firstChoice?.message?.reasoning === 'string'
        ? firstChoice.message.reasoning
        : '';
  const hasReasoning = reasoningRaw.trim().length > 0;

  const rawContent = firstChoice?.message?.content;
  if (typeof rawContent === 'string' && rawContent.trim().length > 0) {
    return { content: rawContent.trim(), finishReason, hasReasoning };
  }
  if (Array.isArray(rawContent)) {
    const joined = rawContent
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    if (joined.length > 0) {
      return { content: joined, finishReason, hasReasoning };
    }
  }
  if (typeof firstChoice?.text === 'string' && firstChoice.text.trim().length > 0) {
    return { content: firstChoice.text.trim(), finishReason, hasReasoning };
  }
  if (typeof data.output_text === 'string' && data.output_text.trim().length > 0) {
    return { content: data.output_text.trim(), finishReason, hasReasoning };
  }
  return { content: '', finishReason, hasReasoning };
}

function extractUsage(payload: unknown): AiUsageMetrics {
  if (!payload || typeof payload !== 'object') {
    return { prompt_tokens: null, completion_tokens: null, total_tokens: null };
  }
  const usage = (payload as { usage?: Record<string, unknown> }).usage;
  if (!usage || typeof usage !== 'object') {
    return { prompt_tokens: null, completion_tokens: null, total_tokens: null };
  }
  const toInt = (val: unknown): number | null =>
    typeof val === 'number' && Number.isFinite(val) ? Math.max(0, Math.round(val)) : null;
  return {
    prompt_tokens: toInt(usage.prompt_tokens),
    completion_tokens: toInt(usage.completion_tokens),
    total_tokens: toInt(usage.total_tokens),
  };
}

export async function callAiChatCompletion(params: {
  provider: AiProvider;
  endpoint: string;
  apiKey: string;
  model: string;
  messages: AiChatMessage[];
  temperature: number;
  maxTokens: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<AiCompletionResult> {
  if (!isSafeAiEndpointUrl(params.endpoint)) {
    return {
      ok: false,
      error: 'Endpoint AI tidak diizinkan (harus domain HTTPS publik).',
      statusCode: 400,
      latencyMs: 0,
    };
  }
  const apiKey = params.apiKey.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: 'API key AI belum dikonfigurasi.',
      statusCode: 422,
      latencyMs: 0,
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (params.provider === 'zai') {
    headers['Accept-Language'] = 'id-ID,en-US,en';
  } else if (
    params.provider === 'openrouter' ||
    params.endpoint.toLowerCase().includes('openrouter.ai')
  ) {
    headers['HTTP-Referer'] = 'https://ekalliptus.com';
    headers['X-Title'] = 'Ekalliptus Digital';
  }

  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? 45_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const fetchFn = params.fetchImpl ?? fetch;

  try {
    const response = await fetchFn(params.endpoint, {
      method: 'POST',
      headers,
      redirect: 'error',
      signal: controller.signal,
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stream: false,
      }),
    });

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return {
        ok: false,
        error: `Provider mengembalikan HTTP ${response.status}${errText ? `: ${errText.slice(0, 180)}` : ''}`,
        statusCode: response.status,
        latencyMs,
      };
    }

    const payload = await response.json().catch(() => null);
    const inspected = inspectCompletionPayload(payload);
    if (!inspected.content) {
      const tokenLimitHit = inspected.finishReason === 'length' || inspected.hasReasoning;
      return {
        ok: false,
        error: tokenLimitHit
          ? 'Respons model AI kosong karena batas Max Tokens terlalu kecil untuk proses reasoning. Naikkan Max Tokens di AI Management (disarankan >= 512 untuk Konsultasi, >= 1200 untuk Auto-Fill).'
          : 'Respons model AI kosong atau format tidak dikenali.',
        statusCode: 502,
        latencyMs,
      };
    }

    return {
      ok: true,
      content: inspected.content,
      latencyMs,
      usage: extractUsage(payload),
      finishReason: inspected.finishReason,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? `Koneksi ke provider AI timeout setelah ${Math.round(timeoutMs / 1000)} detik.`
        : err instanceof Error
          ? err.message
          : 'Gagal menghubungi provider AI.';
    return {
      ok: false,
      error: message,
      statusCode: 502,
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

function cleanNoEmDash(raw: string): string {
  return raw.replace(/\u2014/g, ', ').replace(/\s+,/g, ',').trim();
}

export function buildPortfolioAutofillMessages(
  input: {
    brief: string;
    title: string;
    category?: PortfolioCategory;
    demo_url?: string;
    tech_stack_hint?: string;
    language?: 'id' | 'en';
    webpage?: WebpageContext | null;
  },
  systemPrompt: string,
  extraInstructions?: string,
): AiChatMessage[] {
  const sysParts = [
    systemPrompt.trim() ||
      'Kamu adalah penulis katalog produk digital Ekalliptus Digital. Susun isian form portofolio yang jelas, jujur, dan spesifik.',
    'Aturan ketat output:',
    '1. Balas HANYA dengan 1 objek JSON valid tanpa markdown fence tambahan jika memungkinkan.',
    '2. Dilarang memakai karakter em dash (\u2014). Gunakan koma, titik, atau tanda hubung biasa (-).',
    '3. Hindari klaim palsu atau buzzword kosong seperti revolusioner, next-generation, seamless.',
    '4. Key JSON wajib:',
    '{"title": string, "slug": string (kebab-case), "tagline": string (max 140 char), "summary": string (2-4 kalimat jelas), "category": "website"|"mobile_app"|"web_mobile"|"erp_system"|"ui_ux"|"automation"|"other", "offer_type": "ready_to_buy"|"custom_similar"|"hybrid", "availability_status": "available"|"custom_only"|"sold", "price_type": "negotiable"|"fixed"|"starting_from", "price_amount": string_digits_or_null, "delivery_estimate": string (contoh "3-5 hari kerja"), "client_name": string (industri/sektor, contoh "Retail & Gudang"), "demo_url": string_https_or_null, "tech_stack": string[] (max 8 item), "highlights": string[] (4-7 fitur nyata/deliverables), "whatsapp_prefill": string (1 kalimat pembuka WA sopan, max 180 char)}',
    '5. Secara default untuk portofolio profesional, JANGAN tampilkan harga ("price_type": "negotiable", "price_amount": null). Dilarang mengambil harga langganan/in-app pengguna akhir dari website demo sebagai harga jual project. Isi nominal harga hanya jika catatan admin secara eksplisit menuliskan harga jual/pembuatan project. Jika disediakan konten aktual website, gunakan fakta aktual dari website tersebut. Langsung tulis JSON singkat dan padat tanpa narasi tambahan.',
  ];
  if (extraInstructions && extraInstructions.trim().length > 0) {
    sysParts.push(`Instruksi tambahan admin: ${extraInstructions.trim()}`);
  }

  const langLabel = input.language === 'en' ? 'English' : 'Bahasa Indonesia';
  const userLines = [
    `Bahasa hasil: ${langLabel}`,
    input.title ? `Judul sementara: ${input.title}` : '',
    input.category ? `Kategori dipilih: ${input.category}` : '',
    input.demo_url ? `URL Demo: ${input.demo_url}` : '',
    input.tech_stack_hint ? `Petunjuk tech stack: ${input.tech_stack_hint}` : '',
    input.brief ? `Catatan / deskripsi project:\n${input.brief}` : '',
  ];

  if (input.webpage) {
    const wp = input.webpage;
    userLines.push(
      [
        `Konten aktual yang dibaca langsung dari website ${wp.url}:`,
        wp.title ? `- Title: ${wp.title}` : '',
        wp.description ? `- Description: ${wp.description}` : '',
        wp.keywords ? `- Keywords: ${wp.keywords}` : '',
        wp.headings.length > 0 ? `- Headings: ${wp.headings.join(' | ')}` : '',
        wp.detectedTechClues.length > 0
          ? `- Deteksi Teknologi: ${wp.detectedTechClues.join(', ')}`
          : '',
        wp.visibleText ? `- Isi Halaman:\n${wp.visibleText.slice(0, 2200)}` : '',
        'Gunakan fakta aktual dari website di atas (jangan mengarang fitur atau kategori yang bertentangan dengan isi website tersebut).',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return [
    { role: 'system', content: sysParts.join('\n') },
    { role: 'user', content: userLines.filter(Boolean).join('\n') },
  ];
}

function pickEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase() as T;
    if (allowed.includes(normalized)) return normalized;
  }
  return fallback;
}

function extractBalancedJsonObjects(text: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        candidates.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
  } catch {
    // Fallback for trailing commas inside JSON objects/arrays
    try {
      const cleaned = raw.replace(/,\s*([}\]])/g, '$1');
      const obj = JSON.parse(cleaned) as unknown;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return obj as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function parsePortfolioAutofillJson(
  rawContent: string,
  fallbackDemoUrl?: string | null,
): PortfolioAutofillDraft {
  const withoutThink = rawContent
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim();

  const withoutFence = withoutThink
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const candidates = extractBalancedJsonObjects(withoutFence);
  let parsed: Record<string, unknown> | null = null;
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    parsed = tryParseJsonObject(candidates[i]);
    if (parsed) break;
  }

  if (!parsed) {
    throw new Error('Model AI tidak mengembalikan JSON portofolio yang valid.');
  }

  const rawTitle = typeof parsed.title === 'string' ? cleanNoEmDash(parsed.title) : '';
  const title = rawTitle.slice(0, 140) || 'Project Digital Ekalliptus';
  const rawSlug = typeof parsed.slug === 'string' ? cleanNoEmDash(parsed.slug) : '';
  const slug = slugifyPortfolioTitle(rawSlug || title) || 'project-ekalliptus';

  const priceType = pickEnum(parsed.price_type, PORTFOLIO_PRICE_TYPES, 'negotiable');
  let priceAmount: string | null = null;
  if (priceType !== 'negotiable' && parsed.price_amount !== null && parsed.price_amount !== undefined) {
    const digits = String(parsed.price_amount).replace(/\D/g, '');
    if (digits && BigInt(digits) > 0n) {
      priceAmount = digits;
    }
  }

  const cleanList = (val: unknown, maxLen: number, maxItems: number): string[] => {
    if (!Array.isArray(val)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of val) {
      if (typeof item !== 'string') continue;
      const cleaned = cleanNoEmDash(item).slice(0, maxLen);
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cleaned);
      if (out.length >= maxItems) break;
    }
    return out;
  };

  const rawDemoUrl = typeof parsed.demo_url === 'string' ? parsed.demo_url.trim() : '';
  const resolvedDemoUrl = isSafeHttpsUrl(rawDemoUrl)
    ? rawDemoUrl
    : fallbackDemoUrl && isSafeHttpsUrl(fallbackDemoUrl)
      ? fallbackDemoUrl.trim()
      : null;

  return {
    title,
    slug,
    tagline:
      typeof parsed.tagline === 'string' ? cleanNoEmDash(parsed.tagline).slice(0, 220) : '',
    summary:
      typeof parsed.summary === 'string' ? cleanNoEmDash(parsed.summary).slice(0, 5000) : '',
    category: pickEnum(parsed.category, PORTFOLIO_CATEGORIES, 'website'),
    offer_type: pickEnum(parsed.offer_type, PORTFOLIO_OFFER_TYPES, 'hybrid'),
    availability_status: pickEnum(
      parsed.availability_status,
      PORTFOLIO_AVAILABILITY_STATUSES,
      'available',
    ),
    price_type: priceType,
    price_amount: priceAmount,
    delivery_estimate:
      typeof parsed.delivery_estimate === 'string'
        ? cleanNoEmDash(parsed.delivery_estimate).slice(0, 80)
        : '',
    client_name:
      typeof parsed.client_name === 'string'
        ? cleanNoEmDash(parsed.client_name).slice(0, 120)
        : '',
    demo_url: resolvedDemoUrl,
    tech_stack: cleanList(parsed.tech_stack, 40, 12),
    highlights: cleanList(parsed.highlights, 200, 10),
    whatsapp_prefill:
      typeof parsed.whatsapp_prefill === 'string'
        ? cleanNoEmDash(parsed.whatsapp_prefill).slice(0, 300)
        : '',
  };
}
