// Fairness benchmark (contract test N37, Rule L11 reference benchmark).
//
// A different service tenant (the "noisy" one) continuously saturates its
// concurrency allowance with reference queries through the deployed gateway
// while the "victim" tenant issues the same reference query at a steady pace.
// The victim is first measured alone to get the uncontended baseline.
//
//   LOG_GATEWAY_URL=... npm run benchmark:log-gateway
//
// The result is printed as JSON for pasting onto the tracking issue. This tool
// measures and reports; it does not enforce any capacity limit. Passing needs
// both the latency target and the capacity cap, so the noisy tenant's peak
// concurrent sub-queries (PROM_URL / PROM_PEAK_QUERY) is required: a run with
// no peak fails.
import {
  clientFromEnv,
  env,
  evaluateVerdict,
  fetchToken,
  lokiRangeParams,
  newTally,
  parsePeak,
  requireEnv,
  resultCacheStats,
  send,
  sleep,
  summarise,
  tallyAdd,
} from './lib.mjs';

const GATEWAY_URL = requireEnv('LOG_GATEWAY_URL').replace(/\/$/, '');
const TOKEN_URL = requireEnv('TOKEN_URL');
const AUDIENCE = requireEnv('LOG_GATEWAY_AUDIENCE');
const QUERY = requireEnv('BENCH_QUERY');
// L11 wants the maximum L10 permits. These defaults are dev's limits_config
// (max_query_length 168h, max_entries_limit_per_query 2000); confirm both from
// the target environment's live config, because a value above the entry limit
// is answered with a 400 on every request.
const RANGE_HOURS = Number(env('BENCH_RANGE_HOURS', '168'));
const ENTRY_LIMIT = Number(env('BENCH_ENTRY_LIMIT', '2000'));
const NOISY_CONCURRENCY = Number(env('BENCH_NOISY_CONCURRENCY', '8'));
const RUNS = Math.max(20, Number(env('BENCH_RUNS', '20')));
const WINDOW_MS =
  Math.max(10, Number(env('BENCH_WINDOW_MINUTES', '10'))) * 60_000;
// A label for the report only; nothing here verifies the scope size.
const SCOPE_PARTITIONS = Number(env('BENCH_SCOPE_PARTITIONS', '2'));
const QUERIER_REPLICAS = Number(requireEnv('BENCH_QUERIER_REPLICAS'));
const QUERIER_CONCURRENCY = Number(requireEnv('BENCH_QUERIER_CONCURRENCY'));

if (
  !Number.isFinite(QUERIER_REPLICAS) ||
  !Number.isFinite(QUERIER_CONCURRENCY) ||
  QUERIER_REPLICAS <= 0 ||
  QUERIER_CONCURRENCY <= 0
) {
  throw new Error(
    'BENCH_QUERIER_REPLICAS and BENCH_QUERIER_CONCURRENCY must be positive numbers',
  );
}

// No service tenant may hold more than a third of total query capacity.
const CAPACITY_CAP = (QUERIER_REPLICAS * QUERIER_CONCURRENCY) / 3;

const victim = clientFromEnv('TENANT_B', TOKEN_URL);
const noisy = clientFromEnv('TENANT_A', TOKEN_URL);

if (!victim || !noisy) {
  throw new Error('TENANT_A_* (noisy) and TENANT_B_* (victim) are required');
}

async function referenceQuery(client) {
  let started = performance.now();

  try {
    const token = await fetchToken({
      ...client,
      scope: 'logs:read',
      resource: AUDIENCE,
    });

    started = performance.now();

    const params = lokiRangeParams({
      query: QUERY,
      lookbackMinutes: RANGE_HOURS * 60,
      limit: ENTRY_LIMIT,
    });
    // Cache-Control: no-cache does not bypass Loki's results cache, and plain
    // log selectors do not use it at all (entriesRequested stays 0) while
    // metric and filtered queries do. The stats of every response are the
    // evidence, and any cache hit fails the verdict.
    const res = await send(`${GATEWAY_URL}/loki/api/v1/query_range?${params}`, {
      headers: {
        authorization: `Bearer ${token}`,
        'cache-control': 'no-cache',
      },
      timeoutMs: 120_000,
    });

    return {
      ms: performance.now() - started,
      status: res.status,
      cache: res.status === 200 ? resultCacheStats(res.json) : undefined,
    };
  } catch {
    return { ms: performance.now() - started, status: 0, cache: undefined };
  }
}

