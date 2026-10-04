const MAX_BYTES = 250 * 1024 * 1024; // 250MB — GTFS zips (esp. national/rail feeds) can be large
const TIMEOUT_MS = 20_000; // GitHub release downloads / big zips need more headroom than a typical API call
const MAX_ATTEMPTS = 3;
const MAX_REDIRECTS = 5;

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const ALLOWED_METHODS = new Set(["GET", "HEAD"]);
  if (!ALLOWED_METHODS.has(request.method)) {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders(),
    });
  }

  const url = new URL(request.url);
  const targetParam = url.searchParams.get("url");
  if (!targetParam) {
    return new Response("Missing url parameter", {
      status: 400,
      headers: corsHeaders(),
    });
  }

  let target;
  try {
    target = new URL(targetParam);
  } catch {
    return new Response("Invalid url parameter", {
      status: 400,
      headers: corsHeaders(),
    });
  }

  const blockReason = validateTarget(target);
  if (blockReason) {
    return new Response(`Blocked target: ${blockReason}`, {
      status: 400,
      headers: corsHeaders(),
    });
  }

  // Only forward a safe subset of headers — don't leak cookies/auth to arbitrary hosts.
  // Range/if-* headers matter here since previewers may want partial GTFS zip fetches
  // or conditional re-fetches of the same release asset.
  const forwardHeaders = new Headers();
  const passthrough = [
    "accept",
    "accept-language",
    "range",
    "if-none-match",
    "if-modified-since",
  ];
  for (const h of passthrough) {
    const v = request.headers.get(h);
    if (v) forwardHeaders.set(h, v);
  }

  let upstream;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      upstream = await fetch(target.toString(), {
        method: request.method,
        headers: forwardHeaders,
        redirect: "manual", // handle redirects ourselves to re-validate each hop
        signal: controller.signal,
      });
      clearTimeout(timer);

      // GitHub release downloads redirect to objects.githubusercontent.com — follow
      // and re-validate each hop rather than trusting fetch's automatic redirect.
      let redirectCount = 0;
      while (
        [301, 302, 303, 307, 308].includes(upstream.status) &&
        redirectCount < MAX_REDIRECTS
      ) {
        const loc = upstream.headers.get("location");
        if (!loc) break;
        const nextTarget = new URL(loc, target);
        const nextBlock = validateTarget(nextTarget);
        if (nextBlock) {
          return new Response(`Blocked redirect target: ${nextBlock}`, {
            status: 400,
            headers: corsHeaders(),
          });
        }
        target = nextTarget;
        redirectCount++;
        const c2 = new AbortController();
        const t2 = setTimeout(() => c2.abort(), TIMEOUT_MS);
        upstream = await fetch(target.toString(), {
          method: request.method,
          headers: forwardHeaders,
          redirect: "manual",
          signal: c2.signal,
        });
        clearTimeout(t2);
      }

      break; // success (or non-retryable status) — exit retry loop
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const retryable = err.name === "AbortError" || isNetworkError(err);
      if (!retryable || attempt === MAX_ATTEMPTS) {
        return new Response(
          `Proxy fetch failed after ${attempt} attempt(s): ${err.message || err}`,
          { status: 502, headers: corsHeaders() }
        );
      }
      await new Promise((r) => setTimeout(r, 200 * attempt)); // brief backoff
    }
  }

  if (!upstream) {
    return new Response(`Proxy fetch failed: ${lastErr?.message ?? "unknown error"}`, {
      status: 502,
      headers: corsHeaders(),
    });
  }

  // Enforce a size cap so a single request can't stream something unbounded through the Worker
  const contentLength = upstream.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BYTES) {
    return new Response("Upstream response too large", {
      status: 502,
      headers: corsHeaders(),
    });
  }

  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie"); // never forward upstream cookies to the caller

  // Some CDN redirect targets (e.g. GitHub's objects.githubusercontent.com) omit or
  // mangle Content-Type — make sure zip downloads are labeled sensibly so the client
  // knows what it's dealing with.
  if (!headers.get("content-type") || headers.get("content-type") === "application/octet-stream") {
    if (target.pathname.toLowerCase().endsWith(".zip")) {
      headers.set("Content-Type", "application/zip");
    }
  }

  // Preserve/normalize Content-Length and Content-Disposition explicitly so the preview
  // app can show file size and suggested filename before/while downloading.
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }
  if (!headers.get("content-disposition")) {
    const filename = target.pathname.split("/").pop() || "download";
    headers.set("Content-Disposition", `inline; filename="${filename}"`);
  }

  // Surface that this came through a redirect chain and what the final resolved URL was —
  // useful for debugging when a GitHub release URL silently resolves elsewhere.
  headers.set("X-Proxy-Resolved-Url", target.toString());

  // Accept-Ranges lets the client do range requests against the proxy (e.g. to peek at
  // just the GTFS zip's central directory without pulling the whole file).
  if (!headers.get("accept-ranges")) {
    headers.set("Accept-Ranges", "bytes");
  }

  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function validateTarget(target) {
  if (!["http:", "https:"].includes(target.protocol)) {
    return "unsupported protocol";
  }
  const hostname = target.hostname.toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "localhost not allowed";
  }
  if (hostname === "169.254.169.254") {
    return "metadata endpoint not allowed";
  }
  if (isPrivateIp(hostname)) {
    return "private IP not allowed";
  }
  return null;
}

function isPrivateIp(hostname) {
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
  }
  if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd")) {
    return true; // IPv6 loopback / unique local
  }
  return false;
}

function isNetworkError(err) {
  return err instanceof TypeError; // fetch throws TypeError for network-level failures
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "*",
  };
}
