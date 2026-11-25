import http from 'node:http';

export const IPP_TAGS = {
  OPERATION_ATTRIBUTES: 0x01,
  JOB_ATTRIBUTES: 0x02,
  END_OF_ATTRIBUTES: 0x03,
  PRINTER_ATTRIBUTES: 0x04,
  UNSUPPORTED_ATTRIBUTES: 0x05,

  INTEGER: 0x21,
  BOOLEAN: 0x22,
  ENUM: 0x23,
  OCTET_STRING: 0x30,
  DATETIME: 0x31,
  RESOLUTION: 0x32,
  RANGE_OF_INTEGER: 0x33,
  BEG_COLLECTION: 0x34,
  TEXT_WITH_LANGUAGE: 0x35,
  NAME_WITH_LANGUAGE: 0x36,
  END_COLLECTION: 0x37,
  TEXT_WITHOUT_LANGUAGE: 0x41,
  NAME_WITHOUT_LANGUAGE: 0x42,
  KEYWORD: 0x44,
  URI: 0x45,
  URI_SCHEME: 0x46,
  CHARSET: 0x47,
  NATURAL_LANGUAGE: 0x48,
  MIME_MEDIA_TYPE: 0x49,
  MEMBER_ATTR_NAME: 0x4a,
};

export const IPP_OPS = {
  PRINT_JOB: 0x0002,
  VALIDATE_JOB: 0x0004,
  CANCEL_JOB: 0x0008,
  GET_JOB_ATTRIBUTES: 0x0009,
  GET_JOBS: 0x000a,
  GET_PRINTER_ATTRIBUTES: 0x000b,
};

export const PRINTER_STATES = {
  3: 'idle',
  4: 'processing',
  5: 'stopped',
};

export const JOB_STATES = {
  3: 'pending',
  4: 'pending-held',
  5: 'processing',
  6: 'processing-stopped',
  7: 'canceled',
  8: 'aborted',
  9: 'completed',
};

export const IPP_STATUS_NAMES = {
  0x0000: 'successful-ok',
  0x0001: 'successful-ok-ignored-or-substituted-attributes',
  0x0002: 'successful-ok-conflicting-attributes',
  0x0400: 'client-error-bad-request',
  0x0401: 'client-error-forbidden',
  0x0402: 'client-error-not-authenticated',
  0x0403: 'client-error-not-authorized',
  0x0404: 'client-error-not-possible',
  0x0405: 'client-error-timeout',
  0x0406: 'client-error-not-found',
  0x0407: 'client-error-gone',
  0x0408: 'client-error-request-entity-too-large',
  0x040a: 'client-error-document-format-not-supported',
  0x040b: 'client-error-attributes-or-values-not-supported',
  0x040e: 'client-error-conflicting-attributes',
  0x0500: 'server-error-internal-error',
  0x0501: 'server-error-operation-not-supported',
  0x0503: 'server-error-service-unavailable',
  0x0507: 'server-error-busy',
};

function encodeScalarValue(tag, value) {
  if (tag === IPP_TAGS.INTEGER || tag === IPP_TAGS.ENUM) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(Number(value), 0);
    return b;
  }
  if (tag === IPP_TAGS.BOOLEAN) {
    return Buffer.from([value ? 1 : 0]);
  }
  if (tag === IPP_TAGS.RESOLUTION) {
    const b = Buffer.alloc(9);
    const x = typeof value === 'object' ? value.x : Number(value);
    const y = typeof value === 'object' ? (value.y ?? value.x) : Number(value);
    const unit = typeof value === 'object' && value.unit === 'dpcm' ? 4 : 3;
    b.writeInt32BE(x, 0);
    b.writeInt32BE(y, 4);
    b.writeUInt8(unit, 8);
    return b;
  }
  if (tag === IPP_TAGS.RANGE_OF_INTEGER) {
    const b = Buffer.alloc(8);
    b.writeInt32BE(value.min, 0);
    b.writeInt32BE(value.max, 4);
    return b;
  }
  return Buffer.from(String(value ?? ''), 'utf8');
}

