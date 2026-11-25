import {
  AI_PROVIDERS,
  hasPermission,
  type AiFeatureKey,
  type AiProvider,
} from '@ekalliptus/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  Check,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  MessageSquare,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { ModulePageSkeleton } from '../components/Skeleton.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge, type BadgeTone } from '../components/StatusBadge.tsx';
import {
  erpApi,
  type AiFeatureConfigView,
  type AiProviderPresetView,
  type MeResponse,
  type PortfolioAutofillDraft,
} from '../lib/api.ts';
import { formatDateTimeId } from '../lib/format.ts';

type ActiveTab = 'consult' | 'portfolio_autofill' | 'logs';

interface FeatureFormState {
  isEnabled: boolean;
  provider: AiProvider;
  customEndpoint: string;
  model: string;
  apiKeyInput: string;
  clearApiKey: boolean;
  useSharedKey: boolean;
  systemPrompt: string;
  temperature: string;
  maxTokens: string;
  assistantName: string;
  greetingMessage: string;
  handoffPhrasesText: string;
  fallbackMessagesText: string;
  extraInstructions: string;
}

function configToFormState(cfg: AiFeatureConfigView): FeatureFormState {
  return {
    isEnabled: cfg.is_enabled,
    provider: cfg.provider,
    customEndpoint: cfg.custom_endpoint ?? '',
    model: cfg.model,
    apiKeyInput: '',
    clearApiKey: false,
    useSharedKey: cfg.use_shared_key,
    systemPrompt: cfg.system_prompt,
    temperature: String(cfg.temperature),
    maxTokens: String(cfg.max_tokens),
    assistantName: cfg.assistant_name || 'eBot',
    greetingMessage: cfg.greeting_message,
    handoffPhrasesText: cfg.handoff_phrases.join('\n'),
    fallbackMessagesText: cfg.fallback_messages.join('\n'),
    extraInstructions: cfg.extra_instructions,
  };
}

function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const LOG_STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  ok: { label: 'Sukses', tone: 'success' },
  handoff: { label: 'Handoff WA', tone: 'info' },
  fallback: { label: 'Fallback', tone: 'warning' },
  error: { label: 'Gagal', tone: 'danger' },
};

