import type * as FaceApiNS from '@vladmandic/face-api';

const MODEL_BASE_URI = '/models/face';

let faceApiPromise: Promise<typeof FaceApiNS> | null = null;
let modelsLoadedPromise: Promise<typeof FaceApiNS> | null = null;

async function getFaceApi(): Promise<typeof FaceApiNS> {
  if (!faceApiPromise) {
    faceApiPromise = import('@vladmandic/face-api');
  }
  return faceApiPromise;
}

export async function loadFaceModels(): Promise<typeof FaceApiNS> {
  if (!modelsLoadedPromise) {
    modelsLoadedPromise = (async () => {
      const faceapi = await getFaceApi();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_BASE_URI),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_BASE_URI),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_BASE_URI),
      ]);
      return faceapi;
    })().catch((err) => {
      modelsLoadedPromise = null;
      throw err;
    });
  }
  return modelsLoadedPromise;
}

export interface NormalizedFaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type VideoFaceFrameResult =
  | { status: 'no_face' }
  | { status: 'multiple_faces' }
  | { status: 'too_far'; box: NormalizedFaceBox }
  | { status: 'off_center'; box: NormalizedFaceBox }
  | { status: 'ready'; descriptor: number[]; box: NormalizedFaceBox; yawRatio: number };

export async function analyzeVideoFaceFrame(
  video: HTMLVideoElement,
): Promise<VideoFaceFrameResult> {
  if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return { status: 'no_face' };
  }

  const faceapi = await loadFaceModels();
  const detections = await faceapi
    .detectAllFaces(
      video,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.42 }),
    )
    .withFaceLandmarks(true)
    .withFaceDescriptors();

  if (detections.length === 0) {
    return { status: 'no_face' };
  }
  if (detections.length > 1) {
    return { status: 'multiple_faces' };
  }

  const res = detections[0];
  const rawBox = res.detection.box;
  const widthRatio = rawBox.width / video.videoWidth;
  const heightRatio = rawBox.height / video.videoHeight;
  const box: NormalizedFaceBox = {
    x: rawBox.x / video.videoWidth,
    y: rawBox.y / video.videoHeight,
    width: widthRatio,
    height: heightRatio,
  };

  if (widthRatio < 0.14) {
    return { status: 'too_far', box };
  }

  const cxRatio = (rawBox.x + rawBox.width / 2) / video.videoWidth;
  const cyRatio = (rawBox.y + rawBox.height / 2) / video.videoHeight;
  if (cxRatio < 0.2 || cxRatio > 0.8 || cyRatio < 0.14 || cyRatio > 0.86) {
    return { status: 'off_center', box };
  }

  const pts = res.landmarks.positions;
  let yawRatio = 0;
  if (pts.length > 45) {
    const leftEyeOuter = pts[36];
    const rightEyeOuter = pts[45];
    const noseTip = pts[30];
    const eyeCenterX = (leftEyeOuter.x + rightEyeOuter.x) / 2;
    const eyeSpan = Math.max(1, Math.abs(rightEyeOuter.x - leftEyeOuter.x));
    yawRatio = (noseTip.x - eyeCenterX) / eyeSpan;
  }

  return {
    status: 'ready',
    descriptor: Array.from(res.descriptor),
    box,
    yawRatio,
  };
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal mendekode foto referensi wajah.'));
    img.src = url;
  });
}

export async function extractWebDescriptorFromBlob(blob: Blob): Promise<number[]> {
  const faceapi = await loadFaceModels();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImageElement(objectUrl);
    const maxDim = 640;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || 320) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 320) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas tidak tersedia untuk memproses foto referensi wajah.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    const detected = await faceapi
      .detectSingleFace(
        canvas,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 }),
      )
      .withFaceLandmarks(true)
      .withFaceDescriptor();

    if (!detected?.descriptor) {
      throw new Error(
        'Wajah pada foto referensi tidak dapat dideteksi ulang. Minta Owner atau HR mereset data wajah.',
      );
    }
    return Array.from(detected.descriptor);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function averageDescriptors(samples: number[][]): number[] {
  if (samples.length === 0) return [];
  const len = samples[0].length;
  const sums = new Array<number>(len).fill(0);
  for (const vec of samples) {
    for (let i = 0; i < len; i += 1) {
      sums[i] += vec[i] ?? 0;
    }
  }
  return sums.map((v) => v / samples.length);
}

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}
