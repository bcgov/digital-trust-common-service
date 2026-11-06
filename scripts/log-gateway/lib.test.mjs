// Offline tests for the gateway verification tools. They need no gateway:
// they cover the benchmark verdict rules and the shared HTTP client against a
// local server, so a regression in either shows up before a deployed run.
import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';

import {
  evaluateVerdict,
  newTally,
  parsePeak,
  send,
  summarise,
  tallyAdd,
} from './lib.mjs';

const RUNS = 20;
const cleanCache = {
  entriesFound: 0,
  entriesRequested: 4,
  queryLengthServed: 0,
};

function phase(statuses, { cache = cleanCache, ms = 1000 } = {}) {
  const tally = newTally();

  for (const status of statuses) {
    tallyAdd(tally, {
      status,
      ms,
      cache: status === 200 ? cache : undefined,
    });
  }

  return summarise(tally);
}

const ok = (n) => Array(n).fill(200);

function inputs(overrides = {}) {
  return {
    baseline: phase(ok(RUNS), { ms: 1000 }),
    loaded: phase(ok(RUNS), { ms: 1500 }),
    noisy: phase(ok(30)),
    peak: 2,
    cap: 4,
    minSuccesses: RUNS,
    ...overrides,
  };
}

async function withServer(handler, run) {
  const server = http.createServer(handler);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('evaluateVerdict', () => {
  it('passes a clean run', () => {
    const result = evaluateVerdict(inputs());

    assert.equal(result.pass, true);
    assert.equal(result.ratio, 1.5);
  });

  it('never passes when every query failed', () => {
    const result = evaluateVerdict(
      inputs({
        baseline: phase(Array(RUNS).fill(500)),
        loaded: phase(Array(RUNS).fill(400)),
      }),
    );

    assert.equal(result.pass, false);
    assert.equal(result.baselineSamplesSufficient, false);
    assert.equal(result.loadedSamplesSufficient, false);
    assert.equal(result.latencyUnder10s, false);
    assert.equal(result.withinTwiceBaseline, false);
  });

  it('fails when too few samples succeeded', () => {
    const loaded = phase([...ok(RUNS - 1), 500]);

    assert.equal(evaluateVerdict(inputs({ loaded })).pass, false);
  });

  it('fails when the peak exceeds the cap', () => {
    const result = evaluateVerdict(inputs({ peak: 5, cap: 4 }));

    assert.equal(result.capacityCapHeld, false);
    assert.equal(result.pass, false);
  });

  it('fails when the peak was not recorded', () => {
    const result = evaluateVerdict(inputs({ peak: undefined }));

    assert.equal(result.capacityCapHeld, false);
    assert.equal(result.pass, false);
  });

  it('fails on a results-cache hit in any phase', () => {
    const hit = { ...cleanCache, entriesFound: 1 };

    for (const key of ['baseline', 'loaded', 'noisy']) {
      const result = evaluateVerdict(
        inputs({ [key]: phase(ok(RUNS), { cache: hit }) }),
      );

      assert.equal(result.noCacheHits, false, key);
      assert.equal(result.pass, false, key);
    }
  });

  it('fails when a 200 carries no cache stats', () => {
    const tally = newTally();

    for (let i = 0; i < RUNS; i += 1) {
      tallyAdd(tally, { status: 200, ms: 1000, cache: undefined });
    }

    assert.equal(
      evaluateVerdict(inputs({ loaded: summarise(tally) })).noCacheHits,
      false,
    );
  });

  it('fails when the noisy load collapsed', () => {
    const noisy = phase([...ok(10), ...Array(20).fill(429)]);
    const result = evaluateVerdict(inputs({ noisy }));

    assert.equal(result.noisyLoadSustained, false);
    assert.equal(result.pass, false);
  });

  it('fails when the noisy tenant never ran', () => {
    assert.equal(
      evaluateVerdict(inputs({ noisy: phase([]) })).noisyLoadSustained,
      false,
    );
  });
});

describe('send', () => {
  it('rejects when the connection drops mid-body', async () => {
    await withServer(
      (req, res) => {
        res.writeHead(200, { 'content-length': '100' });
        res.write('partial');
        setTimeout(() => res.socket.destroy(), 20);
      },
      async (base) => {
        await assert.rejects(send(`${base}/x`));
      },
    );
  });

  it('reports socket reuse on a pinned keep-alive agent', async () => {
    await withServer(
      (req, res) => res.end('{}'),
      async (base) => {
        const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
        const first = await send(`${base}/x`, { agent });
        const second = await send(`${base}/x`, { agent });

        agent.destroy();
        assert.equal(first.reusedSocket, false);
        assert.equal(second.reusedSocket, true);
      },
    );
  });

  it('sends rawPath untouched', async () => {
    const seen = [];

    await withServer(
      (req, res) => {
        seen.push(req.url);
        res.end('{}');
      },
      async (base) => {
        const paths = [
          '/loki/api/v1/../../metrics',
          '/loki/api/v1/%2e%2e/%2e%2e/metrics',
          '//loki/api/v1/query',
        ];

        for (const rawPath of paths) {
          await send(base, { rawPath });
        }

        assert.deepEqual(seen, paths);
      },
    );
  });
});

describe('parsePeak', () => {
  const series = (value) => ({ metric: {}, value: [0, value] });

  it('records the peak of exactly one series', () => {
    assert.deepEqual(parsePeak({ data: { result: [series('3')] } }), {
      recorded: true,
      peak: 3,
    });
  });

  it('does not record several series', () => {
    const parsed = parsePeak({ data: { result: [series('3'), series('1')] } });

    assert.equal(parsed.recorded, false);
    assert.match(parsed.note, /got 2/);
  });

  it('does not record an empty result', () => {
    const parsed = parsePeak({ data: { result: [] } });

    assert.equal(parsed.recorded, false);
    assert.match(parsed.note, /got 0/);
  });

  it('does not record a value that is not a number', () => {
    assert.equal(
      parsePeak({ data: { result: [series('NaN')] } }).recorded,
      false,
    );
  });
});
