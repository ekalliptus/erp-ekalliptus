export type FaceModel = 'web_faceapi_128d' | 'mobile_facenet_192d';

export interface FaceEnrollmentMeta {
  poses?: string[];
  sample_count?: number;
  updated_at?: string;
  platform?: string;
}

export interface StoredFaceDescriptors {
  web_faceapi_128d?: number[];
  web_faceapi_128d_samples?: number[][];
  mobile_facenet_192d?: number[];
  mobile_facenet_192d_samples?: number[][];
  meta?: FaceEnrollmentMeta;
}

export const WEB_FACE_DISTANCE_THRESHOLD = 0.52;
export const MOBILE_FACE_COSINE_THRESHOLD = 0.56;

export function expectedVectorLength(model: FaceModel): number {
  return model === 'web_faceapi_128d' ? 128 : 192;
}

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export function l2Normalize(vec: number[]): number[] {
  let normSq = 0;
  for (const val of vec) {
    if (!Number.isFinite(val)) {
      throw new Error('Face descriptor contains non-finite value.');
    }
    normSq += val * val;
  }
  const norm = Math.sqrt(normSq);
  if (!Number.isFinite(norm) || norm <= 1e-6) {
    throw new Error('Face descriptor norm cannot be zero.');
  }
  return vec.map((val) => val / norm);
}

export function validateAndPrepareVector(
  model: FaceModel,
  raw: unknown,
): number[] | null {
  if (!Array.isArray(raw)) return null;
  const expected = expectedVectorLength(model);
  if (raw.length !== expected) return null;

  let normSq = 0;
  const parsed: number[] = new Array(expected);
  for (let i = 0; i < expected; i += 1) {
    const n = raw[i];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    parsed[i] = n;
    normSq += n * n;
  }
  if (Math.sqrt(normSq) <= 1e-6) return null;

  return model === 'mobile_facenet_192d' ? l2Normalize(parsed) : parsed;
}

function parseSampleArray(model: FaceModel, raw: unknown): number[][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const valid: number[][] = [];
  for (const entry of raw) {
    const clean = validateAndPrepareVector(model, entry);
    if (clean) valid.push(clean);
  }
  return valid.length > 0 ? valid : undefined;
}

export function parseStoredDescriptors(raw: unknown): StoredFaceDescriptors {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: StoredFaceDescriptors = {};

  const web = validateAndPrepareVector('web_faceapi_128d', obj.web_faceapi_128d);
  if (web) out.web_faceapi_128d = web;

  const webSamples = parseSampleArray('web_faceapi_128d', obj.web_faceapi_128d_samples);
  if (webSamples) out.web_faceapi_128d_samples = webSamples;

  const mobile = validateAndPrepareVector('mobile_facenet_192d', obj.mobile_facenet_192d);
  if (mobile) out.mobile_facenet_192d = mobile;

  const mobileSamples = parseSampleArray('mobile_facenet_192d', obj.mobile_facenet_192d_samples);
  if (mobileSamples) out.mobile_facenet_192d_samples = mobileSamples;

  if (obj.meta && typeof obj.meta === 'object' && !Array.isArray(obj.meta)) {
    const m = obj.meta as Record<string, unknown>;
    const poses = Array.isArray(m.poses)
      ? m.poses.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : undefined;
    const sampleCount =
      typeof m.sample_count === 'number' && Number.isFinite(m.sample_count) && m.sample_count > 0
        ? Math.floor(m.sample_count)
        : undefined;
    const updatedAt = typeof m.updated_at === 'string' ? m.updated_at : undefined;
    const platform = typeof m.platform === 'string' ? m.platform : undefined;
    if (poses || sampleCount || updatedAt || platform) {
      out.meta = {
        ...(poses ? { poses } : {}),
        ...(sampleCount ? { sample_count: sampleCount } : {}),
        ...(updatedAt ? { updated_at: updatedAt } : {}),
        ...(platform ? { platform } : {}),
      };
    }
  }

  return out;
}

export function getEnrolledModels(stored: StoredFaceDescriptors): FaceModel[] {
  const models: FaceModel[] = [];
  if (stored.web_faceapi_128d) models.push('web_faceapi_128d');
  if (stored.mobile_facenet_192d) models.push('mobile_facenet_192d');
  return models;
}

export function getModelTemplates(stored: StoredFaceDescriptors, model: FaceModel): number[][] {
  const centroid = model === 'web_faceapi_128d' ? stored.web_faceapi_128d : stored.mobile_facenet_192d;
  const samples =
    model === 'web_faceapi_128d'
      ? stored.web_faceapi_128d_samples
      : stored.mobile_facenet_192d_samples;

  const list: number[][] = [];
  if (centroid) list.push(centroid);
  if (samples && samples.length > 0) {
    list.push(...samples);
  }
  return list;
}

export function getStoredSampleCount(stored: StoredFaceDescriptors): number {
  const counts = [
    stored.meta?.sample_count ?? 0,
    stored.web_faceapi_128d_samples?.length ?? 0,
    stored.mobile_facenet_192d_samples?.length ?? 0,
    stored.web_faceapi_128d || stored.mobile_facenet_192d ? 1 : 0,
  ];
  return Math.max(...counts);
}

export function compareFaceDescriptors(
  model: FaceModel,
  enrolledOrTemplates: number[] | number[][],
  probe: number[],
): {
  matched: boolean;
  similarityPercent: number;
  distance: number;
  threshold: number;
} {
  const templates: number[][] =
    Array.isArray(enrolledOrTemplates[0])
      ? (enrolledOrTemplates as number[][])
      : [enrolledOrTemplates as number[]];

  if (templates.length === 0) {
    return {
      matched: false,
      similarityPercent: 0,
      distance: 99,
      threshold:
        model === 'web_faceapi_128d'
          ? WEB_FACE_DISTANCE_THRESHOLD
          : MOBILE_FACE_COSINE_THRESHOLD,
    };
  }

  if (model === 'web_faceapi_128d') {
    const threshold = WEB_FACE_DISTANCE_THRESHOLD;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const tpl of templates) {
      const dist = euclideanDistance(tpl, probe);
      if (dist < bestDistance) bestDistance = dist;
    }
    const matched = bestDistance <= threshold;
    const similarityPercent = Math.max(0, Math.min(100, Math.round((1 - bestDistance * 0.6) * 100)));
    return { matched, similarityPercent, distance: bestDistance, threshold };
  }

  const normalizedProbe = l2Normalize(probe);
  const threshold = MOBILE_FACE_COSINE_THRESHOLD;
  let bestCosine = Number.NEGATIVE_INFINITY;
  let bestDistance = 99;

  for (const tpl of templates) {
    const normalizedTpl = l2Normalize(tpl);
    let cosine = 0;
    for (let i = 0; i < normalizedTpl.length; i += 1) {
      cosine += normalizedTpl[i] * normalizedProbe[i];
    }
    if (cosine > bestCosine) {
      bestCosine = cosine;
      bestDistance = euclideanDistance(normalizedTpl, normalizedProbe);
    }
  }

  const matched = bestCosine >= threshold;
  const similarityPercent = Math.max(0, Math.min(100, Math.round(Math.max(0, bestCosine) * 100)));
  return { matched, similarityPercent, distance: bestDistance, threshold };
}