function encodeAttributeEntry(tag, name, value) {
  const parts = [];
  if (value && typeof value === 'object' && value.type === 'collection') {
    const nameBuf = Buffer.from(name, 'utf8');
    const hdr = Buffer.alloc(1 + 2 + nameBuf.length + 2);
    hdr.writeUInt8(IPP_TAGS.BEG_COLLECTION, 0);
    hdr.writeUInt16BE(nameBuf.length, 1);
    nameBuf.copy(hdr, 3);
    hdr.writeUInt16BE(0, 3 + nameBuf.length);
    parts.push(hdr);

    for (const member of value.members || []) {
      const mNameBuf = Buffer.from(member.name, 'utf8');
      const mAttr = Buffer.alloc(1 + 2 + 2 + mNameBuf.length);
      mAttr.writeUInt8(IPP_TAGS.MEMBER_ATTR_NAME, 0);
      mAttr.writeUInt16BE(0, 1);
      mAttr.writeUInt16BE(mNameBuf.length, 3);
      mNameBuf.copy(mAttr, 5);
      parts.push(mAttr);

      const mVals = Array.isArray(member.value) ? member.value : [member.value];
      for (const mv of mVals) {
        if (mv && typeof mv === 'object' && mv.type === 'collection') {
          parts.push(encodeAttributeEntry(IPP_TAGS.BEG_COLLECTION, '', mv));
        } else {
          const valBuf = encodeScalarValue(member.tag, mv);
          const vEntry = Buffer.alloc(1 + 2 + 2 + valBuf.length);
          vEntry.writeUInt8(member.tag, 0);
          vEntry.writeUInt16BE(0, 1);
          vEntry.writeUInt16BE(valBuf.length, 3);
          valBuf.copy(vEntry, 5);
          parts.push(vEntry);
        }
      }
    }

    const endCol = Buffer.alloc(5);
    endCol.writeUInt8(IPP_TAGS.END_COLLECTION, 0);
    endCol.writeUInt16BE(0, 1);
    endCol.writeUInt16BE(0, 3);
    parts.push(endCol);
    return Buffer.concat(parts);
  }

  const values = Array.isArray(value) ? value : [value];
  values.forEach((v, idx) => {
    if (v && typeof v === 'object' && v.type === 'collection') {
      parts.push(encodeAttributeEntry(IPP_TAGS.BEG_COLLECTION, idx === 0 ? name : '', v));
      return;
    }
    const nameBuf = idx === 0 ? Buffer.from(name, 'utf8') : Buffer.alloc(0);
    const valBuf = encodeScalarValue(tag, v);
    const b = Buffer.alloc(1 + 2 + nameBuf.length + 2 + valBuf.length);
    let o = 0;
    b.writeUInt8(tag, o); o += 1;
    b.writeUInt16BE(nameBuf.length, o); o += 2;
    nameBuf.copy(b, o); o += nameBuf.length;
    b.writeUInt16BE(valBuf.length, o); o += 2;
    valBuf.copy(b, o);
    parts.push(b);
  });
  return Buffer.concat(parts);
}

/**
 * Encode an IPP 2.0 request buffer per RFC 8010.
 */
export function encodeIppRequest({
  operationId,
  requestId = 1,
  operationAttributes = [],
  jobAttributes = [],
  data = null,
}) {
  const header = Buffer.alloc(8);
  header.writeUInt8(2, 0);
  header.writeUInt8(0, 1);
  header.writeUInt16BE(operationId, 2);
  header.writeUInt32BE(requestId >>> 0, 4);

  const chunks = [header, Buffer.from([IPP_TAGS.OPERATION_ATTRIBUTES])];

  // Enforce RFC 8010 required leading order: attributes-charset, attributes-natural-language, printer-uri
  const priorityOrder = ['attributes-charset', 'attributes-natural-language', 'printer-uri'];
  const ordered = [];
  const rest = [];
  for (const key of priorityOrder) {
    const found = operationAttributes.find((a) => a.name === key);
    if (found) ordered.push(found);
  }
  for (const attr of operationAttributes) {
    if (!priorityOrder.includes(attr.name)) rest.push(attr);
  }
  for (const attr of [...ordered, ...rest]) {
    chunks.push(encodeAttributeEntry(attr.tag, attr.name, attr.value));
  }

  if (jobAttributes.length > 0) {
    chunks.push(Buffer.from([IPP_TAGS.JOB_ATTRIBUTES]));
    for (const attr of jobAttributes) {
      chunks.push(encodeAttributeEntry(attr.tag, attr.name, attr.value));
    }
  }

  chunks.push(Buffer.from([IPP_TAGS.END_OF_ATTRIBUTES]));
  if (data && data.length > 0) {
    chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
  }
  return Buffer.concat(chunks);
}

