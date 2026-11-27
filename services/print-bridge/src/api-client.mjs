export class PrintBridgeApiClient {
  constructor({ baseUrl, agentToken }) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.agentToken = String(agentToken || '').trim();
  }

  async _requestJson(path, init = {}) {
    if (!this.baseUrl) {
      throw new Error('ERP_API_BASE_URL belum dikonfigurasi.');
    }
    if (!this.agentToken) {
      throw new Error('PRINT_AGENT_TOKEN belum dikonfigurasi.');
    }

    const headers = new Headers(init.headers);
    headers.set('X-Print-Agent-Token', this.agentToken);
    if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      const msg =
        (json && typeof json.error === 'string' ? json.error : null) ||
        `HTTP ${res.status} pada ${path}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  heartbeat(payload) {
    return this._requestJson('/api/print-agent/heartbeat', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  sync(payload) {
    return this._requestJson('/api/print-agent/sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async checkSignal(signalUrl, { lastEtag = null, lastSeq = null } = {}) {
    if (!signalUrl) {
      return { ok: false, changed: false, expired: false, etag: lastEtag, seq: lastSeq };
    }
    const headers = new Headers();
    if (lastEtag) {
      headers.set('If-None-Match', lastEtag);
    }

    const res = await fetch(signalUrl, {
      method: 'GET',
      cache: 'no-store',
      headers,
    });

    if (res.status === 304) {
      return { ok: true, changed: false, expired: false, etag: lastEtag, seq: lastSeq };
    }
    if (res.status === 403) {
      return { ok: false, changed: true, expired: true, etag: null, seq: null };
    }
    if (res.status === 404) {
      return { ok: true, changed: false, expired: false, etag: lastEtag, seq: lastSeq };
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} saat cek print signal`);
      err.status = res.status;
      throw err;
    }

    const etag = res.headers.get('etag') || null;
    let seq = null;
    try {
      const data = await res.json();
      if (data && typeof data.seq === 'string') {
        seq = data.seq;
      }
    } catch {
      seq = null;
    }

    const hasBaseline = lastEtag !== null || lastSeq !== null;
    const seqChanged = seq !== null ? seq !== lastSeq : false;
    const etagChanged = etag !== null ? etag !== lastEtag : false;
    const changed = hasBaseline && (seqChanged || etagChanged);

    return {
      ok: true,
      changed,
      expired: false,
      etag: etag ?? lastEtag,
      seq: seq ?? lastSeq,
    };
  }

  presignUpload(payload) {
    return this._requestJson('/api/print-agent/jobs/presign-upload', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async uploadBufferToS3(uploadUrl, buffer, contentType) {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
      },
      body: buffer,
    });
    if (!res.ok) {
      throw new Error(`Upload file ke storage gagal dengan HTTP ${res.status}`);
    }
  }

  ingestJob(payload) {
    return this._requestJson('/api/print-agent/jobs/ingest', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  claimNextJob() {
    return this._requestJson('/api/print-agent/jobs/claim-next', {
      method: 'POST',
      body: '{}',
    });
  }

  submitJobResult(jobId, payload) {
    return this._requestJson(`/api/print-agent/jobs/${jobId}/result`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  getPendingOutbox() {
    return this._requestJson('/api/print-agent/wa-outbox/pending', {
      method: 'GET',
    });
  }

  ackOutbox(id, payload) {
    return this._requestJson(`/api/print-agent/wa-outbox/${id}/ack`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  ackCommand(payload) {
    return this._requestJson('/api/print-agent/command/ack', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async downloadFileBuffer(downloadUrl) {
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`Gagal mengunduh file print job (HTTP ${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
