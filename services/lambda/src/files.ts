import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { requireEnv } from './env.js';

const s3 = new S3Client({});

export interface StoredFile {
  key: string;
  url: string; // short-lived presigned GET for the bridge to download
  filename: string;
}

/** Store a generated file privately; only a short-lived link ever leaves AWS. */
export async function storeFile(prefix: string, filename: string, body: Uint8Array, contentType: string): Promise<StoredFile> {
  const bucket = requireEnv('FILES_BUCKET');
  const key = `${prefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${filename}`;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return linkTo(key, filename);
}

/** A short-lived link to a file already in the bucket, for sending it as an attachment. */
export async function linkTo(key: string, filename: string): Promise<StoredFile> {
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: requireEnv('FILES_BUCKET'), Key: key }), { expiresIn: 3600 });
  return { key, url, filename };
}

export async function putFile(key: string, body: Uint8Array, contentType: string) {
  await s3.send(new PutObjectCommand({ Bucket: requireEnv('FILES_BUCKET'), Key: key, Body: body, ContentType: contentType }));
}

export async function copyFile(from: string, to: string) {
  const bucket = requireEnv('FILES_BUCKET');
  await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: to, CopySource: `${bucket}/${encodeURIComponent(from).replace(/%2F/g, '/')}` }));
}

export async function deleteFile(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: requireEnv('FILES_BUCKET'), Key: key }));
}

export async function readFile(key: string): Promise<{ bytes: Uint8Array; contentType?: string }> {
  const res = await s3.send(new GetObjectCommand({ Bucket: requireEnv('FILES_BUCKET'), Key: key }));
  return { bytes: await res.Body!.transformToByteArray(), contentType: res.ContentType };
}
