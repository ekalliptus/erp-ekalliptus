import dgram from 'node:dgram';
import dns from 'node:dns';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { getPrinterAttributes, PRINTER_STATES } from './ipp.mjs';

const DEFAULT_MDNS_HOSTS = ['HP48EA6283D5C2.local'];
const CACHE_PATH = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'hp-wifi-printer', 'cache.json');

function getActiveIpv4Interfaces() {
  const nets = os.networkInterfaces();
  const result = [];
  for (const [name, entries] of Object.entries(nets)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) {
        result.push({ name, address: entry.address, netmask: entry.netmask });
      }
    }
  }
  return result;
}

function buildMdnsQuery(serviceNames) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0, 2);
  header.writeUInt16BE(serviceNames.length, 4);
  const parts = [header];
  for (const name of serviceNames) {
    for (const label of name.split('.')) {
      const b = Buffer.from(label, 'utf8');
      parts.push(Buffer.from([b.length]), b);
    }
    parts.push(Buffer.from([0, 0, 12, 0, 1])); // PTR IN
  }
  return Buffer.concat(parts);
}

function probeMdns(localIp, timeoutMs) {
  return new Promise((resolve) => {
    const ips = new Set();
    const localNames = new Set();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      try { sock.close(); } catch {}
      resolve({ ips: [...ips], localNames: [...localNames] });
    };

    sock.on('error', finish);
    sock.on('message', (msg, rinfo) => {
      ips.add(rinfo.address);
      const ascii = msg.toString('latin1').replace(/[^\x20-\x7e]+/g, ' ');
      const matches = ascii.match(/\bHP[A-Za-z0-9_-]*\b/g);
      if (matches) {
        for (const m of matches) {
          if (m.length >= 8 && /^HP[0-9A-F]{6,}$/i.test(m)) {
            localNames.add(`${m}.local`);
          }
        }
      }
    });

    sock.bind(0, localIp, () => {
      try { sock.addMembership('224.0.0.251', localIp); } catch {}
      const q = buildMdnsQuery(['_ipp._tcp.local', '_ipps._tcp.local', '_pdl-datastream._tcp.local']);
      sock.send(q, 5353, '224.0.0.251');
      setTimeout(() => {
        if (!closed) sock.send(q, 5353, '224.0.0.251');
      }, 350);
    });

    setTimeout(finish, timeoutMs);
  });
}

function probeWsd(localIp, timeoutMs) {
  return new Promise((resolve) => {
    const ips = new Set();
    const sock = dgram.createSocket('udp4');
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      try { sock.close(); } catch {}
      resolve([...ips]);
    };

    sock.on('error', finish);
    sock.on('message', (_msg, rinfo) => {
      ips.add(rinfo.address);
    });

    const probeXml =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" ' +
      'xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" ' +
      'xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery" ' +
      'xmlns:wsdp="http://schemas.xmlsoap.org/ws/2006/02/devprof">' +
      '<soap:Header>' +
      '<wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>' +
      '<wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>' +
      '<wsa:MessageID>urn:uuid:22222222-3333-4444-5555-666666666666</wsa:MessageID>' +
      '</soap:Header>' +
      '<soap:Body><wsd:Probe><wsd:Types>wsdp:Device</wsd:Types></wsd:Probe></soap:Body>' +
      '</soap:Envelope>';

    sock.bind(0, localIp, () => {
      sock.send(Buffer.from(probeXml, 'utf8'), 3702, '239.255.255.250');
    });

    setTimeout(finish, timeoutMs);
  });
}

function checkTcpPort(ip, port, timeoutMs = 350) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs);
    s.on('connect', () => finish(true));
    s.on('timeout', () => finish(false));
    s.on('error', () => finish(false));
    s.connect(port, ip);
  });
}

async function scanSubnetForPort631(localIp) {
  const octets = localIp.split('.');
  if (octets.length !== 4) return [];
  const prefix = `${octets[0]}.${octets[1]}.${octets[2]}`;
  const openIps = [];
  const batchSize = 64;
  for (let start = 1; start <= 254; start += batchSize) {
    const tasks = [];
    for (let i = start; i < start + batchSize && i <= 254; i++) {
      const ip = `${prefix}.${i}`;
      tasks.push(
        checkTcpPort(ip, 631, 350).then((open) => {
          if (open) openIps.push(ip);
        })
      );
    }
    await Promise.all(tasks);
  }
  return openIps;
}

