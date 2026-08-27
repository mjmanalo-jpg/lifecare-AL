import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase Storage helper (service-role). All resident/staff uploads
// live in ONE private bucket, keyed by `<org>/<community>/<folder>/<uuid>.<ext>`,
// so files are durable (not the ephemeral serverless disk) and never public — they
// are only reachable through the auth-gated /api/files route (short-lived signed URL).

export const UPLOAD_BUCKET = "uploads";

let client: SupabaseClient | null = null;
export function getStorageClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

let bucketReady = false;
async function ensureUploadBucket(): Promise<void> {
  if (bucketReady) return;
  const { error } = await getStorageClient().storage.createBucket(UPLOAD_BUCKET, { public: false, fileSizeLimit: 10 * 1024 * 1024 });
  if (error && !/exist/i.test(error.message)) throw error; // ignore "already exists"
  bucketReady = true;
}

/** Upload bytes to the private bucket at `objectPath`. Throws on failure. */
export async function uploadToBucket(objectPath: string, body: Buffer, contentType?: string): Promise<void> {
  await ensureUploadBucket();
  const { error } = await getStorageClient().storage
    .from(UPLOAD_BUCKET)
    .upload(objectPath, body, { contentType: contentType || "application/octet-stream", upsert: false });
  if (error) throw error;
}

/** Short-lived signed URL for one object, or null if it doesn't exist. */
export async function signedFileUrl(objectPath: string, expiresIn = 300): Promise<string | null> {
  const { data, error } = await getStorageClient().storage.from(UPLOAD_BUCKET).createSignedUrl(objectPath, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