export function AiManagementPage({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const baseId = useId();

  const canView = hasPermission(me.permissions, 'ai', 'view');
  const canUpdate = hasPermission(me.permissions, 'ai', 'update');

  const [activeTab, setActiveTab] = useState<ActiveTab>('consult');
  const [logFilter, setLogFilter] = useState<'all' | AiFeatureKey>('all');
  const [showKey, setShowKey] = useState(false);

  const [consultForm, setConsultForm] = useState<FeatureFormState | null>(null);
  const [autofillForm, setAutofillForm] = useState<FeatureFormState | null>(null);

  const [saveNotice, setSaveNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  const [consultTestPrompt, setConsultTestPrompt] = useState(
    'Halo, berapa kisaran harga pembuatan website company profile di Ekalliptus?',
  );
  const [autofillTestPrompt, setAutofillTestPrompt] = useState(
    'Website + aplikasi kasir UMKM multi cabang dengan laporan keuangan harian, Laravel + Flutter, siap 7 hari kerja.',
  );

  const [testResult, setTestResult] = useState<{
    feature: AiFeatureKey;
    ok: boolean;
    latency_ms: number;
    provider: string;
    model: string;
    reply?: string;
    parsed_preview?: PortfolioAutofillDraft | null;
    total_tokens?: number | null;
    error?: string;
  } | null>(null);

  const configQuery = useQuery({
    queryKey: ['ai', 'config'],
    queryFn: erpApi.ai.getConfig,
    enabled: canView,
  });

  const logsQuery = useQuery({
    queryKey: ['ai', 'logs', logFilter],
    queryFn: () => erpApi.ai.logs({ feature: logFilter, limit: 50 }),
    enabled: canView,
  });

  useEffect(() => {
    if (!configQuery.data) return;
    if (configQuery.data.configs.consult) {
      setConsultForm(configToFormState(configQuery.data.configs.consult));
    }
    if (configQuery.data.configs.portfolio_autofill) {
      setAutofillForm(configToFormState(configQuery.data.configs.portfolio_autofill));
    }
  }, [configQuery.data]);

  const updateMut = useMutation({
    mutationFn: erpApi.ai.updateConfig,
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['ai', 'config'] });
      if (res.config.feature_key === 'consult') {
        setConsultForm(configToFormState(res.config));
      } else {
        setAutofillForm(configToFormState(res.config));
      }
      setSaveNotice({
        kind: 'success',
        text:
          res.config.feature_key === 'consult'
            ? 'Konfigurasi AI Konsultasi ekalliptus.com berhasil disimpan.'
            : 'Konfigurasi Auto-Fill AI Portofolio berhasil disimpan.',
      });
    },
    onError: (err) => {
      setSaveNotice({ kind: 'error', text: (err as Error).message });
    },
  });

  const testMut = useMutation({
    mutationFn: erpApi.ai.test,
    onSuccess: async (res, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['ai', 'logs'] });
      setTestResult({
        feature: vars.feature_key,
        ok: res.ok,
        latency_ms: res.latency_ms,
        provider: res.provider,
        model: res.model,
        reply: res.reply,
        parsed_preview: res.parsed_preview,
        total_tokens: res.usage?.total_tokens ?? null,
        error: res.error,
      });
    },
    onError: async (err, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['ai', 'logs'] });
      setTestResult({
        feature: vars.feature_key,
        ok: false,
        latency_ms: 0,
        provider: '',
        model: '',
        error: (err as Error).message,
      });
    },
  });

  if (!canView) {
    return (
      <EmptyState
        title="Akses AI Management Dibatasi"
        description="Akun Anda belum memiliki izin ai:view untuk mengelola provider, API key, dan prompt AI."
      />
    );
  }

  if (configQuery.isLoading || !consultForm || !autofillForm) {
    return <ModulePageSkeleton variant="ai" label="Memuat konfigurasi AI Management..." />;
  }

  if (configQuery.isError || !configQuery.data) {
    return (
      <ErrorState
        message={
          configQuery.error instanceof Error
            ? configQuery.error.message
            : 'Gagal memuat konfigurasi AI Management.'
        }
        onRetry={() => void configQuery.refetch()}
      />
    );
  }

  const presets = configQuery.data.presets;
  const consultSaved = configQuery.data.configs.consult;
  const autofillSaved = configQuery.data.configs.portfolio_autofill;

  const isConsultTab = activeTab === 'consult';
  const currentForm = isConsultTab ? consultForm : autofillForm;
  const setCurrentForm = isConsultTab ? setConsultForm : setAutofillForm;
  const savedRow = isConsultTab ? consultSaved : autofillSaved;
  const currentFeatureKey: AiFeatureKey = isConsultTab ? 'consult' : 'portfolio_autofill';
  const currentPreset: AiProviderPresetView | undefined = presets[currentForm.provider];
  const inheritsConsultKey = currentFeatureKey === 'portfolio_autofill' && currentForm.useSharedKey;

  function patchCurrent(patch: Partial<FeatureFormState>) {
    setSaveNotice(null);
    setCurrentForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function handleProviderChange(nextProvider: AiProvider) {
    const nextPreset = presets[nextProvider];
    const currentPresetDefaults = new Set(
      Object.values(presets)
        .map((p) => p.defaultModel)
        .filter(Boolean),
    );
    const shouldSwapModel =
      !currentForm.model.trim() || currentPresetDefaults.has(currentForm.model.trim());

    patchCurrent({
      provider: nextProvider,
      model:
        nextProvider === 'custom'
          ? currentForm.model
          : shouldSwapModel
            ? nextPreset.defaultModel
            : currentForm.model,
    });
  }

  function handleSaveConfig(e: FormEvent) {
    e.preventDefault();
    if (!canUpdate) return;
    setSaveNotice(null);

    const temp = Number.parseFloat(currentForm.temperature);
    const maxTok = Number.parseInt(currentForm.maxTokens, 10);

    updateMut.mutate({
      feature_key: currentFeatureKey,
      is_enabled: currentForm.isEnabled,
      provider: currentForm.provider,
      custom_endpoint: currentForm.provider === 'custom' ? currentForm.customEndpoint.trim() : null,
      model: currentForm.model.trim(),
      api_key:
        currentForm.clearApiKey || !currentForm.apiKeyInput.trim()
          ? undefined
          : currentForm.apiKeyInput.trim(),
      clear_api_key: currentForm.clearApiKey,
      use_shared_key: currentFeatureKey === 'portfolio_autofill' ? currentForm.useSharedKey : false,
      system_prompt: currentForm.systemPrompt.trim(),
      temperature: Number.isFinite(temp) ? Math.min(Math.max(temp, 0), 2) : 0.7,
      max_tokens: Number.isFinite(maxTok) ? Math.min(Math.max(maxTok, 64), 4096) : 512,
      ...(currentFeatureKey === 'consult'
        ? {
            assistant_name: currentForm.assistantName.trim() || 'eBot',
            greeting_message: currentForm.greetingMessage.trim(),
            handoff_phrases: splitLines(currentForm.handoffPhrasesText),
            fallback_messages: splitLines(currentForm.fallbackMessagesText),
          }
        : {}),
      extra_instructions: currentForm.extraInstructions.trim(),
    });
  }

  function handleTabKeyDown(e: React.KeyboardEvent, idx: number) {
    const order: ActiveTab[] = ['consult', 'portfolio_autofill', 'logs'];
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActiveTab(order[(idx + 1) % order.length]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActiveTab(order[(idx - 1 + order.length) % order.length]);
    }
  }

  return (
    <div className="space-y-6">
      {/* Masthead */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-bold text-text-primary">
            AI Management &amp; Kontrol Asisten
          </h2>
          <p className="text-xs text-text-secondary">
            Pusat pengaturan provider, API key terenkripsi, model, serta prompt untuk widget AI
            Konsultasi <span className="font-mono font-semibold text-text-primary">ekalliptus.com</span>{' '}
            dan Auto-Fill form Portofolio.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            tone={consultSaved?.is_enabled && consultSaved?.has_api_key ? 'success' : 'warning'}
            label={
              consultSaved?.is_enabled
                ? consultSaved?.has_api_key
                  ? `Konsultasi Web: Aktif (${consultSaved.provider})`
                  : 'Konsultasi Web: Key Belum Diisi'
                : 'Konsultasi Web: Nonaktif (WhatsApp Saja)'
            }
          />
          <StatusBadge
            tone={
              autofillSaved?.is_enabled &&
              (autofillSaved?.has_api_key ||
                (autofillSaved?.use_shared_key && consultSaved?.has_api_key))
                ? 'success'
                : 'neutral'
            }
            label={
              autofillSaved?.is_enabled
                ? 'Auto-Fill Portofolio: Aktif'
                : 'Auto-Fill Portofolio: Nonaktif'
            }
          />
        </div>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Bagian AI Management"
        className="flex flex-wrap gap-2 border-b border-border pb-3"
      >
        {(
          [
            {
              id: 'consult',
              label: 'AI Konsultasi Web (ekalliptus.com)',
              icon: MessageSquare,
            },
            {
              id: 'portfolio_autofill',
              label: 'Auto-Fill Portofolio (ERP)',
              icon: SlidersHorizontal,
            },
            {
              id: 'logs',
              label: 'Riwayat & Kesehatan AI',
              icon: Activity,
            },
          ] as const
        ).map((tab, idx) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              onClick={() => {
                setActiveTab(tab.id);
                setSaveNotice(null);
              }}
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
              className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                selected
                  ? 'border-accent bg-accent-soft text-[#115E59] dark:text-[#34D399]'
                  : 'border-border bg-surface text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {saveNotice ? (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-xs font-medium ${
            saveNotice.kind === 'success'
              ? 'border-[#86EFAC] bg-[#F0FDF4] text-[#166534] dark:border-[#166534] dark:bg-[#052E16] dark:text-[#86EFAC]'
              : 'border-[#FCA5A5] bg-danger-soft text-[#991B1B] dark:border-[#991B1B] dark:text-[#FCA5A5]'
          }`}
        >
          <span className="flex items-center gap-2">
            {saveNotice.kind === 'success' ? (
              <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>{saveNotice.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setSaveNotice(null)}
            className="min-h-[36px] cursor-pointer rounded px-2 font-semibold underline"
          >
            Tutup
          </button>
        </div>
      ) : null}

      {activeTab !== 'logs' ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          {/* Config Form */}
          <form
            onSubmit={handleSaveConfig}
            className="space-y-5 rounded-xl border border-border bg-surface p-5 xl:col-span-7"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
              <div className="space-y-1">
                <h3 className="font-display text-sm font-bold text-text-primary">
                  {isConsultTab
                    ? 'Pengaturan Widget AI Konsultasi Publik'
                    : 'Pengaturan Auto-Generate Filled Form Portofolio'}
                </h3>
                <p className="text-xs text-text-secondary">
                  {isConsultTab
                    ? 'Mengontrol API, model, prompt, dan tombol aktif/nonaktif untuk widget konsultasi di ekalliptus.com.'
                    : 'Dipakai tombol Auto-Generate Isian Form saat Anda mengunggah atau mengedit project di menu Portofolio Web.'}
                </p>
              </div>

              <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-md border border-border-strong bg-canvas px-3 py-2 text-xs font-semibold text-text-primary">
                <input
                  type="checkbox"
                  checked={currentForm.isEnabled}
                  disabled={!canUpdate}
                  onChange={(e) => patchCurrent({ isEnabled: e.target.checked })}
                  className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed"
                />
                <span>{currentForm.isEnabled ? 'Fitur Aktif' : 'Fitur Nonaktif'}</span>
              </label>
            </div>

            {isConsultTab && !currentForm.isEnabled ? (
              <div className="rounded-lg border border-border bg-surface-subtle p-3 text-xs text-text-secondary">
                Saat dimatikan, dialog konsultasi di <span className="font-mono">ekalliptus.com</span>{' '}
                otomatis hanya menampilkan tab Form WhatsApp tanpa memanggil API AI.
              </div>
            ) : null}

            {!isConsultTab ? (
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface-subtle/60 px-3.5 py-2.5 text-xs font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={currentForm.useSharedKey}
                  disabled={!canUpdate}
                  onChange={(e) => patchCurrent({ useSharedKey: e.target.checked })}
                  className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed"
                />
                <span>
                  Gunakan Provider, Endpoint &amp; API Key yang sama dengan AI Konsultasi
                  {consultSaved?.has_api_key
                    ? ` (${presets[consultSaved.provider]?.label ?? consultSaved.provider}: ${consultSaved.api_key_masked})`
                    : ' (API key Konsultasi belum diisi)'}
                </span>
              </label>
            ) : null}

            {!inheritsConsultKey ? (
              <div className="space-y-4 rounded-lg border border-border bg-canvas/50 p-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-provider`}
                      className="block text-xs font-semibold text-text-primary"
                    >
                      Provider AI
                    </label>
                    <select
                      id={`${baseId}-provider`}
                      value={currentForm.provider}
                      disabled={!canUpdate}
                      onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                      className="h-11 w-full cursor-pointer rounded-md border border-border bg-surface px-3 text-xs text-text-primary focus:border-accent focus:outline-none disabled:cursor-not-allowed"
                    >
                      {AI_PROVIDERS.map((p) => (
                        <option key={p} value={p}>
                          {presets[p]?.label ?? p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-apikey`}
                      className="block text-xs font-semibold text-text-primary"
                    >
                      API Key {savedRow?.has_api_key ? '(Tersimpan Terenkripsi)' : '(Belum Diisi)'}
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <KeyRound
                          className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-secondary"
                          aria-hidden="true"
                        />
                        <input
                          id={`${baseId}-apikey`}
                          type={showKey ? 'text' : 'password'}
                          autoComplete="off"
                          disabled={!canUpdate || currentForm.clearApiKey}
                          value={currentForm.apiKeyInput}
                          onChange={(e) =>
                            patchCurrent({ apiKeyInput: e.target.value, clearApiKey: false })
                          }
                          placeholder={
                            currentForm.clearApiKey
                              ? 'Akan dihapus saat disimpan'
                              : savedRow?.api_key_masked
                                ? `Tersimpan (${savedRow.api_key_masked})`
                                : 'Tempel API key provider...'
                          }
                          className="h-11 w-full rounded-md border border-border bg-surface pr-10 pl-9 font-mono text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey((prev) => !prev)}
                          aria-label={showKey ? 'Sembunyikan API key' : 'Tampilkan API key'}
                          className="absolute top-1/2 right-1 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-text-secondary hover:text-text-primary"
                        >
                          {showKey ? (
                            <EyeOff className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>

                      {savedRow?.has_api_key && canUpdate ? (
                        <button
                          type="button"
                          onClick={() =>
                            patchCurrent({
                              clearApiKey: !currentForm.clearApiKey,
                              apiKeyInput: '',
                            })
                          }
                          aria-label="Hapus API key tersimpan"
                          className={`inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md border px-2.5 text-xs font-semibold ${
                            currentForm.clearApiKey
                              ? 'border-[#FCA5A5] bg-danger-soft text-[#991B1B] dark:text-[#FCA5A5]'
                              : 'border-border bg-surface text-text-secondary hover:text-[#991B1B]'
                          }`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                {currentForm.provider === 'custom' ? (
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`${baseId}-endpoint`}
                      className="block text-xs font-semibold text-text-primary"
                    >
                      Endpoint Chat Completions (HTTPS)
                    </label>
                    <input
                      id={`${baseId}-endpoint`}
                      type="url"
                      required
                      disabled={!canUpdate}
                      value={currentForm.customEndpoint}
                      onChange={(e) => patchCurrent({ customEndpoint: e.target.value })}
                      placeholder="https://router.ekalliptus.com/v1 atau .../v1/chat/completions"
                      className="h-11 w-full rounded-md border border-border bg-surface px-3 font-mono text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
                    />
                    <p className="text-[11px] text-text-secondary">
                      Base URL OpenAI-compatible seperti{' '}
                      <span className="font-mono">/v1</span> otomatis diarahkan ke{' '}
                      <span className="font-mono">/chat/completions</span>.
                    </p>
                  </div>
                ) : (
                  <p className="text-[11px] text-text-secondary">
                    Endpoint: <span className="font-mono">{currentPreset?.endpoint}</span>
                  </p>
                )}
              </div>
            ) : null}

            {/* Model + Hyperparams */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-1">
                  <label
                    htmlFor={`${baseId}-model`}
                    className="block text-xs font-semibold text-text-primary"
                  >
                    Model ID {inheritsConsultKey ? '(Opsional, ikuti Konsultasi)' : '*'}
                  </label>
                  <input
                    id={`${baseId}-model`}
                    type="text"
                    required={!inheritsConsultKey}
                    disabled={!canUpdate}
                    value={currentForm.model}
                    onChange={(e) => patchCurrent({ model: e.target.value })}
                    placeholder={
                      inheritsConsultKey && consultForm?.model
                        ? `Default: ${consultForm.model}`
                        : 'glm-4.5-air'
                    }
                    className="h-11 w-full rounded-md border border-border bg-canvas px-3 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor={`${baseId}-temp`}
                    className="block text-xs font-semibold text-text-primary"
                  >
                    Temperature (0 - 2)
                  </label>
                  <input
                    id={`${baseId}-temp`}
                    type="number"
                    step="0.1"
                    min={0}
                    max={2}
                    disabled={!canUpdate}
                    value={currentForm.temperature}
                    onChange={(e) => patchCurrent({ temperature: e.target.value })}
                    className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor={`${baseId}-tokens`}
                    className="block text-xs font-semibold text-text-primary"
                  >
                    Max Tokens (64 - 4096)
                  </label>
                  <input
                    id={`${baseId}-tokens`}
                    type="number"
                    min={64}
                    max={4096}
                    disabled={!canUpdate}
                    value={currentForm.maxTokens}
                    onChange={(e) => patchCurrent({ maxTokens: e.target.value })}
                    className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              {(() => {
                const effectiveProvider = inheritsConsultKey
                  ? consultForm.provider
                  : currentForm.provider;
                const chips = presets[effectiveProvider]?.suggestedModels ?? [];
                if (chips.length === 0) return null;
                return (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-text-secondary">
                      Rekomendasi model ({presets[effectiveProvider]?.label}):
                    </span>
                    {chips.map((modelName) => (
                      <button
                        key={modelName}
                        type="button"
                        disabled={!canUpdate}
                        onClick={() => patchCurrent({ model: modelName })}
                        className={`min-h-[32px] cursor-pointer rounded border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                          currentForm.model.trim() === modelName
                            ? 'border-accent bg-accent-soft font-semibold text-[#115E59] dark:text-[#34D399]'
                            : 'border-border bg-surface-subtle text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {modelName}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>

            {isConsultTab ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor={`${baseId}-assistant-name`}
                    className="block text-xs font-semibold text-text-primary"
                  >
                    Nama Asisten di Widget Web
                  </label>
                  <input
                    id={`${baseId}-assistant-name`}
                    type="text"
                    maxLength={60}
                    disabled={!canUpdate}
                    value={currentForm.assistantName}
                    onChange={(e) => patchCurrent({ assistantName: e.target.value })}
                    placeholder="eBot"
                    className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <label
                    htmlFor={`${baseId}-greeting`}
                    className="block text-xs font-semibold text-text-primary"
                  >
                    Sapaan Awal Widget AI (`ekalliptus.com`)
                  </label>
                  <textarea
                    id={`${baseId}-greeting`}
                    rows={2}
                    maxLength={1000}
                    disabled={!canUpdate}
                    value={currentForm.greetingMessage}
                    onChange={(e) => patchCurrent({ greetingMessage: e.target.value })}
                    className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label
                htmlFor={`${baseId}-sysprompt`}
                className="block text-xs font-semibold text-text-primary"
              >
                System Prompt
              </label>
              <textarea
                id={`${baseId}-sysprompt`}
                rows={4}
                maxLength={8000}
                disabled={!canUpdate}
                value={currentForm.systemPrompt}
                onChange={(e) => patchCurrent({ systemPrompt: e.target.value })}
                className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-xs leading-relaxed text-text-primary focus:border-accent focus:outline-none"
              />
            </div>

            {isConsultTab ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor={`${baseId}-handoff`}
                    className="block text-xs font-semibold text-text-primary"
                  >
                    Frasa Handoff ke WhatsApp Admin (1 per baris)
                  </label>
                  <textarea
                    id={`${baseId}-handoff`}
                    rows={4}
                    disabled={!canUpdate}
                    value={currentForm.handoffPhrasesText}
                    onChange={(e) => patchCurrent({ handoffPhrasesText: e.target.value })}
                    className="w-full rounded-md border border-border bg-canvas px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor={`${baseId}-fallbacks`}
                    className="block text-xs font-semibold text-text-primary"
                  >
                    Pesan Fallback Saat AI Gangguan (1 per baris)
                  </label>
                  <textarea
                    id={`${baseId}-fallbacks`}
                    rows={4}
                    disabled={!canUpdate}
                    value={currentForm.fallbackMessagesText}
                    onChange={(e) => patchCurrent({ fallbackMessagesText: e.target.value })}
                    className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label
                  htmlFor={`${baseId}-extrainstr`}
                  className="block text-xs font-semibold text-text-primary"
                >
                  Instruksi Tambahan Gaya Penulisan (Opsional)
                </label>
                <textarea
                  id={`${baseId}-extrainstr`}
                  rows={2}
                  maxLength={2000}
                  disabled={!canUpdate}
                  value={currentForm.extraInstructions}
                  onChange={(e) => patchCurrent({ extraInstructions: e.target.value })}
                  placeholder="Contoh: Utamakan paket siap deploy 3-5 hari kerja untuk UMKM retail."
                  className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-[11px] text-text-secondary">
                Pembaruan terakhir: {savedRow ? formatDateTimeId(savedRow.updated_at) : '-'}
              </p>

              {canUpdate ? (
                <button
                  type="submit"
                  disabled={updateMut.isPending}
                  className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md bg-accent px-5 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  <span>{updateMut.isPending ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
                </button>
              ) : null}
            </div>
          </form>

          {/* Test Sandbox */}
          <div className="space-y-4 rounded-xl border border-border bg-surface p-5 xl:col-span-5">
            <div className="space-y-1 border-b border-border pb-3">
              <h3 className="flex items-center gap-2 font-display text-sm font-bold text-text-primary">
                <Cpu className="h-4 w-4 text-accent" aria-hidden="true" />
                <span>
                  {isConsultTab ? 'Uji Koneksi & Balasan AI Konsultasi' : 'Uji Generate Portofolio'}
                </span>
              </h3>
              <p className="text-xs text-text-secondary">
                Simpan perubahan di sebelah kiri terlebih dahulu sebelum menguji agar backend memakai
                konfigurasi terbaru.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={`${baseId}-test-prompt`}
                className="block text-xs font-semibold text-text-primary"
              >
                {isConsultTab ? 'Contoh Pesan Pengunjung' : 'Contoh Catatan Singkat Project'}
              </label>
              <textarea
                id={`${baseId}-test-prompt`}
                rows={4}
                value={isConsultTab ? consultTestPrompt : autofillTestPrompt}
                onChange={(e) =>
                  isConsultTab
                    ? setConsultTestPrompt(e.target.value)
                    : setAutofillTestPrompt(e.target.value)
                }
                className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>

            <button
              type="button"
              disabled={!canUpdate || testMut.isPending}
              onClick={() =>
                testMut.mutate({
                  feature_key: currentFeatureKey,
                  prompt: (isConsultTab ? consultTestPrompt : autofillTestPrompt).trim(),
                })
              }
              className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-border-strong bg-surface-subtle px-4 text-xs font-semibold text-text-primary hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-4 w-4 text-accent" aria-hidden="true" />
              <span>{testMut.isPending ? 'Menghubungi Provider...' : 'Jalankan Uji Coba'}</span>
            </button>

            {testResult && testResult.feature === currentFeatureKey ? (
              <div className="space-y-3 rounded-lg border border-border bg-canvas p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge
                    tone={testResult.ok ? 'success' : 'danger'}
                    label={testResult.ok ? 'Koneksi Berhasil' : 'Gagal'}
                  />
                  <span className="font-mono text-[11px] text-text-secondary">
                    {testResult.latency_ms} ms
                    {testResult.total_tokens !== null && testResult.total_tokens !== undefined
                      ? ` | ${testResult.total_tokens} token`
                      : ''}
                  </span>
                </div>

                {testResult.error ? (
                  <p className="text-xs leading-relaxed text-[#991B1B] dark:text-[#FCA5A5]">
                    {testResult.error}
                  </p>
                ) : null}

                {testResult.parsed_preview ? (
                  <div className="space-y-1.5 text-xs">
                    <p className="font-semibold text-text-primary">
                      {testResult.parsed_preview.title}
                    </p>
                    <p className="text-text-secondary">{testResult.parsed_preview.tagline}</p>
                    <p className="font-mono text-[11px] text-text-secondary">
                      Kategori: {testResult.parsed_preview.category} | Harga:{' '}
                      {testResult.parsed_preview.price_type}{' '}
                      {testResult.parsed_preview.price_amount ?? ''}
                    </p>
                  </div>
                ) : testResult.reply ? (
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-primary">
                    {testResult.reply}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        /* Tab 3: Logs & Health */
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-[11px] font-medium text-text-secondary">Total Request (7h)</p>
              <p className="mt-1 font-display text-2xl font-bold text-text-primary">
                {logsQuery.data?.summary_7d.total ?? 0}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-[11px] font-medium text-text-secondary">Sukses / Handoff</p>
              <p className="mt-1 font-display text-2xl font-bold text-[#15803D] dark:text-[#22C55E]">
                {logsQuery.data?.summary_7d.success ?? 0}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-[11px] font-medium text-text-secondary">Gagal / Fallback</p>
              <p className="mt-1 font-display text-2xl font-bold text-[#991B1B] dark:text-[#FCA5A5]">
                {logsQuery.data?.summary_7d.failed ?? 0}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-[11px] font-medium text-text-secondary">Rata-rata Latensi</p>
              <p className="mt-1 font-display text-2xl font-bold text-text-primary">
                {logsQuery.data?.summary_7d.avg_latency_ms ?? 0} ms
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-[11px] font-medium text-text-secondary">Total Token (7h)</p>
              <p className="mt-1 font-display text-2xl font-bold text-text-primary">
                {logsQuery.data?.summary_7d.total_tokens ?? 0}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'all', label: 'Semua Fitur' },
                  { id: 'consult', label: 'AI Konsultasi' },
                  { id: 'portfolio_autofill', label: 'Auto-Fill Portofolio' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setLogFilter(f.id)}
                  className={`min-h-[40px] cursor-pointer rounded-md border px-3 text-xs font-semibold ${
                    logFilter === f.id
                      ? 'border-accent bg-accent-soft text-[#115E59] dark:text-[#34D399]'
                      : 'border-border bg-canvas text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void logsQuery.refetch()}
              className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Muat Ulang</span>
            </button>
          </div>

          {logsQuery.isLoading ? (
            <ModulePageSkeleton variant="ai" label="Memuat riwayat pemakaian AI..." />
          ) : logsQuery.isError ? (
            <ErrorState
              message={(logsQuery.error as Error).message}
              onRetry={() => void logsQuery.refetch()}
            />
          ) : (logsQuery.data?.logs.length ?? 0) === 0 ? (
            <EmptyState
              title="Belum Ada Riwayat Pemakaian AI"
              description="Jalankan Uji Coba di tab AI Konsultasi / Auto-Fill Portofolio atau gunakan fitur Auto-Generate di form Portofolio untuk mulai merekam metrik nyata."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-subtle text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Fitur</th>
                    <th className="px-3 py-2.5">Provider / Model</th>
                    <th className="px-3 py-2.5">Latensi &amp; Token</th>
                    <th className="px-3 py-2.5">Sumber</th>
                    <th className="px-3 py-2.5">Waktu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logsQuery.data?.logs.map((row) => {
                    const meta = LOG_STATUS_META[row.status] ?? {
                      label: row.status,
                      tone: 'neutral' as BadgeTone,
                    };
                    return (
                      <tr key={row.id} className="hover:bg-surface-subtle/50">
                        <td className="px-3 py-2.5">
                          <StatusBadge tone={meta.tone} label={meta.label} />
                          {row.error_message ? (
                            <p className="mt-1 max-w-[220px] truncate text-[11px] text-[#991B1B] dark:text-[#FCA5A5]">
                              {row.error_message}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-text-primary">
                          {row.feature_key === 'consult' ? 'AI Konsultasi' : 'Auto-Fill Portofolio'}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-text-secondary">
                          {row.provider} / {row.model}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-text-primary">
                          {row.latency_ms} ms
                          {row.total_tokens !== null ? ` (${row.total_tokens} tok)` : ''}
                        </td>
                        <td className="px-3 py-2.5 text-text-secondary">{row.source}</td>
                        <td className="px-3 py-2.5 text-text-secondary">
                          {formatDateTimeId(row.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
