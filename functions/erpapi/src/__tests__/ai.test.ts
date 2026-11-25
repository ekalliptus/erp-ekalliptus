import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  portfolioAutofillRequestSchema,
  updateAiFeatureConfigSchema,
} from '@ekalliptus/contracts';
import { resolveSharedModelId } from '../modules/ai.js';
import { decryptApiKey, encryptApiKey, maskApiKey } from '../services/ai-crypto.js';
import {
  buildPortfolioAutofillMessages,
  callAiChatCompletion,
  isSafeAiEndpointUrl,
  parsePortfolioAutofillJson,
  resolveEndpointUrl,
} from '../services/ai-provider.js';

describe('AI key encryption & masking', () => {
  it('encrypts and decrypts API keys with AES-256-GCM and rejects tampering', () => {
    const secret = 'test-master-secret-32-chars-minimum';
    const rawKey = 'sk-proj-abc123456789xyz';
    const cipher = encryptApiKey(rawKey, secret);

    assert.ok(cipher.startsWith('v1:'));
    assert.equal(cipher.includes(rawKey), false);
    assert.equal(decryptApiKey(cipher, secret), rawKey);
    assert.equal(decryptApiKey(cipher, 'wrong-secret'), null);

    const tampered = `${cipher.slice(0, -2)}ff`;
    assert.equal(decryptApiKey(tampered, secret), null);
  });

  it('masks API keys safely without exposing middle secret bytes', () => {
    assert.equal(maskApiKey('sk-proj-1234567890abcd'), 'sk-p••••abcd');
    assert.equal(maskApiKey('12345678'), '••••5678');
    assert.equal(maskApiKey(''), '');
  });
});

describe('AI endpoint SSRF validator & autofill JSON parser', () => {
  it('allows only public HTTPS endpoints without credentials or private IPs', () => {
    assert.equal(isSafeAiEndpointUrl('https://api.openai.com/v1/chat/completions'), true);
    assert.equal(isSafeAiEndpointUrl('http://api.openai.com/v1/chat/completions'), false);
    assert.equal(isSafeAiEndpointUrl('https://localhost/v1/chat'), false);
    assert.equal(isSafeAiEndpointUrl('https://127.0.0.1/v1/chat'), false);
    assert.equal(isSafeAiEndpointUrl('https://169.254.169.254/latest/meta-data'), false);
    assert.equal(isSafeAiEndpointUrl('https://10.0.0.5/v1/chat'), false);
    assert.equal(isSafeAiEndpointUrl('https://user:pass@api.openai.com/v1'), false);
    assert.equal(isSafeAiEndpointUrl('https://api.openai.com:8443/v1'), false);
  });

  it('normalizes OpenAI-compatible custom base URLs by appending /chat/completions', () => {
    assert.equal(
      resolveEndpointUrl('custom', 'https://router.ekalliptus.com/v1'),
      'https://router.ekalliptus.com/v1/chat/completions',
    );
    assert.equal(
      resolveEndpointUrl('custom', 'https://router.ekalliptus.com/v1/'),
      'https://router.ekalliptus.com/v1/chat/completions',
    );
    assert.equal(
      resolveEndpointUrl('custom', 'https://router.ekalliptus.com/v1/chat/completions'),
      'https://router.ekalliptus.com/v1/chat/completions',
    );
    assert.equal(resolveEndpointUrl('custom', 'http://router.ekalliptus.com/v1'), null);
    assert.equal(resolveEndpointUrl('custom', 'https://localhost/v1'), null);
    assert.equal(resolveEndpointUrl('custom', 'https://192.168.0.5/v1'), null);
  });

  it('parses fenced JSON draft, enforces web_mobile category, and strips em dashes', () => {
    const raw = [
      '```json',
      JSON.stringify({
        title: 'POS & App Retail — Versi Lengkap',
        slug: 'POS & App Retail!',
        tagline: 'Kasir web & Android terintegrasi',
        summary: 'Solusi operasional toko — siap pakai cepat.',
        category: 'web_mobile',
        offer_type: 'hybrid',
        availability_status: 'available',
        price_type: 'starting_from',
        price_amount: 'Rp 4.500.000',
        delivery_estimate: '5 hari kerja',
        client_name: 'Retail',
        tech_stack: ['React', 'Flutter', 'React'],
        highlights: ['Kasir web — stok real-time', 'Aplikasi Android kasir'],
        whatsapp_prefill: 'Halo, saya tertarik dengan POS & App Retail.',
      }),
      '```',
    ].join('\n');

    const draft = parsePortfolioAutofillJson(raw);
    assert.equal(draft.category, 'web_mobile');
    assert.equal(draft.slug, 'pos-app-retail');
    assert.equal(draft.price_amount, '4500000');
    assert.deepEqual(draft.tech_stack, ['React', 'Flutter']);
    assert.equal(draft.title.includes('\u2014'), false);
    assert.equal(draft.summary.includes('\u2014'), false);
    assert.equal(draft.highlights[0]?.includes('\u2014'), false);

    assert.throws(() => parsePortfolioAutofillJson('bukan json'), /JSON/);
    assert.throws(() => parsePortfolioAutofillJson('{"title":"terpotong"'), /JSON/);

    const withThinkAndTrailingComma = parsePortfolioAutofillJson(
      [
        '<think>Cek format {contoh} sebelum menjawab.</think>',
        '```json',
        '{',
        '  "title": "Sistem Kasir Web",',
        '  "slug": "sistem-kasir-web",',
        '  "category": "website",',
        '  "tech_stack": ["React", "Postgres",],',
        '  "highlights": ["Cepat", "Rapi",],',
        '}',
        '```',
      ].join('\n'),
    );
    assert.equal(withThinkAndTrailingComma.title, 'Sistem Kasir Web');
    assert.deepEqual(withThinkAndTrailingComma.tech_stack, ['React', 'Postgres']);
  });

  it('builds structured autofill prompt with brief and categories', () => {
    const msgs = buildPortfolioAutofillMessages(
      { brief: 'Aplikasi kasir web + mobile untuk toko bangunan', title: '', category: 'web_mobile' },
      'System prompt uji',
    );
    assert.equal(msgs.length, 2);
    assert.ok(msgs[0].content.includes('web_mobile'));
    assert.ok(msgs[1].content.includes('toko bangunan'));
  });
});

