import { RequestContextService } from '@app/common/context/request-context.service';

import {
  createRequestIdMiddleware,
  REQUEST_ID_HEADER,
} from './request-id.middleware';

describe('createRequestIdMiddleware', () => {
  let requestContext: RequestContextService;

  const buildReqRes = (headers: Record<string, string | string[]> = {}) => {
    const req = { headers } as unknown as Parameters<
      ReturnType<typeof createRequestIdMiddleware>
    >[0];
    const setHeader = jest.fn();
    const res = { setHeader } as unknown as Parameters<
      ReturnType<typeof createRequestIdMiddleware>
    >[1];
    const next = jest.fn();

    return { req, res, setHeader, next };
  };

  beforeEach(() => {
    requestContext = new RequestContextService();
  });

  it('generates a UUID and sets it as the response header when no header is present', () => {
    const { req, res, setHeader, next } = buildReqRes();
    const middleware = createRequestIdMiddleware(requestContext);

    middleware(req, res, next);

    expect(setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      ),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reuses a well-formed incoming X-Request-Id header', () => {
    const { req, res, setHeader, next } = buildReqRes({
      'x-request-id': 'client-supplied-id-123',
    });
    const middleware = createRequestIdMiddleware(requestContext);

    middleware(req, res, next);

    expect(setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      'client-supplied-id-123',
    );
  });

  it('regenerates a request id when the incoming header is malformed', () => {
    const { req, res, setHeader, next } = buildReqRes({
      'x-request-id': 'not valid! <script>',
    });
    const middleware = createRequestIdMiddleware(requestContext);

    middleware(req, res, next);

    const [, generatedId] = setHeader.mock.calls[0] as [string, string];
    expect(generatedId).not.toBe('not valid! <script>');
    expect(generatedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('regenerates a request id when the incoming header exceeds the length cap', () => {
    const { req, res, setHeader } = buildReqRes({
      'x-request-id': 'a'.repeat(129),
    });
    const middleware = createRequestIdMiddleware(requestContext);

    middleware(req, res, jest.fn());

    const [, generatedId] = setHeader.mock.calls[0] as [string, string];
    expect(generatedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('takes the first value when the header is duplicated', () => {
    const { req, res, setHeader } = buildReqRes({
      'x-request-id': ['first-id', 'second-id'],
    });
    const middleware = createRequestIdMiddleware(requestContext);

    middleware(req, res, jest.fn());

    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'first-id');
  });

  it('runs next() inside the request context store with the resolved request id', () => {
    const { req, res } = buildReqRes({ 'x-request-id': 'req-in-context' });
    const middleware = createRequestIdMiddleware(requestContext);
    let observedRequestId: string | undefined;

    middleware(req, res, () => {
      observedRequestId = requestContext.getRequestId();
    });

    expect(observedRequestId).toBe('req-in-context');
    expect(requestContext.get()).toBeUndefined();
  });
});
