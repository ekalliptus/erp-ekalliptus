import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'ap-southeast-1',
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      forcePathStyle: true,
      credentials:
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }
  return s3Client;
}

export function getBucketName(): string {
  return process.env.STORAGE_BUCKET || 'assets';
}

export async function createPresignedUploadUrl(params: {
  key: string;
  contentType: string;
  expiresIn?: number;
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: params.key,
    ContentType: params.contentType,
  });
  return getSignedUrl(getS3Client(), cmd, { expiresIn: params.expiresIn ?? 900 });
}

export async function createPresignedDownloadUrl(params: {
  key: string;
  expiresIn?: number;
  filename?: string;
  contentType?: string;
}): Promise<string> {
  const safeDisposition = params.filename
    ? `attachment; filename="${params.filename.replace(/"/g, '')}"`
    : undefined;
  const cmd = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: params.key,
    ...(safeDisposition ? { ResponseContentDisposition: safeDisposition } : {}),
    ...(params.contentType ? { ResponseContentType: params.contentType } : {}),
  });
  return getSignedUrl(getS3Client(), cmd, { expiresIn: params.expiresIn ?? 3600 });
}

export async function uploadObject(params: {
  key: string;
  body: Uint8Array | Buffer | string;
  contentType: string;
}): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );
}

export async function downloadObjectBytes(key: string): Promise<Uint8Array> {
  const res = await getS3Client().send(
    new GetObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    }),
  );
  if (!res.Body) {
    throw new Error(`Empty object body for key ${key}`);
  }
  return res.Body.transformToByteArray();
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await getS3Client().send(
      new HeadObjectCommand({
        Bucket: getBucketName(),
        Key: key,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    }),
  );
}
