import {
  hasPermission,
  PORTFOLIO_AVAILABILITY_STATUSES,
  PORTFOLIO_CATEGORIES,
  PORTFOLIO_OFFER_TYPES,
  PORTFOLIO_PRICE_TYPES,
  type PortfolioAvailabilityStatus,
  type PortfolioCategory,
  type PortfolioOfferType,
  type PortfolioPriceType,
} from '@ekalliptus/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  ImagePlus,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { ModulePageSkeleton } from '../components/Skeleton.tsx';
import { SlideOver } from '../components/SlideOver.tsx';
import { EmptyState, ErrorState } from '../components/StateViews.tsx';
import { StatusBadge, type BadgeTone } from '../components/StatusBadge.tsx';
import {
  erpApi,
  uploadFileViaPresign,
  type CreatePortfolioPayload,
  type MeResponse,
  type PortfolioProjectRow,
} from '../lib/api.ts';
import { formatDateTimeId, formatRupiah } from '../lib/format.ts';

const CATEGORY_LABELS: Record<PortfolioCategory, string> = {
  website: 'Website',
  mobile_app: 'Mobile App',
  web_mobile: 'Website & Mobile',
  erp_system: 'Sistem ERP',
  ui_ux: 'Desain UI/UX',
  automation: 'Otomasi & Bot',
  other: 'Solusi Lainnya',
};

const OFFER_LABELS: Record<PortfolioOfferType, string> = {
  hybrid: 'Hybrid (Siap Beli + Custom)',
  ready_to_buy: 'Produk Siap Pakai',
  custom_similar: 'Pesan Versi Custom',
};

const AVAILABILITY_META: Record<PortfolioAvailabilityStatus, { label: string; tone: BadgeTone }> = {
  available: { label: 'Siap Pakai', tone: 'success' },
  custom_only: { label: 'Khusus Custom', tone: 'info' },
  sold: { label: 'Terjual', tone: 'warning' },
};

const PRICE_TYPE_LABELS: Record<PortfolioPriceType, string> = {
  fixed: 'Harga Pasti',
  starting_from: 'Mulai Dari',
  negotiable: 'Diskusi Harga',
};

