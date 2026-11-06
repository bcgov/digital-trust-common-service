// Shared helpers for the deployed log gateway verification tools
// (isolation.test.mjs and fairness-benchmark.mjs). Dependency-free on purpose:
// the tools run from a laptop or CI job pointed at a deployed environment, not
// inside the Nest application.
import http from 'node:http';
import https from 'node:https';

export function env(name, fallback) {
  const value = process.env[name];

  if (value === undefined || value === '') {
    return fallback;
  }

  return value;
}

export function requireEnv(name) {
  const value = env(name);

  if (value === undefined) {
    throw new Error(`${name} is required`);
  }

  return value;
}

/**
 * Minimal HTTP client. Always settles: a connection that is reset, aborted or
 * closed before the body ends rejects instead of hanging the caller.
 *
 * - `agent` pins requests to one keep-alive connection (N9).
 * - `rawPath` is sent as the request target untouched. `new URL()` collapses
 *   `..` and resolves `%2e%2e`, which would hide the very paths the allowlist
 *   tests exist to send.
 * - `reusedSocket` reports whether the request went out on a socket an earlier
 *   request had already used.
 */
export function send(urlString, options = {}) {
  const url = new URL(urlString);
  const transport = url.protocol === 'https:' ? https : http;
  const body = options.body;
  const headers = { ...(options.headers ?? {}) };

  if (body !== undefined) {
    headers['content-length'] = Buffer.byteLength(body);
  }

  const requestOptions = {
    method: options.method ?? 'GET',
    headers,
    agent: options.agent,
    timeout: options.timeoutMs ?? 90_000,
  };

  if (options.rawPath !== undefined) {
    requestOptions.protocol = url.protocol;
    requestOptions.hostname = url.hostname;
    requestOptions.port = url.port || undefined;
    requestOptions.path = options.rawPath;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        fn(value);
      }
    };

    const onResponse = (res) => {
      const chunks = [];
      let ended = false;

      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', (error) => settle(reject, error));
      res.on('aborted', () =>
        settle(reject, new Error('response aborted before the body ended')),
      );
      res.on('close', () => {
        if (!ended) {
          settle(reject, new Error('connection closed before the body ended'));
        }
      });
      res.on('end', () => {
        ended = true;

        const text = Buffer.concat(chunks).toString('utf8');
        let json;

        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }

        settle(resolve, {
          status: res.statusCode,
          headers: res.headers,
          text,
          json,
          reusedSocket: req.reusedSocket === true,
        });
      });
    };

    const req =
      options.rawPath !== undefined
        ? transport.request(requestOptions, onResponse)
        : transport.request(url, requestOptions, onResponse);

    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', (error) => settle(reject, error));

    if (body !== undefined) {
      req.write(body);
    }

    req.end();
  });
}

const tokenCache = new Map();

/**
 * client_credentials token for one OAuth client. `resource` selects the
 * audience; omit it to get an ordinary API-audience token. Cached until just
 * before expiry so a long benchmark does not hammer the token endpoint.
 */
export async function fetchToken({
  tokenUrl,
  clientId,
  clientSecret,
  scope,
  resource,
}) {
  const cacheKey = [tokenUrl, clientId, scope, resource ?? ''].join('|');
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    scope,
  });

  if (resource) {
    form.set('resource', resource);
  }

  const res = await send(tokenUrl, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  if (res.status !== 200 || typeof res.json?.access_token !== 'string') {
    throw new Error(
      `token request for client ${clientId} failed with HTTP ${res.status}`,
    );
  }

  tokenCache.set(cacheKey, {
    token: res.json.access_token,
    expiresAt: Date.now() + Number(res.json.expires_in ?? 60) * 1000,
  });

  return res.json.access_token;
}

/** Token options for a client described by `<PREFIX>_CLIENT_ID/SECRET`. */
export function clientFromEnv(prefix, tokenUrl) {
  const clientId = env(`${prefix}_CLIENT_ID`);
  const clientSecret = env(`${prefix}_CLIENT_SECRET`);

  if (!clientId || !clientSecret) {
    return undefined;
  }

  return { tokenUrl, clientId, clientSecret };
}

export function lokiRangeParams({ query, lookbackMinutes, limit = 1000 }) {
  const end = BigInt(Date.now()) * 1_000_000n;
  const start = end - BigInt(lookbackMinutes) * 60n * 1_000_000_000n;

  return new URLSearchParams({
    query,
    start: start.toString(),
    end: end.toString(),
    limit: String(limit),
    direction: 'backward',
  });
}

/**
 * Reads the peak from a Prometheus instant-query response. A peak is recorded
 * only when exactly one series came back with a finite value; several series
 * would mean the query was not aggregated for the tenant.
 */
