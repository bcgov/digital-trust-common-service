import {
  PresentationExchangeState,
  PresentationRequest,
  ValidationError,
} from '@app/credential-ports';

import {
  buildTractionPresentationRequest,
  mapTractionPresentation,
  TractionPresentationRecord,
} from './traction-presentation';

describe('Traction presentation mapping', () => {
  const request: PresentationRequest = {
    connectionId: 'connection',
    name: 'Identity proof',
    requestedAttributes: [{ name: 'name' }],
  };
  const record: TractionPresentationRecord = {
    pres_ex_id: 'proof',
    connection_id: 'connection',
    state: 'done',
    verified: 'true',
    created_at: 'created',
    updated_at: 'updated',
    by_format: {
      pres_request: {
        anoncreds: {
          requested_attributes: {
            attribute_0: { name: 'name' },
            group: { names: ['city', 'country'] },
          },
          requested_predicates: {
            predicate_0: { name: 'age', p_type: '>=', p_value: 18 },
          },
        },
      },
      pres: {
        anoncreds: {
          requested_proof: {
            revealed_attrs: { attribute_0: { raw: 'Alice' } },
            revealed_attr_groups: {
              group: {
                values: { city: { raw: 'Victoria' }, country: { raw: 'CA' } },
              },
            },
            predicates: { predicate_0: { sub_proof_index: 0 } },
          },
        },
      },
    },
  };

  it('maps restrictions, duplicate attribute names, predicates, comments and interval overrides', () => {
    const result = buildTractionPresentationRequest({
      ...request,
      comment: 'Please prove identity',
      nonRevoked: { from: 100, to: 200 },
      requestedAttributes: [
        {
          name: 'name',
          restrictions: [{ cred_def_id: 'definition-a' }],
          nonRevoked: { to: 150 },
        },
        { name: 'name', restrictions: [{ cred_def_id: 'definition-b' }] },
      ],
      requestedPredicates: [
        {
          name: 'age',
          pType: '>=',
          pValue: 18,
          restrictions: [{ schema_name: 'identity' }],
          nonRevoked: { from: 0, to: 200 },
        },
      ],
    });
    expect(result.presentation_request.anoncreds).toEqual({
      name: 'Identity proof',
      version: '1.0',
      non_revoked: { from: 100, to: 200 },
      requested_attributes: {
        attribute_0: {
          name: 'name',
          restrictions: [{ cred_def_id: 'definition-a' }],
          non_revoked: { to: 150 },
        },
        attribute_1: {
          name: 'name',
          restrictions: [{ cred_def_id: 'definition-b' }],
        },
      },
      requested_predicates: {
        predicate_0: {
          name: 'age',
          p_type: '>=',
          p_value: 18,
          restrictions: [{ schema_name: 'identity' }],
          non_revoked: { from: 0, to: 200 },
        },
      },
    });
    expect(result.comment).toBe('Please prove identity');
  });

  it.each(['>=', '>', '<=', '<'])('supports predicate operator %s', (pType) => {
    expect(
      buildTractionPresentationRequest({
        ...request,
        requestedPredicates: [{ name: 'age', pType, pValue: 18 }],
      }).presentation_request.anoncreds.requested_predicates,
    ).toEqual({
      predicate_0: { name: 'age', p_type: pType, p_value: 18 },
    });
  });

  it.each([
    ['=', 18],
    ['>=', 1.5],
    ['>=', NaN],
    ['>=', Infinity],
    ['>=', 2147483648],
    ['>=', -2147483649],
  ])('rejects unsupported predicate %s %p', (pType, pValue) => {
    expect(() =>
      buildTractionPresentationRequest({
        ...request,
        requestedPredicates: [{ name: 'age', pType, pValue }],
      }),
    ).toThrow(ValidationError);
  });

  it.each([
    {},
    { from: -1 },
    { to: 0.1 },
    { to: Infinity },
    { to: Number.MAX_SAFE_INTEGER + 1 },
    { from: 200, to: 100 },
  ])(
    'rejects invalid non-revocation interval %p at every scope',
    (nonRevoked) => {
      for (const invalid of [
        { ...request, nonRevoked },
        { ...request, requestedAttributes: [{ name: 'name', nonRevoked }] },
        {
          ...request,
          requestedPredicates: [
            { name: 'age', pType: '>=', pValue: 18, nonRevoked },
          ],
        },
      ]) {
        expect(() => buildTractionPresentationRequest(invalid)).toThrow(
          ValidationError,
        );
      }
    },
  );

  it.each([
    PresentationExchangeState.ProposalSent,
    PresentationExchangeState.ProposalReceived,
    PresentationExchangeState.RequestSent,
    PresentationExchangeState.RequestReceived,
    PresentationExchangeState.PresentationSent,
    PresentationExchangeState.PresentationReceived,
    PresentationExchangeState.Abandoned,
  ])('maps state %s including underscore wire spelling', (state) => {
    expect(
      mapTractionPresentation({
        ...record,
        state: state.replaceAll('-', '_'),
        verified: undefined,
      }),
    ).toMatchObject({
      id: 'proof',
      externalId: 'proof',
      state,
    });
  });

  it('extracts only verified revealed attributes and satisfied predicates', () => {
    expect(mapTractionPresentation(record)).toEqual({
      id: 'proof',
      externalId: 'proof',
      connectionId: 'connection',
      state: PresentationExchangeState.Verified,
      verified: true,
      createdAt: 'created',
      updatedAt: 'updated',
      error: undefined,
      revealedAttributes: [
        { referent: 'attribute_0', name: 'name', value: 'Alice' },
        { referent: 'group', name: 'city', value: 'Victoria' },
        { referent: 'group', name: 'country', value: 'CA' },
      ],
      predicates: [
        {
          referent: 'predicate_0',
          name: 'age',
          pType: '>=',
          pValue: 18,
          satisfied: true,
        },
      ],
    });
  });

  it.each(['false', false, undefined, null, 'invalid'])(
    'does not expose trusted results for done with verified %p',
    (verified) => {
      const exchange = mapTractionPresentation({ ...record, verified });
      expect(exchange.state).toBe(PresentationExchangeState.Abandoned);
      expect(exchange.revealedAttributes).toBeUndefined();
      expect(exchange.predicates).toBeUndefined();
      expect(exchange.error).toBe('Presentation verification did not succeed');
    },
  );

  it('does not expose proof data before verification completes', () => {
    expect(
      mapTractionPresentation({
        ...record,
        state: 'presentation-received',
        verified: undefined,
      }).revealedAttributes,
    ).toBeUndefined();
  });

  it('accepts a boolean verification result', () => {
    expect(mapTractionPresentation({ ...record, verified: true }).state).toBe(
      PresentationExchangeState.Verified,
    );
  });

  it('never promotes self-attested values to verified revealed attributes', () => {
    const selfAttested = {
      ...record,
      by_format: {
        pres_request: {
          anoncreds: {
            requested_attributes: { attribute_0: { name: 'name' } },
            requested_predicates: {},
          },
        },
        pres: {
          anoncreds: {
            requested_proof: {
              self_attested_attrs: { attribute_0: 'Untrusted' },
            },
          },
        },
      },
    };
    expect(mapTractionPresentation(selfAttested).revealedAttributes).toEqual(
      [],
    );
  });

  it('rejects revealed attributes whose referent was not requested', () => {
    expect(() =>
      mapTractionPresentation({
        ...record,
        by_format: {
          ...record.by_format,
          pres: {
            anoncreds: {
              requested_proof: {
                revealed_attrs: { unknown: { raw: 'Alice' } },
              },
            },
          },
        },
      }),
    ).toThrow(ValidationError);
  });

  it('preserves backend problem details', () => {
    expect(
      mapTractionPresentation({
        ...record,
        state: 'abandoned',
        error_msg: 'Holder declined',
      }).error,
    ).toBe('Holder declined');
  });

  it('rejects verified records without AnonCreds attachments', () => {
    expect(() =>
      mapTractionPresentation({ ...record, by_format: undefined }),
    ).toThrow(ValidationError);
  });

  it('rejects verified records missing a requested predicate proof', () => {
    expect(() =>
      mapTractionPresentation({
        ...record,
        by_format: {
          ...record.by_format,
          pres: { anoncreds: { requested_proof: { predicates: {} } } },
        },
      }),
    ).toThrow(ValidationError);
  });

  it.each(['unknown', 'invalid'])(
    'rejects unsupported state %s explicitly',
    (state) => {
      expect(() => mapTractionPresentation({ ...record, state })).toThrow(
        ValidationError,
      );
    },
  );
});
