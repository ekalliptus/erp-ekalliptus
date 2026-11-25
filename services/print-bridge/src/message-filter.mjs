export const MAX_PRINT_FILE_BYTES = 26_214_400; // 25 MiB

export const SUPPORTED_DOC_EXTENSIONS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.gif',
  '.tif',
  '.tiff',
  '.docx',
  '.doc',
  '.xlsx',
  '.xls',
  '.pptx',
  '.ppt',
  '.odt',
  '.ods',
  '.odp',
  '.txt',
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.csv',
  '.svg',
]);

const IGNORED_TYPES = new Set([
  'sticker',
  'ptt',
  'audio',
  'video',
  'location',
  'vcard',
  'multi_vcard',
  'call_log',
  'revoked',
  'protocol',
  'gp2',
  'ciphertext',
  'e2e_notification',
  'notification_template',
]);

const MIME_TO_EXT = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/tiff': '.tiff',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/html': '.html',
  'text/csv': '.csv',
  'image/svg+xml': '.svg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-powerpoint': '.ppt',
};

function getExtension(filename) {
  const clean = String(filename || '').trim();
  const dot = clean.lastIndexOf('.');
  if (dot === -1) return '';
  return clean.slice(dot).toLowerCase();
}

function sanitizeFilename(rawName, mimeType) {
  const base = String(rawName || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_');
  if (base && getExtension(base)) {
    return base.slice(0, 140);
  }
  const ext = MIME_TO_EXT[String(mimeType || '').toLowerCase()] || '.bin';
  const stem = base || `wa-print-${Date.now()}`;
  return `${stem.slice(0, 100)}${ext}`;
}

export function extractPhoneFromChatId(chatId) {
  const raw = String(chatId || '').split('@')[0] || '';
  return raw.replace(/[^\d+]/g, '');
}

/**
 * Option B filter for OpenWA:
 * - Accept ONLY personal direct chat (@c.us / @lid / non-group) with printable document/image <= 25MB.
 * - Silently ignore group chats, broadcast/status, fromMe, stickers, voice notes, audio, video, and plain text chats.
 */
export function classifyIncomingMessage(message) {
  if (!message || typeof message !== 'object') {
    return { action: 'ignore', reason: 'empty_message' };
  }
  if (message.fromMe) {
    return { action: 'ignore', reason: 'from_me' };
  }

  const chatId = String(message.chatId || message.from || '').trim();
  if (!chatId) {
    return { action: 'ignore', reason: 'missing_chat_id' };
  }
  if (
    message.isGroupMsg === true ||
    chatId.endsWith('@g.us') ||
    chatId === 'status@broadcast' ||
    chatId.endsWith('@broadcast') ||
    chatId.endsWith('@newsletter')
  ) {
    return { action: 'ignore', reason: 'group_or_broadcast' };
  }

  const msgType = String(message.type || '').trim().toLowerCase();
  if (message.isSticker === true || IGNORED_TYPES.has(msgType)) {
    return { action: 'ignore', reason: `ignored_type:${msgType || 'sticker'}` };
  }

  const hasMedia = Boolean(message.hasMedia || message.mimetype || message.isMedia);
  if (!hasMedia) {
    return { action: 'ignore', reason: 'text_only' };
  }

  const mimeType = String(message.mimetype || '').split(';')[0].trim().toLowerCase();
  const filename = sanitizeFilename(message.filename || message.title, mimeType);
  const ext = getExtension(filename);

  const isSupportedMime =
    mimeType === 'application/pdf' ||
    mimeType.startsWith('image/') ||
    mimeType.startsWith('text/') ||
    Boolean(MIME_TO_EXT[mimeType]);
  const isSupportedExt = SUPPORTED_DOC_EXTENSIONS.has(ext);

  if (!isSupportedExt && !isSupportedMime) {
    return { action: 'ignore', reason: 'unsupported_file_type' };
  }

  const sizeBytes = Number(message.size ?? message.fileSize ?? 0);
  if (Number.isFinite(sizeBytes) && sizeBytes > MAX_PRINT_FILE_BYTES) {
    return {
      action: 'reject_size',
      reason: 'file_too_large',
      chatId,
      waMessageId: String(message.id || ''),
      filename,
      sizeBytes,
    };
  }

  const senderObj = message.sender && typeof message.sender === 'object' ? message.sender : {};
  const customerName = String(
    senderObj.pushname || senderObj.verifiedName || senderObj.name || message.notifyName || '',
  ).trim();
  const customerPhone = extractPhoneFromChatId(message.author || message.from || chatId);
  const waMessageId = String(message.id || '').trim() || `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const caption = String(message.caption || '').trim();

  return {
    action: 'ingest',
    chatId,
    waMessageId,
    filename,
    mimeType: mimeType || (ext === '.pdf' ? 'application/pdf' : 'application/octet-stream'),
    sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
    customerName: customerName || null,
    customerPhone: customerPhone || null,
    customerNote: caption ? caption.slice(0, 500) : null,
  };
}
