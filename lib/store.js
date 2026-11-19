import { Redis } from '@upstash/redis';

let client;
export function getRedis() {
  if (client) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error('Redis not configured. Add Upstash Redis from the Vercel Marketplace (Storage tab).');
  }
  client = new Redis({ url, token });
  return client;
}