function toSlugPreview(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function formatPortfolioPricePreview(
  priceType: PortfolioPriceType,
  priceDigits: string,
): string {
  const numeric = priceDigits.replace(/\D/g, '');
  if (priceType === 'negotiable' || !numeric) return 'Diskusi Harga';
  const formatted = formatRupiah(numeric);
  return priceType === 'starting_from' ? `Mulai ${formatted}` : formatted;
}

export function PortfolioPage({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const baseId = useId();

  const canView = hasPermission(me.permissions, 'portfolio', 'view');
  const canCreate = hasPermission(me.permissions, 'portfolio', 'create');
  const canUpdate = hasPermission(me.permissions, 'portfolio', 'update');
  const canDelete = hasPermission(me.permissions, 'portfolio', 'delete');

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | PortfolioCategory>('all');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<PortfolioProjectRow | null>(null);
  const [slugLockedManual, setSlugLockedManual] = useState(false);

  // Form states
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [tagline, setTagline] = useState('');
  const [summary, setSummary] = useState('');
  const [category, setCategory] = useState<PortfolioCategory>('website');
  const [offerType, setOfferType] = useState<PortfolioOfferType>('hybrid');
  const [availabilityStatus, setAvailabilityStatus] =
    useState<PortfolioAvailabilityStatus>('available');
  const [priceType, setPriceType] = useState<PortfolioPriceType>('fixed');
  const [priceAmount, setPriceAmount] = useState('');
  const [originalPriceAmount, setOriginalPriceAmount] = useState('');
  const [clientName, setClientName] = useState('');
  const [deliveryEstimate, setDeliveryEstimate] = useState('');
  const [demoUrl, setDemoUrl] = useState('');
  const [coverImageKey, setCoverImageKey] = useState<string | null>(null);
  const [coverPreviewSrc, setCoverPreviewSrc] = useState<string | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [galleryKeys, setGalleryKeys] = useState<string[]>([]);
  const [galleryPreviewSrcs, setGalleryPreviewSrcs] = useState<string[]>([]);
  const [galleryUrlsText, setGalleryUrlsText] = useState('');
  const [techStackText, setTechStackText] = useState('');
  const [highlightsText, setHighlightsText] = useState('');
  const [whatsappPrefill, setWhatsappPrefill] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);
  const [isPublished, setIsPublished] = useState(true);
  const [sortOrder, setSortOrder] = useState('0');
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const portfolioQuery = useQuery({
    queryKey: ['portfolio', 'list'],
    queryFn: () => erpApi.portfolio.list(),
    enabled: canView,
  });

  useEffect(() => {
    return () => {
      if (coverPreviewSrc?.startsWith('blob:')) URL.revokeObjectURL(coverPreviewSrc);
      for (const u of galleryPreviewSrcs) {
        if (u.startsWith('blob:')) URL.revokeObjectURL(u);
      }
    };
  }, [coverPreviewSrc, galleryPreviewSrcs]);

  const invalidatePortfolio = async () => {
    await queryClient.invalidateQueries({ queryKey: ['portfolio'] });
  };

  const resetForm = () => {
    setEditing(null);
    setSlugLockedManual(false);
    setTitle('');
    setSlug('');
    setTagline('');
    setSummary('');
    setCategory('website');
    setOfferType('hybrid');
    setAvailabilityStatus('available');
    setPriceType('fixed');
    setPriceAmount('');
    setOriginalPriceAmount('');
    setClientName('');
    setDeliveryEstimate('');
    setDemoUrl('');
    setCoverImageKey(null);
    setCoverPreviewSrc(null);
    setCoverImageUrl('');
    setGalleryKeys([]);
    setGalleryPreviewSrcs([]);
    setGalleryUrlsText('');
    setTechStackText('');
    setHighlightsText('');
    setWhatsappPrefill('');
    setIsFeatured(false);
    setIsPublished(true);
    setSortOrder('0');
    setFormError(null);
  };

  const openCreateDrawer = () => {
    resetForm();
    setDrawerOpen(true);
  };

  const openEditDrawer = (row: PortfolioProjectRow) => {
    setEditing(row);
    setSlugLockedManual(true);
    setTitle(row.title);
    setSlug(row.slug);
    setTagline(row.tagline);
    setSummary(row.summary);
    setCategory(row.category);
    setOfferType(row.offer_type);
    setAvailabilityStatus(row.availability_status);
    setPriceType(row.price_type);
    setPriceAmount(row.price_amount ?? '');
    setOriginalPriceAmount(row.original_price_amount ?? '');
    setClientName(row.client_name ?? '');
    setDeliveryEstimate(row.delivery_estimate ?? '');
    setDemoUrl(row.demo_url ?? '');
    setCoverImageKey(row.cover_image_key ?? null);
    setCoverPreviewSrc(row.cover_preview_url ?? row.cover_image_url ?? null);
    setCoverImageUrl(row.cover_image_url ?? '');
    setGalleryKeys(row.gallery_image_keys ?? []);
    const keyPreviewCount = (row.gallery_image_keys ?? []).length;
    setGalleryPreviewSrcs((row.gallery_preview_urls ?? []).slice(0, keyPreviewCount));
    setGalleryUrlsText((row.gallery_image_urls ?? []).join('\n'));
    setTechStackText((row.tech_stack ?? []).join(', '));
    setHighlightsText((row.highlights ?? []).join('\n'));
    setWhatsappPrefill(row.whatsapp_prefill ?? '');
    setIsFeatured(row.is_featured);
    setIsPublished(row.is_published);
    setSortOrder(String(row.sort_order ?? 0));
    setFormError(null);
    setDrawerOpen(true);
  };

  const createMut = useMutation({
    mutationFn: erpApi.portfolio.create,
    onSuccess: async (res) => {
      await invalidatePortfolio();
      setDrawerOpen(false);
      resetForm();
      setFeedback({
        kind: 'success',
        text: res.item.is_published
          ? `Project "${res.item.title}" berhasil disimpan & ditayangkan ke ekalliptus.com.`
          : `Project "${res.item.title}" berhasil disimpan sebagai draft.`,
      });
    },
    onError: (err) => setFormError((err as Error).message),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreatePortfolioPayload> }) =>
      erpApi.portfolio.update(id, payload),
    onSuccess: async (res) => {
      await invalidatePortfolio();
      if (drawerOpen) {
        setDrawerOpen(false);
        resetForm();
      }
      setFeedback({
        kind: 'success',
        text: `Perubahan project "${res.item.title}" tersimpan.`,
      });
    },
    onError: (err) => {
      const msg = (err as Error).message;
      if (drawerOpen) setFormError(msg);
      else setFeedback({ kind: 'error', text: msg });
    },
  });

  const deleteMut = useMutation({
    mutationFn: erpApi.portfolio.remove,
    onSuccess: async () => {
      await invalidatePortfolio();
      setConfirmDeleteId(null);
      setFeedback({ kind: 'success', text: 'Project portofolio berhasil dihapus.' });
    },
    onError: (err) => {
      setConfirmDeleteId(null);
      setFeedback({ kind: 'error', text: (err as Error).message });
    },
  });

  const items = portfolioQuery.data?.items ?? [];

  const stats = useMemo(() => {
    let published = 0;
    let draft = 0;
    let featured = 0;
    for (const item of items) {
      if (item.is_published) published += 1;
      else draft += 1;
      if (item.is_featured) featured += 1;
    }
    return { total: items.length, published, draft, featured };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter === 'published' && !item.is_published) return false;
      if (statusFilter === 'draft' && item.is_published) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (!q) return true;
      const inTitle = item.title.toLowerCase().includes(q);
      const inSlug = item.slug.toLowerCase().includes(q);
      const inTagline = item.tagline.toLowerCase().includes(q);
      const inStack = item.tech_stack.some((t) => t.toLowerCase().includes(q));
      return inTitle || inSlug || inTagline || inStack;
    });
  }, [items, searchQuery, statusFilter, categoryFilter]);

  async function handleCoverUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFormError(null);
    setUploadingCover(true);
    try {
      const key = await uploadFileViaPresign('portfolio', file);
      if (coverPreviewSrc?.startsWith('blob:')) URL.revokeObjectURL(coverPreviewSrc);
      setCoverImageKey(key);
      setCoverPreviewSrc(URL.createObjectURL(file));
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setUploadingCover(false);
    }
  }

  async function handleGalleryUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    const remaining = Math.max(0, 8 - galleryKeys.length);
    if (remaining === 0) {
      setFormError('Maksimal 8 file gambar galeri per project.');
      return;
    }

    setFormError(null);
    setUploadingGallery(true);
    try {
      const selected = files.slice(0, remaining);
      const uploadedKeys: string[] = [];
      const localUrls: string[] = [];
      for (const file of selected) {
        const key = await uploadFileViaPresign('portfolio', file);
        uploadedKeys.push(key);
        localUrls.push(URL.createObjectURL(file));
      }
      setGalleryKeys((prev) => [...prev, ...uploadedKeys]);
      setGalleryPreviewSrcs((prev) => [...prev, ...localUrls]);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setUploadingGallery(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const cleanTitle = title.trim();
    if (cleanTitle.length < 3) {
      setFormError('Judul project minimal 3 karakter.');
      return;
    }

    const cleanPriceDigits = priceAmount.replace(/\D/g, '');
    if (priceType !== 'negotiable' && (!cleanPriceDigits || BigInt(cleanPriceDigits) <= 0n)) {
      setFormError('Isi nominal harga project (lebih dari 0), atau pilih skema Diskusi Harga.');
      return;
    }

    const cleanOriginalDigits = originalPriceAmount.replace(/\D/g, '');
    const cleanSort = Number.parseInt(sortOrder, 10);

    const techStack = techStackText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 16);

    const highlights = highlightsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 16);

    const galleryUrls = galleryUrlsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);

    const cleanSlug = slug.trim() ? toSlugPreview(slug) : undefined;

    const payload: CreatePortfolioPayload = {
      title: cleanTitle,
      ...(cleanSlug ? { slug: cleanSlug } : {}),
      tagline: tagline.trim(),
      summary: summary.trim(),
      category,
      offer_type: offerType,
      availability_status: availabilityStatus,
      price_type: priceType,
      price_amount: cleanPriceDigits ? cleanPriceDigits : null,
      original_price_amount: cleanOriginalDigits ? cleanOriginalDigits : null,
      client_name: clientName.trim() || null,
      delivery_estimate: deliveryEstimate.trim() || null,
      demo_url: demoUrl.trim() || null,
      cover_image_key: coverImageKey,
      cover_image_url: coverImageUrl.trim() || null,
      gallery_image_keys: galleryKeys,
      gallery_image_urls: galleryUrls,
      tech_stack: techStack,
      highlights,
      whatsapp_prefill: whatsappPrefill.trim() || null,
      is_featured: isFeatured,
      is_published: isPublished,
      sort_order: Number.isFinite(cleanSort) ? cleanSort : 0,
    };

    if (editing) {
      updateMut.mutate({ id: editing.id, payload });
    } else {
      createMut.mutate(payload);
    }
  }

  const previewSlug = (slug.trim() ? toSlugPreview(slug) : toSlugPreview(title)) || 'slug-project';
  const previewPrice = formatPortfolioPricePreview(priceType, priceAmount);
  const waPreviewText = [
    whatsappPrefill.trim() ||
      `Halo Ekalliptus, saya tertarik dengan project "${title.trim() || 'Nama Project'}".`,
    `Kode project: ${previewSlug}`,
    `Kebutuhan: ${offerType === 'custom_similar' ? 'Pesan Versi Custom' : 'Beli Project Siap Pakai'}`,
    `Harga tertera: ${previewPrice}`,
    `Halaman: https://ekalliptus.com/id/portfolio/${previewSlug}`,
  ].join('\n');

  if (!canView) {
    return (
      <EmptyState
        title="Akses Portofolio Dibatasi"
        description="Akun Anda belum memiliki izin portfolio:view untuk mengelola katalog portofolio web."
      />
    );
  }

  if (portfolioQuery.isLoading) {
    return <ModulePageSkeleton variant="portfolio" label="Memuat katalog portofolio..." />;
  }

  if (portfolioQuery.isError) {
    return (
      <ErrorState
        message={(portfolioQuery.error as Error).message}
        onRetry={() => void portfolioQuery.refetch()}
      />
    );
  }

  const busySubmit = createMut.isPending || updateMut.isPending || uploadingCover || uploadingGallery;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-bold text-text-primary">
            Manajemen Portofolio Web
          </h2>
          <p className="text-xs text-text-secondary">
            Input project dari sini agar otomatis tersinkron ke katalog{' '}
            <span className="font-mono font-semibold text-text-primary">ekalliptus.com/portfolio</span>{' '}
            dengan tombol beli langsung ke WhatsApp.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href="https://ekalliptus.com/id/portfolio"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 py-2 text-xs font-semibold text-text-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            <span>Lihat Katalog Publik</span>
          </a>
          {canCreate ? (
            <button
              type="button"
              onClick={openCreateDrawer}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Upload Project</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback ? (
        <div
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-xs font-medium ${
            feedback.kind === 'success'
              ? 'border-[#86EFAC] bg-success-soft text-[#14532D] dark:border-[#166534] dark:text-[#86EFAC]'
              : 'border-[#FCA5A5] bg-danger-soft text-[#991B1B] dark:border-[#991B1B] dark:text-[#FCA5A5]'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="cursor-pointer rounded px-2 py-1 text-[11px] font-semibold underline"
          >
            Tutup
          </button>
        </div>
      ) : null}

      {/* Real Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-[11px] font-medium text-text-secondary">Total Project</p>
          <p className="mt-1 font-display text-2xl font-bold text-text-primary">{stats.total}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-[11px] font-medium text-text-secondary">Tayang di Web</p>
          <p className="mt-1 font-display text-2xl font-bold text-[#15803D] dark:text-[#22C55E]">
            {stats.published}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-[11px] font-medium text-text-secondary">Draft Internal</p>
          <p className="mt-1 font-display text-2xl font-bold text-text-primary">{stats.draft}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-[11px] font-medium text-text-secondary">Unggulan</p>
          <p className="mt-1 font-display text-2xl font-bold text-text-primary">{stats.featured}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-secondary"
            aria-hidden="true"
          />
          <label htmlFor={`${baseId}-search`} className="sr-only">
            Cari judul, slug, atau teknologi
          </label>
          <input
            id={`${baseId}-search`}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari judul, slug, atau teknologi..."
            className="h-11 w-full rounded-md border border-border bg-canvas pr-3 pl-9 text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${baseId}-status-filter`} className="sr-only">
            Filter status tayang
          </label>
          <select
            id={`${baseId}-status-filter`}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'published' | 'draft')}
            className="h-11 cursor-pointer rounded-md border border-border bg-canvas px-3 text-xs font-medium text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="all">Semua Status</option>
            <option value="published">Tayang di Web</option>
            <option value="draft">Draft</option>
          </select>

          <label htmlFor={`${baseId}-category-filter`} className="sr-only">
            Filter kategori project
          </label>
          <select
            id={`${baseId}-category-filter`}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | PortfolioCategory)}
            className="h-11 cursor-pointer rounded-md border border-border bg-canvas px-3 text-xs font-medium text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="all">Semua Kategori</option>
            {PORTFOLIO_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Empty States or Portfolio Cards */}
      {items.length === 0 ? (
        <EmptyState
          title="Belum Ada Project Portofolio"
          description="Unggah project pertama Anda di sini agar muncul di halaman katalog ekalliptus.com dengan tombol beli langsung ke WhatsApp."
          actionLabel={canCreate ? 'Upload Project Pertama' : undefined}
          onAction={canCreate ? openCreateDrawer : undefined}
        />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title="Tidak Ada Project yang Cocok"
          description="Tidak ditemukan project sesuai kata kunci atau filter yang aktif saat ini."
          actionLabel="Reset Filter"
          onAction={() => {
            setSearchQuery('');
            setStatusFilter('all');
            setCategoryFilter('all');
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => {
            const avail = AVAILABILITY_META[item.availability_status];
            const previewUrl = item.cover_preview_url ?? item.cover_image_url;
            const formattedPrice =
              item.price_type === 'negotiable' || !item.price_amount
                ? 'Diskusi Harga'
                : item.price_type === 'starting_from'
                  ? `Mulai ${formatRupiah(item.price_amount)}`
                  : formatRupiah(item.price_amount);

            return (
              <article
                key={item.id}
                className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface"
              >
                <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-border bg-surface-subtle">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={`Preview ${item.title}`}
                      width={640}
                      height={400}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-text-secondary">
                      <Briefcase className="h-7 w-7" aria-hidden="true" />
                      <span className="text-[11px] font-medium">Tanpa gambar cover</span>
                    </div>
                  )}

                  <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5">
                    <StatusBadge
                      tone={item.is_published ? 'success' : 'neutral'}
                      label={item.is_published ? 'Tayang' : 'Draft'}
                    />
                    {item.is_featured ? <StatusBadge tone="accent" label="Unggulan" /> : null}
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                      {CATEGORY_LABELS[item.category]}
                    </span>
                    <StatusBadge tone={avail.tone} label={avail.label} />
                  </div>

                  <div className="space-y-1">
                    <h3 className="font-display text-base font-bold text-text-primary">
                      {item.title}
                    </h3>
                    <p className="font-mono text-[11px] text-text-secondary">/{item.slug}</p>
                    {item.tagline ? (
                      <p className="line-clamp-2 text-xs leading-relaxed text-text-secondary">
                        {item.tagline}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex items-baseline justify-between gap-2 border-t border-border/70 pt-3">
                    <div>
                      <p className="text-[11px] text-text-secondary">Harga Tayang</p>
                      <p className="font-display text-sm font-bold text-text-primary">
                        {formattedPrice}
                      </p>
                    </div>
                    <p className="text-[11px] text-text-secondary">
                      Update {formatDateTimeId(item.updated_at)}
                    </p>
                  </div>

                  {item.tech_stack.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {item.tech_stack.slice(0, 4).map((tech) => (
                        <span
                          key={tech}
                          className="rounded border border-border bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-text-primary"
                        >
                          {tech}
                        </span>
                      ))}
                      {item.tech_stack.length > 4 ? (
                        <span className="rounded border border-border bg-surface-subtle px-2 py-0.5 text-[11px] text-text-secondary">
                          +{item.tech_stack.length - 4}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-auto space-y-2 border-t border-border pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {canUpdate ? (
                        <button
                          type="button"
                          disabled={updateMut.isPending}
                          onClick={() =>
                            updateMut.mutate({
                              id: item.id,
                              payload: { is_published: !item.is_published },
                            })
                          }
                          className="inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border-strong bg-surface-subtle px-3 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {item.is_published ? (
                            <>
                              <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Tarik Draft</span>
                            </>
                          ) : (
                            <>
                              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Publikasikan</span>
                            </>
                          )}
                        </button>
                      ) : null}

                      {canUpdate ? (
                        <button
                          type="button"
                          disabled={updateMut.isPending}
                          onClick={() =>
                            updateMut.mutate({
                              id: item.id,
                              payload: { is_featured: !item.is_featured },
                            })
                          }
                          aria-pressed={item.is_featured}
                          aria-label={
                            item.is_featured
                              ? `Hapus ${item.title} dari unggulan`
                              : `Jadikan ${item.title} unggulan`
                          }
                          className={`inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md border px-2.5 text-xs font-semibold ${
                            item.is_featured
                              ? 'border-accent bg-accent-soft text-[#115E59] dark:text-[#34D399]'
                              : 'border-border bg-canvas text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          <Star className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}

                      {canUpdate ? (
                        <button
                          type="button"
                          onClick={() => openEditDrawer(item)}
                          aria-label={`Edit ${item.title}`}
                          className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md border border-border-strong bg-surface px-2.5 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}

                      {item.is_published ? (
                        <a
                          href={item.public_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Buka ${item.title} di web ekalliptus.com`}
                          className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md border border-border-strong bg-surface px-2.5 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>

                    {canDelete ? (
                      confirmDeleteId === item.id ? (
                        <div className="flex items-center justify-between gap-2 rounded-md border border-[#FCA5A5] bg-danger-soft p-2 text-xs text-[#991B1B] dark:border-[#991B1B] dark:text-[#FCA5A5]">
                          <span className="font-medium">Hapus permanen project ini?</span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="min-h-[36px] cursor-pointer rounded border border-border bg-surface px-2.5 font-semibold text-text-primary"
                            >
                              Batal
                            </button>
                            <button
                              type="button"
                              disabled={deleteMut.isPending}
                              onClick={() => deleteMut.mutate(item.id)}
                              className="min-h-[36px] cursor-pointer rounded bg-danger px-2.5 font-semibold text-white disabled:opacity-50"
                            >
                              Ya, Hapus
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(item.id)}
                          className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-canvas px-3 py-1.5 text-xs font-medium text-[#991B1B] hover:border-[#FCA5A5] hover:bg-danger-soft dark:text-[#FCA5A5]"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Hapus Project</span>
                        </button>
                      )
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* SlideOver Create/Edit Form */}
      <SlideOver
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          resetForm();
        }}
        title={editing ? `Edit Project: ${editing.title}` : 'Upload Project Portofolio Baru'}
        subtitle="Simpan dan publikasikan agar otomatis tampil di web ekalliptus.com dengan CTA WhatsApp."
      >
        <form onSubmit={handleSubmit} className="space-y-4 pb-6">
          {formError ? (
            <div
              role="alert"
              className="rounded-md border border-[#FCA5A5] bg-danger-soft p-3 text-xs font-medium text-[#991B1B] dark:border-[#991B1B] dark:text-[#FCA5A5]"
            >
              {formError}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor={`${baseId}-title`} className="block text-xs font-semibold text-text-primary">
              Judul Project *
            </label>
            <input
              id={`${baseId}-title`}
              type="text"
              required
              minLength={3}
              maxLength={140}
              value={title}
              onChange={(e) => {
                const nextTitle = e.target.value;
                setTitle(nextTitle);
                if (!slugLockedManual) {
                  setSlug(toSlugPreview(nextTitle));
                }
              }}
              placeholder="Contoh: Sistem Kasir & Inventory Toko Bangunan"
              className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${baseId}-slug`} className="block text-xs font-semibold text-text-primary">
              Slug URL Publik
            </label>
            <input
              id={`${baseId}-slug`}
              type="text"
              maxLength={96}
              value={slug}
              onChange={(e) => {
                setSlugLockedManual(true);
                setSlug(e.target.value);
              }}
              placeholder="otomatis-dari-judul-project"
              className="h-11 w-full rounded-md border border-border bg-canvas px-3 font-mono text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
            />
            <p className="text-[11px] text-text-secondary">
              URL target: <span className="font-mono">https://ekalliptus.com/id/portfolio/{previewSlug}</span>
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${baseId}-tagline`} className="block text-xs font-semibold text-text-primary">
              Tagline Singkat
            </label>
            <input
              id={`${baseId}-tagline`}
              type="text"
              maxLength={220}
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Ringkasan 1 kalimat nilai utama project"
              className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`${baseId}-cat`} className="block text-xs font-semibold text-text-primary">
                Kategori
              </label>
              <select
                id={`${baseId}-cat`}
                value={category}
                onChange={(e) => setCategory(e.target.value as PortfolioCategory)}
                className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary focus:border-accent focus:outline-none"
              >
                {PORTFOLIO_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${baseId}-offer`} className="block text-xs font-semibold text-text-primary">
                Model Penjualan
              </label>
              <select
                id={`${baseId}-offer`}
                value={offerType}
                onChange={(e) => setOfferType(e.target.value as PortfolioOfferType)}
                className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary focus:border-accent focus:outline-none"
              >
                {PORTFOLIO_OFFER_TYPES.map((o) => (
                  <option key={o} value={o}>
                    {OFFER_LABELS[o]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${baseId}-avail`} className="block text-xs font-semibold text-text-primary">
                Status Ketersediaan
              </label>
              <select
                id={`${baseId}-avail`}
                value={availabilityStatus}
                onChange={(e) =>
                  setAvailabilityStatus(e.target.value as PortfolioAvailabilityStatus)
                }
                className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary focus:border-accent focus:outline-none"
              >
                {PORTFOLIO_AVAILABILITY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {AVAILABILITY_META[s].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${baseId}-pricetype`} className="block text-xs font-semibold text-text-primary">
                Skema Harga
              </label>
              <select
                id={`${baseId}-pricetype`}
                value={priceType}
                onChange={(e) => setPriceType(e.target.value as PortfolioPriceType)}
                className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary focus:border-accent focus:outline-none"
              >
                {PORTFOLIO_PRICE_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {PRICE_TYPE_LABELS[pt]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`${baseId}-price`} className="block text-xs font-semibold text-text-primary">
                Harga Tayang (IDR){priceType !== 'negotiable' ? ' *' : ''}
              </label>
              <input
                id={`${baseId}-price`}
                type="text"
                inputMode="numeric"
                value={priceAmount}
                onChange={(e) => setPriceAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="3500000"
                className="h-11 w-full rounded-md border border-border bg-canvas px-3 font-mono text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${baseId}-origprice`} className="block text-xs font-semibold text-text-primary">
                Harga Sebelum Diskon (Opsional)
              </label>
              <input
                id={`${baseId}-origprice`}
                type="text"
                inputMode="numeric"
                value={originalPriceAmount}
                onChange={(e) => setOriginalPriceAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="5000000"
                className="h-11 w-full rounded-md border border-border bg-canvas px-3 font-mono text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={`${baseId}-delivery`} className="block text-xs font-semibold text-text-primary">
                Estimasi Siap / Deploy
              </label>
              <input
                id={`${baseId}-delivery`}
                type="text"
                maxLength={80}
                value={deliveryEstimate}
                onChange={(e) => setDeliveryEstimate(e.target.value)}
                placeholder="3-5 hari kerja"
                className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${baseId}-client`} className="block text-xs font-semibold text-text-primary">
                Klien / Industri (Opsional)
              </label>
              <input
                id={`${baseId}-client`}
                type="text"
                maxLength={120}
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Retail / F&B / Logistik"
                className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${baseId}-demo`} className="block text-xs font-semibold text-text-primary">
              URL Live Demo (HTTPS)
            </label>
            <input
              id={`${baseId}-demo`}
              type="url"
              value={demoUrl}
              onChange={(e) => setDemoUrl(e.target.value)}
              placeholder="https://demo.ekalliptus.com"
              className="h-11 w-full rounded-md border border-border bg-canvas px-3 font-mono text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
            />
          </div>

          {/* Media Upload Cover */}
          <div className="space-y-2 rounded-lg border border-border bg-surface-subtle/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-text-primary">
                Gambar Cover Utama (WEBP / PNG / JPG / AVIF)
              </span>
              {coverPreviewSrc || coverImageKey ? (
                <button
                  type="button"
                  onClick={() => {
                    if (coverPreviewSrc?.startsWith('blob:')) URL.revokeObjectURL(coverPreviewSrc);
                    setCoverImageKey(null);
                    setCoverPreviewSrc(null);
                    setCoverImageUrl('');
                  }}
                  className="cursor-pointer text-[11px] font-semibold text-[#991B1B] underline dark:text-[#FCA5A5]"
                >
                  Hapus Cover
                </button>
              ) : null}
            </div>

            {coverPreviewSrc ? (
              <div className="overflow-hidden rounded-md border border-border bg-canvas">
                <img
                  src={coverPreviewSrc}
                  alt="Preview cover portofolio"
                  width={640}
                  height={400}
                  className="aspect-[16/10] w-full object-cover"
                />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor={`${baseId}-cover-file`}
                className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                <span>{uploadingCover ? 'Mengunggah cover...' : 'Upload Gambar Cover'}</span>
              </label>
              <input
                id={`${baseId}-cover-file`}
                type="file"
                accept="image/webp,image/png,image/jpeg,image/avif"
                onChange={handleCoverUpload}
                disabled={uploadingCover}
                className="sr-only"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor={`${baseId}-cover-url`} className="block text-[11px] text-text-secondary">
                Atau isi URL HTTPS eksternal (opsional)
              </label>
              <input
                id={`${baseId}-cover-url`}
                type="url"
                value={coverImageUrl}
                onChange={(e) => {
                  setCoverImageUrl(e.target.value);
                  if (!coverImageKey) {
                    setCoverPreviewSrc(e.target.value.trim() || null);
                  }
                }}
                placeholder="https://..."
                className="h-10 w-full rounded-md border border-border bg-canvas px-3 font-mono text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          {/* Media Upload Gallery */}
          <div className="space-y-2 rounded-lg border border-border bg-surface-subtle/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-text-primary">
                Galeri Screenshot Tambahan ({galleryKeys.length}/8 file)
              </span>
              {galleryKeys.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    for (const u of galleryPreviewSrcs) {
                      if (u.startsWith('blob:')) URL.revokeObjectURL(u);
                    }
                    setGalleryKeys([]);
                    setGalleryPreviewSrcs([]);
                  }}
                  className="cursor-pointer text-[11px] font-semibold text-[#991B1B] underline dark:text-[#FCA5A5]"
                >
                  Kosongkan Galeri
                </button>
              ) : null}
            </div>

            {galleryKeys.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {galleryKeys.map((key, idx) => (
                  <div
                    key={key}
                    className="group relative aspect-[16/10] overflow-hidden rounded border border-border bg-canvas"
                  >
                    {galleryPreviewSrcs[idx] ? (
                      <img
                        src={galleryPreviewSrcs[idx]}
                        alt={`Screenshot galeri ${idx + 1}`}
                        width={320}
                        height={200}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center p-1 text-center font-mono text-[10px] text-text-secondary">
                        File #{idx + 1}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        const targetUrl = galleryPreviewSrcs[idx];
                        if (targetUrl?.startsWith('blob:')) URL.revokeObjectURL(targetUrl);
                        setGalleryKeys((prev) => prev.filter((_, i) => i !== idx));
                        setGalleryPreviewSrcs((prev) => prev.filter((_, i) => i !== idx));
                      }}
                      aria-label={`Hapus gambar galeri ${idx + 1}`}
                      className="absolute top-1 right-1 cursor-pointer rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                    >
                      Hapus
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <label
              htmlFor={`${baseId}-gallery-files`}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
            >
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              <span>{uploadingGallery ? 'Mengunggah screenshot...' : 'Tambah Screenshot Galeri'}</span>
            </label>
            <input
              id={`${baseId}-gallery-files`}
              type="file"
              multiple
              accept="image/webp,image/png,image/jpeg,image/avif"
              onChange={handleGalleryUpload}
              disabled={uploadingGallery || galleryKeys.length >= 8}
              className="sr-only"
            />

            <div className="space-y-1">
              <label htmlFor={`${baseId}-gallery-urls`} className="block text-[11px] text-text-secondary">
                URL Screenshot HTTPS tambahan (1 baris = 1 URL, opsional)
              </label>
              <textarea
                id={`${baseId}-gallery-urls`}
                rows={2}
                value={galleryUrlsText}
                onChange={(e) => setGalleryUrlsText(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-md border border-border bg-canvas px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${baseId}-summary`} className="block text-xs font-semibold text-text-primary">
              Deskripsi Lengkap Project
            </label>
            <textarea
              id={`${baseId}-summary`}
              rows={4}
              maxLength={5000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Jelaskan masalah yang diselesaikan, alur utama aplikasi, dan cakupan source code / paket."
              className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${baseId}-stack`} className="block text-xs font-semibold text-text-primary">
              Tech Stack (pisahkan dengan koma)
            </label>
            <input
              id={`${baseId}-stack`}
              type="text"
              value={techStackText}
              onChange={(e) => setTechStackText(e.target.value)}
              placeholder="Astro, React, PostgreSQL, Cloudflare Workers"
              className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${baseId}-highlights`} className="block text-xs font-semibold text-text-primary">
              Fitur & Deliverables Utama (1 baris = 1 poin)
            </label>
            <textarea
              id={`${baseId}-highlights`}
              rows={4}
              value={highlightsText}
              onChange={(e) => setHighlightsText(e.target.value)}
              placeholder={'Source code lengkap siap deploy\nDashboard admin multi-role\nDokumentasi instalasi'}
              className="w-full rounded-md border border-border bg-canvas px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${baseId}-waprefill`} className="block text-xs font-semibold text-text-primary">
              Pembuka Pesan WhatsApp (Opsional)
            </label>
            <input
              id={`${baseId}-waprefill`}
              type="text"
              maxLength={300}
              value={whatsappPrefill}
              onChange={(e) => setWhatsappPrefill(e.target.value)}
              placeholder="Kosongkan untuk memakai template otomatis Ekalliptus"
              className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none"
            />
            <div className="rounded-md border border-border bg-surface-subtle p-2.5">
              <p className="text-[11px] font-semibold text-text-secondary">
                Preview Pesan WhatsApp Pembeli:
              </p>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-text-primary">
                {waPreviewText}
              </pre>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor={`${baseId}-order`} className="block text-xs font-semibold text-text-primary">
                Urutan Tampil
              </label>
              <input
                id={`${baseId}-order`}
                type="number"
                min={-999}
                max={9999}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="h-11 w-full rounded-md border border-border bg-canvas px-3 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
            </div>

            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-border bg-canvas px-3 py-2 text-xs font-semibold text-text-primary sm:mt-5">
              <input
                type="checkbox"
                checked={isFeatured}
                onChange={(e) => setIsFeatured(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-accent"
              />
              <span>Jadikan Unggulan</span>
            </label>

            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-border bg-canvas px-3 py-2 text-xs font-semibold text-text-primary sm:mt-5">
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-accent"
              />
              <span>Tayangkan di Web</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => {
                setDrawerOpen(false);
                resetForm();
              }}
              className="min-h-[44px] cursor-pointer rounded-md border border-border-strong bg-surface px-4 text-xs font-semibold text-text-primary hover:bg-surface-subtle"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={busySubmit}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md bg-accent px-5 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              <span>
                {busySubmit
                  ? 'Menyimpan...'
                  : editing
                    ? 'Simpan Perubahan'
                    : isPublished
                      ? 'Simpan & Publikasikan'
                      : 'Simpan Draft'}
              </span>
            </button>
          </div>
        </form>
      </SlideOver>
    </div>
  );
}
