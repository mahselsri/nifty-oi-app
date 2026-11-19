// Optional shared-secret gate. If ACCESS_KEY is unset, the app is open.
export function authorized(req) {
  const need = process.env.ACCESS_KEY;
  if (!need) return true;
  const url = new URL(req.url);
  const got = url.searchParams.get('key') || req.headers.get('x-access-key');
  return got === need;
}