function decodeScalarValue(tag, buf, offset, len) {
  if (tag === IPP_TAGS.INTEGER || tag === IPP_TAGS.ENUM) {
    return len === 4 ? buf.readInt32BE(offset) : buf.subarray(offset, offset + len).toString('hex');
  }
  if (tag === IPP_TAGS.BOOLEAN) {
    return len >= 1 ? buf[offset] !== 0 : false;
  }
  if (tag === IPP_TAGS.RESOLUTION && len === 9) {
    return {
      x: buf.readInt32BE(offset),
      y: buf.readInt32BE(offset + 4),
      unit: buf[offset + 8] === 4 ? 'dpcm' : 'dpi',
    };
  }
  if (tag === IPP_TAGS.RANGE_OF_INTEGER && len === 8) {
    return {
      min: buf.readInt32BE(offset),
      max: buf.readInt32BE(offset + 4),
    };
  }
  if (tag === IPP_TAGS.DATETIME && len === 11) {
    const year = buf.readUInt16BE(offset);
    const month = String(buf[offset + 2]).padStart(2, '0');
    const day = String(buf[offset + 3]).padStart(2, '0');
    const hour = String(buf[offset + 4]).padStart(2, '0');
    const min = String(buf[offset + 5]).padStart(2, '0');
    const sec = String(buf[offset + 6]).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${min}:${sec}`;
  }
  if (tag >= 0x35 && tag <= 0x4f) {
    return buf.toString('utf8', offset, offset + len);
  }
  return buf.subarray(offset, offset + len).toString('hex');
}

function appendAttrValue(target, name, val) {
  if (!name) return;
  if (Object.prototype.hasOwnProperty.call(target, name)) {
    if (Array.isArray(target[name])) {
      target[name].push(val);
    } else {
      target[name] = [target[name], val];
    }
  } else {
    target[name] = val;
  }
}

/**
 * Parse an IPP binary response buffer into structured attribute groups.
 */
export function parseIppResponse(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) {
    throw new Error(`Invalid IPP response buffer (length=${buf ? buf.length : 0})`);
  }

  const version = `${buf[0]}.${buf[1]}`;
  const statusCode = buf.readUInt16BE(2);
  const requestId = buf.readUInt32BE(4);

  const operationAttributes = {};
  const printerAttributes = {};
  const jobAttributes = [];
  const unsupportedAttributes = {};

  let currentGroup = null;
  let currentTarget = null;
  let lastAttrName = null;
  const collectionStack = [];

  let pos = 8;
  while (pos < buf.length) {
    const tag = buf[pos++];
    if (tag === IPP_TAGS.END_OF_ATTRIBUTES) break;

    if (tag <= 0x0f) {
      currentGroup = tag;
      lastAttrName = null;
      collectionStack.length = 0;
      if (tag === IPP_TAGS.OPERATION_ATTRIBUTES) currentTarget = operationAttributes;
      else if (tag === IPP_TAGS.PRINTER_ATTRIBUTES) currentTarget = printerAttributes;
      else if (tag === IPP_TAGS.JOB_ATTRIBUTES) {
        const jobObj = {};
        jobAttributes.push(jobObj);
        currentTarget = jobObj;
      } else if (tag === IPP_TAGS.UNSUPPORTED_ATTRIBUTES) currentTarget = unsupportedAttributes;
      else currentTarget = {};
      continue;
    }

    if (pos + 2 > buf.length) break;
    const nameLen = buf.readUInt16BE(pos); pos += 2;
    const rawName = nameLen > 0 ? buf.toString('utf8', pos, pos + nameLen) : null;
    pos += nameLen;

    if (pos + 2 > buf.length) break;
    const valLen = buf.readUInt16BE(pos); pos += 2;
    if (pos + valLen > buf.length) break;

    if (tag === IPP_TAGS.BEG_COLLECTION) {
      const colObj = {};
      if (collectionStack.length > 0) {
        const top = collectionStack[collectionStack.length - 1];
        appendAttrValue(top.obj, top.memberName, colObj);
        collectionStack.push({ obj: colObj, memberName: null, attrName: null });
      } else {
        const attrName = rawName || lastAttrName;
        lastAttrName = attrName;
        if (currentTarget) appendAttrValue(currentTarget, attrName, colObj);
        collectionStack.push({ obj: colObj, memberName: null, attrName });
      }
      pos += valLen;
      continue;
    }

    if (tag === IPP_TAGS.END_COLLECTION) {
      collectionStack.pop();
      pos += valLen;
      continue;
    }

    if (tag === IPP_TAGS.MEMBER_ATTR_NAME) {
      const memberName = buf.toString('utf8', pos, pos + valLen);
      if (collectionStack.length > 0) {
        collectionStack[collectionStack.length - 1].memberName = memberName;
      }
      pos += valLen;
      continue;
    }

    const val = decodeScalarValue(tag, buf, pos, valLen);
    pos += valLen;

    if (collectionStack.length > 0) {
      const top = collectionStack[collectionStack.length - 1];
      appendAttrValue(top.obj, top.memberName, val);
    } else {
      const attrName = rawName || lastAttrName;
      if (rawName) lastAttrName = rawName;
      if (currentTarget && attrName) {
        appendAttrValue(currentTarget, attrName, val);
      }
    }
  }

  return {
    version,
    statusCode,
    statusName: IPP_STATUS_NAMES[statusCode] || `0x${statusCode.toString(16).padStart(4, '0')}`,
    ok: statusCode < 0x0400,
    requestId,
    groupCount: { jobs: jobAttributes.length, currentGroup },
    operationAttributes,
    printerAttributes,
    jobAttributes,
    unsupportedAttributes,
  };
}

/**
 * Send an encoded IPP request over HTTP POST to /ipp/print.
 */
export function sendIppRequest({ host, port = 631, path = '/ipp/print', payload, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/ipp',
          'Content-Length': payload.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks);
            const parsed = parseIppResponse(raw);
            resolve({ httpStatus: res.statusCode, ...parsed });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error(`IPP request to ${host}:${port}${path} timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export function buildPrinterUri(host, port = 631, path = '/ipp/print') {
  return `ipp://${host}:${port}${path}`;
}

export async function getPrinterAttributes(host, { port = 631, path = '/ipp/print', timeoutMs = 5000, requestedAttributes = ['all'] } = {}) {
  const payload = encodeIppRequest({
    operationId: IPP_OPS.GET_PRINTER_ATTRIBUTES,
    operationAttributes: [
      { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
      { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en' },
      { tag: IPP_TAGS.URI, name: 'printer-uri', value: buildPrinterUri(host, port, path) },
      { tag: IPP_TAGS.KEYWORD, name: 'requested-attributes', value: requestedAttributes },
    ],
  });
  return sendIppRequest({ host, port, path, payload, timeoutMs });
}

function buildJobAttrs({ copies, media, colorMode, quality, borderless, mediaSizeMm, orientationRequested }) {
  const attrs = [];
  if (copies && Number(copies) >= 1) {
    attrs.push({ tag: IPP_TAGS.INTEGER, name: 'copies', value: Number(copies) });
  }
  if (borderless && mediaSizeMm) {
    attrs.push({
      tag: IPP_TAGS.BEG_COLLECTION,
      name: 'media-col',
      value: {
        type: 'collection',
        members: [
          {
            name: 'media-size',
            tag: IPP_TAGS.BEG_COLLECTION,
            value: {
              type: 'collection',
              members: [
                { name: 'x-dimension', tag: IPP_TAGS.INTEGER, value: Math.round(mediaSizeMm.widthMm * 100) },
                { name: 'y-dimension', tag: IPP_TAGS.INTEGER, value: Math.round(mediaSizeMm.heightMm * 100) },
              ],
            },
          },
          { name: 'media-top-margin', tag: IPP_TAGS.INTEGER, value: 0 },
          { name: 'media-bottom-margin', tag: IPP_TAGS.INTEGER, value: 0 },
          { name: 'media-left-margin', tag: IPP_TAGS.INTEGER, value: 0 },
          { name: 'media-right-margin', tag: IPP_TAGS.INTEGER, value: 0 },
        ],
      },
    });
  } else if (media) {
    attrs.push({ tag: IPP_TAGS.KEYWORD, name: 'media', value: media });
  }
  if (colorMode) {
    attrs.push({ tag: IPP_TAGS.KEYWORD, name: 'print-color-mode', value: colorMode });
  }
  if (quality) {
    attrs.push({ tag: IPP_TAGS.ENUM, name: 'print-quality', value: Number(quality) });
  }
  if (orientationRequested) {
    attrs.push({ tag: IPP_TAGS.ENUM, name: 'orientation-requested', value: Number(orientationRequested) });
  }
  return attrs;
}

export async function validateJob(
  host,
  {
    port = 631,
    path = '/ipp/print',
    documentFormat = 'image/pwg-raster',
    jobName = 'Antigravity Print Job',
    copies = 1,
    media = 'iso_a4_210x297mm',
    colorMode = 'color',
    quality = 4,
    borderless = false,
    mediaSizeMm = null,
    orientationRequested = null,
    userName = 'antigravity',
    timeoutMs = 10000,
  } = {}
) {
  const payload = encodeIppRequest({
    operationId: IPP_OPS.VALIDATE_JOB,
    operationAttributes: [
      { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
      { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en' },
      { tag: IPP_TAGS.URI, name: 'printer-uri', value: buildPrinterUri(host, port, path) },
      { tag: IPP_TAGS.NAME_WITHOUT_LANGUAGE, name: 'requesting-user-name', value: userName },
      { tag: IPP_TAGS.NAME_WITHOUT_LANGUAGE, name: 'job-name', value: jobName },
      { tag: IPP_TAGS.MIME_MEDIA_TYPE, name: 'document-format', value: documentFormat },
    ],
    jobAttributes: buildJobAttrs({ copies, media, colorMode, quality, borderless, mediaSizeMm, orientationRequested }),
  });
  return sendIppRequest({ host, port, path, payload, timeoutMs });
}

export async function printJob(
  host,
  {
    port = 631,
    path = '/ipp/print',
    documentFormat = 'image/pwg-raster',
    data,
    jobName = 'Antigravity Print Job',
    copies = 1,
    media = 'iso_a4_210x297mm',
    colorMode = 'color',
    quality = 4,
    borderless = false,
    mediaSizeMm = null,
    orientationRequested = null,
    userName = 'antigravity',
    timeoutMs = 120000,
  } = {}
) {
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new Error('printJob requires a non-empty Buffer in data');
  }
  const payload = encodeIppRequest({
    operationId: IPP_OPS.PRINT_JOB,
    operationAttributes: [
      { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
      { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en' },
      { tag: IPP_TAGS.URI, name: 'printer-uri', value: buildPrinterUri(host, port, path) },
      { tag: IPP_TAGS.NAME_WITHOUT_LANGUAGE, name: 'requesting-user-name', value: userName },
      { tag: IPP_TAGS.NAME_WITHOUT_LANGUAGE, name: 'job-name', value: jobName },
      { tag: IPP_TAGS.MIME_MEDIA_TYPE, name: 'document-format', value: documentFormat },
    ],
    jobAttributes: buildJobAttrs({ copies, media, colorMode, quality, borderless, mediaSizeMm, orientationRequested }),
    data,
  });
  return sendIppRequest({ host, port, path, payload, timeoutMs });
}

export async function getJobs(host, { port = 631, path = '/ipp/print', whichJobs = 'all', userName = 'antigravity', timeoutMs = 8000 } = {}) {
  const payload = encodeIppRequest({
    operationId: IPP_OPS.GET_JOBS,
    operationAttributes: [
      { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
      { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en' },
      { tag: IPP_TAGS.URI, name: 'printer-uri', value: buildPrinterUri(host, port, path) },
      { tag: IPP_TAGS.NAME_WITHOUT_LANGUAGE, name: 'requesting-user-name', value: userName },
      { tag: IPP_TAGS.KEYWORD, name: 'which-jobs', value: whichJobs },
      {
        tag: IPP_TAGS.KEYWORD,
        name: 'requested-attributes',
        value: ['job-id', 'job-name', 'job-state', 'job-state-reasons', 'job-originating-user-name', 'job-impressions-completed'],
      },
    ],
  });
  return sendIppRequest({ host, port, path, payload, timeoutMs });
}

export async function getJobAttributes(host, jobId, { port = 631, path = '/ipp/print', userName = 'antigravity', timeoutMs = 8000 } = {}) {
  const payload = encodeIppRequest({
    operationId: IPP_OPS.GET_JOB_ATTRIBUTES,
    operationAttributes: [
      { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
      { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en' },
      { tag: IPP_TAGS.URI, name: 'printer-uri', value: buildPrinterUri(host, port, path) },
      { tag: IPP_TAGS.INTEGER, name: 'job-id', value: Number(jobId) },
      { tag: IPP_TAGS.NAME_WITHOUT_LANGUAGE, name: 'requesting-user-name', value: userName },
    ],
  });
  return sendIppRequest({ host, port, path, payload, timeoutMs });
}

export async function cancelJob(host, jobId, { port = 631, path = '/ipp/print', userName = 'antigravity', timeoutMs = 8000 } = {}) {
  const payload = encodeIppRequest({
    operationId: IPP_OPS.CANCEL_JOB,
    operationAttributes: [
      { tag: IPP_TAGS.CHARSET, name: 'attributes-charset', value: 'utf-8' },
      { tag: IPP_TAGS.NATURAL_LANGUAGE, name: 'attributes-natural-language', value: 'en' },
      { tag: IPP_TAGS.URI, name: 'printer-uri', value: buildPrinterUri(host, port, path) },
      { tag: IPP_TAGS.INTEGER, name: 'job-id', value: Number(jobId) },
      { tag: IPP_TAGS.NAME_WITHOUT_LANGUAGE, name: 'requesting-user-name', value: userName },
    ],
  });
  return sendIppRequest({ host, port, path, payload, timeoutMs });
}