export function parsePeak(json) {
  const result = json?.data?.result;
  const count = Array.isArray(result) ? result.length : 0;

  if (count !== 1) {
    return {
      recorded: false,
      note: `expected exactly one series, got ${count}`,
    };
  }

  const value = Number(result[0]?.value?.[1]);

  return Number.isFinite(value)
    ? { recorded: true, peak: value }
    : { recorded: false, note: 'the series has no finite value' };
}

export function percentile(values, p) {
  if (values.length === 0) {
    return Number.NaN;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;

  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Results-cache counters from a Loki query response. Loki serialises
 * `stats.Caches` as `cache` (pkg/logqlmodel/stats, v3.7), and each entry carries
 * `entriesFound`, `entriesRequested` and `queryLengthServed`. Returns
 * undefined when the response has no such stats, which the verdict treats as a
 * failure: a run that cannot show it missed the cache proves nothing.
 */
export function resultCacheStats(json) {
  const result = json?.data?.stats?.cache?.result;

  if (!result || typeof result.entriesFound !== 'number') {
    return undefined;
  }

  return {
    entriesFound: result.entriesFound,
    entriesRequested: Number(result.entriesRequested ?? 0),
    queryLengthServed: Number(result.queryLengthServed ?? 0),
  };
}

export function newTally() {
  return {
    total: 0,
    byStatus: {},
    successMs: [],
    cache: {
      entriesFound: 0,
      entriesRequested: 0,
      queryLengthServed: 0,
      statsMissing: 0,
    },
  };
}

/**
 * Records one query. `sample.status` is the HTTP status, or 0 when no
 * response arrived. Only a 200 is a success.
 */
export function tallyAdd(tally, sample) {
  const key = sample.status === 0 ? 'error' : String(sample.status);

  tally.total += 1;
  tally.byStatus[key] = (tally.byStatus[key] ?? 0) + 1;

  if (sample.status !== 200) {
    return;
  }

  tally.successMs.push(sample.ms);

  if (sample.cache === undefined) {
    tally.cache.statsMissing += 1;
    return;
  }

  tally.cache.entriesFound += sample.cache.entriesFound;
  tally.cache.entriesRequested += sample.cache.entriesRequested;
  tally.cache.queryLengthServed += sample.cache.queryLengthServed;
}

/** p95 is computed from successful samples only. */
export function summarise(tally) {
  const successes = tally.successMs.length;

  return {
    attempts: tally.total,
    successes,
    p95Ms: successes > 0 ? Math.round(percentile(tally.successMs, 95)) : null,
    errorRate: tally.total > 0 ? (tally.total - successes) / tally.total : 1,
    byStatus: tally.byStatus,
    cache: tally.cache,
  };
}

const cacheClean = (cache) =>
  cache.statsMissing === 0 &&
  cache.entriesFound === 0 &&
  cache.queryLengthServed === 0;

/**
 * The pass/fail rules of the L11 benchmark, kept pure so they can be tested
 * without a gateway. `baseline`, `loaded` and `noisy` are `summarise()` output.
 *
 * `noisyMaxNon200Share` is a judgement call, not a contract value. The
 * decision endpoint allows 120 requests a minute per tenant, so a noisy
 * tenant whose queries are refused or fail fast is not saturating anything,
 * and the victim's good latency would then say nothing about contention.
 */
export function evaluateVerdict({
  baseline,
  loaded,
  noisy,
  peak,
  cap,
  minSuccesses,
  targetP95Ms = 10_000,
  targetRatio = 2,
  noisyMaxNon200Share = 0.1,
}) {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const noisySuccesses = noisy.byStatus['200'] ?? 0;
  const noisyNon200Share =
    noisy.attempts > 0 ? (noisy.attempts - noisySuccesses) / noisy.attempts : 1;
  const ratio =
    finite(loaded.p95Ms) && finite(baseline.p95Ms) && baseline.p95Ms > 0
      ? loaded.p95Ms / baseline.p95Ms
      : null;
  const verdict = {
    baselineSamplesSufficient: baseline.successes >= minSuccesses,
    loadedSamplesSufficient: loaded.successes >= minSuccesses,
    latencyUnder10s: finite(loaded.p95Ms) && loaded.p95Ms <= targetP95Ms,
    withinTwiceBaseline: ratio !== null && ratio <= targetRatio,
    noErrorIncrease: loaded.errorRate <= baseline.errorRate,
    noCacheHits:
      cacheClean(baseline.cache) &&
      cacheClean(loaded.cache) &&
      cacheClean(noisy.cache),
    noisyLoadSustained:
      noisy.attempts > 0 && noisyNon200Share <= noisyMaxNon200Share,
    capacityCapHeld: finite(peak) && finite(cap) && peak <= cap,
  };

  return {
    ...verdict,
    ratio,
    pass: Object.values(verdict).every(Boolean),
  };
}
