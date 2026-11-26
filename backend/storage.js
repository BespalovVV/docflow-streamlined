const Minio = require('minio');
const fs = require('fs');
const path = require('path');

const endPoint = process.env.MINIO_ENDPOINT || 'minio';
const port = parseInt(process.env.MINIO_PORT || '9000', 10);
const useSSL = process.env.MINIO_USE_SSL === 'true';
const accessKey = process.env.MINIO_ROOT_USER || 'docflow_minio_user';
const secretKey = process.env.MINIO_ROOT_PASSWORD || 'docflow_minio_password';
const BUCKET_NAME = process.env.MINIO_BUCKET || 'docflow-storage';

let minioClient = null;
let storageReady = false;

try {
  minioClient = new Minio.Client({
    endPoint,
    port,
    useSSL,
    accessKey,
    secretKey
  });
} catch (err) {
  console.warn('[MinIO] Client instantiation warning:', err.message);
}

async function initStorage() {
  if (!minioClient) return false;
  try {
    console.log(`[MinIO] Connecting to MinIO S3 Storage at ${endPoint}:${port}...`);
    const exists = await minioClient.bucketExists(BUCKET_NAME);
    if (!exists) {
      await minioClient.makeBucket(BUCKET_NAME, 'us-east-1');
      console.log(`[MinIO] ✅ Created S3 bucket "${BUCKET_NAME}"`);
    } else {
      console.log(`[MinIO] ✅ S3 bucket "${BUCKET_NAME}" is online and ready.`);
    }
    storageReady = true;
    return true;
  } catch (err) {
    console.warn(`[MinIO] Warning: Could not connect to MinIO S3 (${err.message}). Using local storage fallback.`);
    storageReady = false;
    return false;
  }
}

async function uploadFile(objectKey, filePathOrBuffer, contentType = 'application/octet-stream') {
  if (!minioClient || !storageReady) return false;
  try {
    if (typeof filePathOrBuffer === 'string') {
      if (!fs.existsSync(filePathOrBuffer)) return false;
      await minioClient.fPutObject(BUCKET_NAME, objectKey, filePathOrBuffer, { 'Content-Type': contentType });
    } else if (Buffer.isBuffer(filePathOrBuffer)) {
      await minioClient.putObject(BUCKET_NAME, objectKey, filePathOrBuffer, filePathOrBuffer.length, { 'Content-Type': contentType });
    }
    console.log(`[MinIO] ⬆️ Uploaded object "${objectKey}" to S3 bucket "${BUCKET_NAME}"`);
    return true;
  } catch (err) {
    console.warn(`[MinIO] Failed to upload object "${objectKey}":`, err.message);
    return false;
  }
}

async function downloadFile(objectKey, targetLocalPath) {
  if (!minioClient || !storageReady) return false;
  try {
    const dir = path.dirname(targetLocalPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await minioClient.fGetObject(BUCKET_NAME, objectKey, targetLocalPath);
    console.log(`[MinIO] ⬇️ Downloaded object "${objectKey}" to "${targetLocalPath}"`);
    return true;
  } catch (err) {
    console.warn(`[MinIO] Failed to download object "${objectKey}":`, err.message);
    return false;
  }
}

async function getObjectStream(objectKey) {
  if (!minioClient || !storageReady) return null;
  try {
    return await minioClient.getObject(BUCKET_NAME, objectKey);
  } catch (err) {
    console.warn(`[MinIO] Failed to stream object "${objectKey}":`, err.message);
    return null;
  }
}

async function deleteObject(objectKey) {
  if (!minioClient || !storageReady) return false;
  try {
    await minioClient.removeObject(BUCKET_NAME, objectKey);
    console.log(`[MinIO] 🗑️ Deleted object "${objectKey}" from MinIO`);
    return true;
  } catch (err) {
    console.warn(`[MinIO] Failed to delete object "${objectKey}":`, err.message);
    return false;
  }
}

module.exports = {
  minioClient,
  initStorage,
  uploadFile,
  downloadFile,
  getObjectStream,
  deleteObject,
  BUCKET_NAME,
  isReady: () => storageReady
};