async function measureVictim(durationMs) {
  const tally = newTally();
  const gap = durationMs / RUNS;
  const started = Date.now();
  const deadline = started + durationMs;
  const hardStop = started + 2 * durationMs;

  // Failures do not count towards RUNS, so the run is extended for more
  // successes, but never past twice the window.
  while (
    (tally.successMs.length < RUNS || Date.now() < deadline) &&
    Date.now() < hardStop
  ) {
    const iterationStarted = Date.now();

    tallyAdd(tally, await referenceQuery(victim));
    await sleep(Math.max(0, gap - (Date.now() - iterationStarted)));
  }

  return tally;
}

async function peakSubqueries(startedAt) {
  const promUrl = env('PROM_URL');
  const promQuery = env('PROM_PEAK_QUERY');

  if (!promUrl || !promQuery) {
    return { recorded: false, note: 'set PROM_URL and PROM_PEAK_QUERY' };
  }

  try {
    const seconds = Math.ceil((Date.now() - startedAt) / 1000);
    const params = new URLSearchParams({
      query: `max_over_time((${promQuery})[${seconds}s:15s])`,
    });
    const res = await send(
      `${promUrl.replace(/\/$/, '')}/api/v1/query?${params}`,
      { headers: env('PROM_AUTH') ? { authorization: env('PROM_AUTH') } : {} },
    );
    const parsed = parsePeak(res.json);

    return parsed.recorded
      ? parsed
      : { ...parsed, note: `${parsed.note} (HTTP ${res.status})` };
  } catch (error) {
    return { recorded: false, note: `lookup failed: ${error.message}` };
  }
}

console.error(
  `baseline: victim alone, ${RUNS}+ runs over ${WINDOW_MS / 60_000} min`,
);
const baseline = summarise(await measureVictim(WINDOW_MS));

console.error('loaded: noisy tenant saturating its concurrency allowance');
const loadStarted = Date.now();
const noisyTally = newTally();
let stop = false;
const noisyWorkers = Array.from({ length: NOISY_CONCURRENCY }, async () => {
  while (!stop) {
    const sample = await referenceQuery(noisy);

    tallyAdd(noisyTally, sample);

    // A refused or failing query returns at once, so without this pause the
    // worker would spin and the decision endpoint's 120 requests a minute per
    // tenant would be spent on rejections.
    if (sample.status !== 200) {
      await sleep(1000);
    }
  }
});
const loaded = summarise(await measureVictim(WINDOW_MS));

stop = true;
await Promise.all(noisyWorkers);

const noisySummary = summarise(noisyTally);

// Printed before the Prometheus lookup so a late failure cannot lose the run.
console.error(
  JSON.stringify({ interim: true, baseline, loaded, noisy: noisySummary }),
);

const peak = await peakSubqueries(loadStarted);
const verdict = evaluateVerdict({
  baseline,
  loaded,
  noisy: noisySummary,
  peak: peak.peak,
  cap: CAPACITY_CAP,
  minSuccesses: RUNS,
});

console.log(
  JSON.stringify(
    {
      date: new Date().toISOString(),
      gateway: GATEWAY_URL,
      scopePartitionsLabel: SCOPE_PARTITIONS,
      rangeHours: RANGE_HOURS,
      entryLimit: ENTRY_LIMIT,
      noisyConcurrency: NOISY_CONCURRENCY,
      capacityCap: {
        querierReplicas: QUERIER_REPLICAS,
        perQuerierConcurrency: QUERIER_CONCURRENCY,
        cap: CAPACITY_CAP,
      },
      baseline,
      loaded,
      noisy: noisySummary,
      peakConcurrentSubqueriesNoisyTenant: peak,
      verdict,
      pass: verdict.pass,
    },
    null,
    2,
  ),
);

process.exitCode = verdict.pass ? 0 : 1;