describe('AI Management contracts validation', () => {
  it('enforces custom_endpoint HTTPS for custom provider unless shared key is active', () => {
    const missingCustom = updateAiFeatureConfigSchema.safeParse({
      feature_key: 'consult',
      is_enabled: true,
      provider: 'custom',
      custom_endpoint: '',
      model: 'my-model',
      system_prompt: 'Prompt',
      temperature: 0.7,
      max_tokens: 512,
    });
    assert.equal(missingCustom.success, false);

    const sharedAutofill = updateAiFeatureConfigSchema.safeParse({
      feature_key: 'portfolio_autofill',
      is_enabled: true,
      provider: 'custom',
      custom_endpoint: '',
      use_shared_key: true,
      model: 'glm-4.5-air',
      system_prompt: 'Prompt JSON',
      temperature: 0.4,
      max_tokens: 1200,
    });
    assert.equal(sharedAutofill.success, true);

    const shortBrief = portfolioAutofillRequestSchema.safeParse({ brief: 'hi', title: '' });
    assert.equal(shortBrief.success, false);
  });

  it('inherits router prefix for shared portfolio_autofill model and surfaces clear Max Tokens reasoning error', async () => {
    assert.equal(
      resolveSharedModelId({
        shareFromConsult: true,
        targetProvider: 'zai',
        effectiveProvider: 'custom',
        rawTargetModel: 'glm-5.3-flash',
        consultModel: 'glm/glm-5.3-flash',
      }),
      'glm/glm-5.3-flash',
    );
    assert.equal(
      resolveSharedModelId({
        shareFromConsult: true,
        targetProvider: 'custom',
        effectiveProvider: 'custom',
        rawTargetModel: '',
        consultModel: 'glm/glm-5.3-flash',
      }),
      'glm/glm-5.3-flash',
    );
    assert.equal(
      resolveSharedModelId({
        shareFromConsult: true,
        targetProvider: 'custom',
        effectiveProvider: 'custom',
        rawTargetModel: 'deepseek/deepseek-v3',
        consultModel: 'glm/glm-5.3-flash',
      }),
      'deepseek/deepseek-v3',
    );
    assert.equal(
      resolveSharedModelId({
        shareFromConsult: true,
        targetProvider: 'zai',
        effectiveProvider: 'custom',
        rawTargetModel: 'glm-4.5-air',
        consultModel: 'glm/glm-5.3-flash',
      }),
      'glm/glm-5.3-flash',
    );

    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'length',
              message: {
                content: '',
                reasoning_content: 'Menyusun jawaban tapi kehabisan token...',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const res = await callAiChatCompletion({
      provider: 'custom',
      endpoint: 'https://router.ekalliptus.com/v1/chat/completions',
      apiKey: 'sk-test-123',
      model: 'glm/glm-5.3-flash',
      messages: [{ role: 'user', content: 'Halo' }],
      temperature: 0.7,
      maxTokens: 64,
      fetchImpl: mockFetch,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.error, /Max Tokens/);
    }

    const okFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: 'Siap membantu!' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    const okRes = await callAiChatCompletion({
      provider: 'custom',
      endpoint: 'https://router.ekalliptus.com/v1/chat/completions',
      apiKey: 'sk-test-123',
      model: 'glm/glm-5.3-flash',
      messages: [{ role: 'user', content: 'Halo' }],
      temperature: 0.7,
      maxTokens: 512,
      fetchImpl: okFetch,
    });
    assert.equal(okRes.ok, true);
    if (okRes.ok) {
      assert.equal(okRes.finishReason, 'stop');
    }
  });
});