async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCache(printer) {
  try {
    await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    await fs.writeFile(
      CACHE_PATH,
      JSON.stringify(
        {
          ip: printer.ip,
          port: printer.port,
          dnsSdName: printer.dnsSdName,
          model: printer.model,
          uuid: printer.uuid,
          mdnsHost: printer.mdnsHost || DEFAULT_MDNS_HOSTS[0],
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    // Non-fatal cache write failure
  }
}

function summarizePrinter(ip, res, mdnsHost = null) {
  const a = res.printerAttributes || {};
  const stateCode = Number(a['printer-state'] ?? 0);
  const markerNames = Array.isArray(a['marker-names']) ? a['marker-names'] : a['marker-names'] ? [a['marker-names']] : [];
  const markerLevels = Array.isArray(a['marker-levels']) ? a['marker-levels'] : a['marker-levels'] !== undefined ? [a['marker-levels']] : [];
  const markerColors = Array.isArray(a['marker-colors']) ? a['marker-colors'] : a['marker-colors'] ? [a['marker-colors']] : [];

  const markers = markerNames.map((name, i) => ({
    name,
    level: markerLevels[i] ?? null,
    color: markerColors[i] ?? null,
  }));

  return {
    ip,
    port: 631,
    uri: `ipp://${ip}:631/ipp/print`,
    mdnsHost,
    name: a['printer-name'] || '',
    info: a['printer-info'] || '',
    model: a['printer-make-and-model'] || a['printer-info'] || '',
    dnsSdName: a['printer-dns-sd-name'] || '',
    uuid: a['printer-uuid'] || '',
    state: stateCode,
    stateText: PRINTER_STATES[stateCode] || `unknown(${stateCode})`,
    stateReasons: a['printer-state-reasons'] || 'none',
    acceptingJobs: Boolean(a['printer-is-accepting-jobs']),
    queuedJobs: Number(a['queued-job-count'] ?? 0),
    mediaReady: a['media-ready'] || a['media-default'] || '',
    formats: Array.isArray(a['document-format-supported'])
      ? a['document-format-supported']
      : a['document-format-supported']
        ? [a['document-format-supported']]
        : [],
    markers,
    moreInfoUrl: a['printer-more-info'] || `http://${ip}/`,
    rawAttributes: a,
  };
}

async function resolveHostnameIpv4(hostname) {
  try {
    const res = await dns.promises.lookup(hostname, { family: 4 });
    return res?.address || null;
  } catch {
    return null;
  }
}

/**
 * Discover IPP network printers via cache, mDNS, WS-Discovery, and optional /24 subnet scan.
 */
export async function discoverPrinters({
  preferredModel = /HP Smart Tank 58/i,
  subnetScan = false,
  timeoutMs = 2200,
} = {}) {
  const ifaces = getActiveIpv4Interfaces();
  const cache = await readCache();
  const candidates = new Set();
  const knownHostnames = new Set(DEFAULT_MDNS_HOSTS);
  if (cache?.mdnsHost) knownHostnames.add(cache.mdnsHost);
  if (cache?.ip) candidates.add(cache.ip);

  const probeTasks = [];
  for (const h of knownHostnames) {
    probeTasks.push(
      resolveHostnameIpv4(h).then((ip) => {
        if (ip) candidates.add(ip);
      })
    );
  }
  for (const iface of ifaces) {
    probeTasks.push(
      probeMdns(iface.address, timeoutMs).then(({ ips, localNames }) => {
        for (const ip of ips) candidates.add(ip);
        for (const n of localNames) knownHostnames.add(n);
      })
    );
    probeTasks.push(
      probeWsd(iface.address, timeoutMs).then((ips) => {
        for (const ip of ips) candidates.add(ip);
      })
    );
  }
  await Promise.all(probeTasks);

  if (subnetScan || candidates.size === 0) {
    const scanResults = await Promise.all(ifaces.map((iface) => scanSubnetForPort631(iface.address)));
    for (const ips of scanResults) {
      for (const ip of ips) candidates.add(ip);
    }
  }

  const printers = [];
  await Promise.all(
    [...candidates].map(async (ip) => {
      try {
        const res = await getPrinterAttributes(ip, { timeoutMs: 3000 });
        if (res.ok && res.printerAttributes && Object.keys(res.printerAttributes).length > 0) {
          printers.push(summarizePrinter(ip, res, [...knownHostnames][0] || null));
        }
      } catch {
        // Not an IPP printer or unreachable
      }
    })
  );

  printers.sort((a, b) => {
    const aMatch = preferredModel.test(`${a.model} ${a.info} ${a.dnsSdName}`) ? 1 : 0;
    const bMatch = preferredModel.test(`${b.model} ${b.info} ${b.dnsSdName}`) ? 1 : 0;
    return bMatch - aMatch;
  });

  if (printers.length > 0) {
    await writeCache(printers[0]);
  }

  return printers;
}

/**
 * Resolve target printer quickly (explicit host -> cache -> full discovery + subnet fallback).
 */
export async function resolvePrinter({ host = null, subnetScan = false } = {}) {
  if (host) {
    let targetIp = host;
    if (!net.isIPv4(host)) {
      const resolved = await resolveHostnameIpv4(host);
      if (resolved) targetIp = resolved;
    }
    const res = await getPrinterAttributes(targetIp, { timeoutMs: 4000 });
    if (!res.ok || !res.printerAttributes) {
      throw new Error(`Printer di ${host} tidak merespons IPP Get-Printer-Attributes (status: ${res.statusName})`);
    }
    const p = summarizePrinter(targetIp, res, net.isIPv4(host) ? null : host);
    await writeCache(p);
    return p;
  }

  const cache = await readCache();
  if (cache?.ip && !subnetScan) {
    try {
      const res = await getPrinterAttributes(cache.ip, { timeoutMs: 1500 });
      if (res.ok && res.printerAttributes && /HP/i.test(res.printerAttributes['printer-make-and-model'] || '')) {
        return summarizePrinter(cache.ip, res, cache.mdnsHost || null);
      }
    } catch {
      // Cache stale; fall back to full discovery
    }
  }

  let printers = await discoverPrinters({ subnetScan });
  if (printers.length === 0 && !subnetScan) {
    printers = await discoverPrinters({ subnetScan: true });
  }

  if (printers.length === 0) {
    throw new Error(
      'Printer HP Smart Tank 583 tidak ditemukan di jaringan Wi-Fi.\n' +
        'Pastikan: (1) printer menyala dan ikon Wi-Fi aktif (tidak berkedip), ' +
        '(2) laptop terhubung ke SSID Wi-Fi yang sama dengan printer, ' +
        '(3) jika baru ganti router/IP, coba jalankan: discover --subnet-scan'
    );
  }

  return printers[0];
}
