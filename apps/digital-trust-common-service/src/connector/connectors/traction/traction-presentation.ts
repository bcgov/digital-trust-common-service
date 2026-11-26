import {
  NonRevocationInterval,
  PresentationExchange,
  PresentationExchangeState,
  PresentationRequest,
  RequestedAttribute,
  RequestedPredicate,
  ValidationError,
  validatePresentationRequest,
} from '@app/credential-ports';

interface AnonCredsProofRequest {
  readonly requested_attributes: Readonly<
    Record<
      string,
      { readonly name?: string; readonly names?: readonly string[] }
    >
  >;
  readonly requested_predicates: Readonly<
    Record<
      string,
      {
        readonly name: string;
        readonly p_type: string;
        readonly p_value: number;
      }
    >
  >;
}

interface AnonCredsRequestedProof {
  readonly revealed_attrs?: Readonly<Record<string, { readonly raw: string }>>;
  readonly revealed_attr_groups?: Readonly<
    Record<
      string,
      { readonly values: Readonly<Record<string, { readonly raw: string }>> }
    >
  >;
  readonly predicates?: Readonly<
    Record<string, { readonly sub_proof_index: number }>
  >;
}

export interface TractionPresentationRecord {
  readonly pres_ex_id: string;
  readonly connection_id?: string;
  readonly state: string;
  readonly verified?: string | boolean | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly error_msg?: string;
  readonly auto_remove_on_failure?: boolean;
  readonly by_format?: {
    readonly pres_request?: { readonly anoncreds?: AnonCredsProofRequest };
    readonly pres?: {
      readonly anoncreds?: {
        readonly requested_proof: AnonCredsRequestedProof;
      };
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertInterval(interval: NonRevocationInterval | undefined): void {
  if (interval === undefined) {
    return;
  }
  if (
    interval === null ||
    (interval.from === undefined && interval.to === undefined) ||
    [interval.from, interval.to].some(
      (bound) =>
        bound !== undefined && (!Number.isSafeInteger(bound) || bound < 0),
    ) ||
    (interval.from !== undefined &&
      interval.to !== undefined &&
      interval.from > interval.to)
  ) {
    throw new ValidationError(['Invalid non-revocation interval']);
  }
}

function selectionOptions(selection: RequestedAttribute | RequestedPredicate) {
  assertInterval(selection.nonRevoked);
  return {
    ...(selection.restrictions !== undefined
      ? { restrictions: selection.restrictions }
      : {}),
    ...(selection.nonRevoked !== undefined
      ? { non_revoked: selection.nonRevoked }
      : {}),
  };
}

export function buildTractionPresentationRequest(req: PresentationRequest) {
  const error = validatePresentationRequest(req);
  if (error) {
    throw error;
  }
  if (!req.connectionId?.trim()) {
    throw new ValidationError(['Traction proof requests require a connection']);
  }
  assertInterval(req.nonRevoked);
  if (
    req.nonce !== undefined &&
    (typeof req.nonce !== 'string' ||
      !/^[1-9][0-9]{0,24}$/.test(req.nonce) ||
      BigInt(req.nonce) >= 1n << 80n)
  ) {
    throw new ValidationError(['Invalid presentation request nonce']);
  }
  const predicates = req.requestedPredicates ?? [];
  if (
    predicates.some(
      (predicate) =>
        !['>=', '>', '<=', '<'].includes(predicate.pType) ||
        !Number.isInteger(predicate.pValue) ||
        predicate.pValue < -2147483648 ||
        predicate.pValue > 2147483647,
    )
  ) {
    throw new ValidationError([
      'Invalid AnonCreds predicate operator or threshold',
    ]);
  }
  return {
    connection_id: req.connectionId,
    presentation_request: {
      anoncreds: {
        name: req.name,
        version: '1.0',
        // Legacy port callers may omit the nonce; ACA-Py generates it then.
        ...(req.nonce !== undefined ? { nonce: req.nonce } : {}),
        requested_attributes: Object.fromEntries(
          req.requestedAttributes.map((attribute, index) => [
            `attribute_${index}`,
            { name: attribute.name, ...selectionOptions(attribute) },
          ]),
        ),
        requested_predicates: Object.fromEntries(
          predicates.map((predicate, index) => [
            `predicate_${index}`,
            {
              name: predicate.name,
              p_type: predicate.pType,
              p_value: predicate.pValue,
              ...selectionOptions(predicate),
            },
          ]),
        ),
        ...(req.nonRevoked !== undefined
          ? { non_revoked: req.nonRevoked }
          : {}),
      },
    },
    auto_verify: true,
    auto_remove: false,
    ...(req.comment !== undefined ? { comment: req.comment } : {}),
  };
}

export function mapTractionPresentation(
  record: TractionPresentationRecord,
): PresentationExchange {
  if (
    !record ||
    typeof record.pres_ex_id !== 'string' ||
    !record.pres_ex_id ||
    typeof record.state !== 'string'
  ) {
    throw new ValidationError(['Invalid presentation exchange response']);
  }
  const { state, verified } = mapPresentationState(record);
  const exchange: PresentationExchange = {
    id: record.pres_ex_id,
    externalId: record.pres_ex_id,
    connectionId: record.connection_id,
    state,
    verified,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    error:
      record.error_msg ??
      (state === PresentationExchangeState.Abandoned
        ? 'Presentation verification did not succeed'
        : undefined),
  };
  if (state !== PresentationExchangeState.Verified) {
    return exchange;
  }
  return { ...exchange, ...mapVerifiedProof(record) };
}

function mapPresentationState(record: TractionPresentationRecord): {
  state: PresentationExchangeState;
  verified: boolean | undefined;
} {
  const normalized = record.state.replaceAll('_', '-');
  let state = Object.values(PresentationExchangeState).find(
    (candidate) => (candidate as string) === normalized,
  );
  if (!state) {
    throw new ValidationError(['Unknown presentation exchange state']);
  }
  const verified =
    record.verified === 'true' || record.verified === true
      ? true
      : record.verified === 'false' || record.verified === false
        ? false
        : undefined;
  if (state === PresentationExchangeState.Done) {
    state =
      verified === true
        ? PresentationExchangeState.Verified
        : PresentationExchangeState.Abandoned;
  } else if (
    state === PresentationExchangeState.Verified &&
    verified !== true
  ) {
    throw new ValidationError([
      'Verified presentation has no successful verification',
    ]);
  }
  return { state, verified };
}

function mapVerifiedProof(
  record: TractionPresentationRecord,
): Pick<PresentationExchange, 'revealedAttributes' | 'predicates'> {
  const request = record.by_format?.pres_request?.anoncreds;
  const proof = record.by_format?.pres?.anoncreds?.requested_proof;
  if (
    !isRecord(request?.requested_attributes) ||
    !isRecord(request.requested_predicates) ||
    !isRecord(proof) ||
    (proof.revealed_attrs !== undefined && !isRecord(proof.revealed_attrs)) ||
    (proof.revealed_attr_groups !== undefined &&
      !isRecord(proof.revealed_attr_groups)) ||
    (proof.predicates !== undefined && !isRecord(proof.predicates))
  ) {
    throw new ValidationError([
      'Verified AnonCreds presentation is missing proof data',
    ]);
  }
  return {
    revealedAttributes: mapRevealedAttributes(request, proof),
    predicates: mapVerifiedPredicates(request, proof),
  };
}

function mapRevealedAttributes(
  request: AnonCredsProofRequest,
  proof: AnonCredsRequestedProof,
): NonNullable<PresentationExchange['revealedAttributes']> {
  const revealedAttributes: NonNullable<
    PresentationExchange['revealedAttributes']
  >[number][] = [];
  for (const [referent, attribute] of Object.entries(
    proof.revealed_attrs ?? {},
  )) {
    const name = request.requested_attributes[referent]?.name;
    if (
      typeof name !== 'string' ||
      !name ||
      typeof attribute?.raw !== 'string'
    ) {
      throw new ValidationError(['Invalid revealed attribute']);
    }
    revealedAttributes.push({ referent, name, value: attribute.raw });
  }
  for (const [referent, group] of Object.entries(
    proof.revealed_attr_groups ?? {},
  )) {
    if (!isRecord(group?.values)) {
      throw new ValidationError(['Invalid revealed attribute group']);
    }
    for (const [name, attribute] of Object.entries(group.values)) {
      if (
        !Array.isArray(request.requested_attributes[referent]?.names) ||
        !request.requested_attributes[referent].names?.includes(name) ||
        typeof attribute?.raw !== 'string'
      ) {
        throw new ValidationError(['Invalid revealed attribute group']);
      }
      revealedAttributes.push({ referent, name, value: attribute.raw });
    }
  }
  return revealedAttributes;
}

function mapVerifiedPredicates(
  request: AnonCredsProofRequest,
  proof: AnonCredsRequestedProof,
): NonNullable<PresentationExchange['predicates']> {
  return Object.entries(request.requested_predicates).map(
    ([referent, predicate]) => {
      const predicateProof = proof.predicates?.[referent];
      if (
        !isRecord(predicate) ||
        typeof predicate.name !== 'string' ||
        !predicate.name ||
        !['>=', '>', '<=', '<'].includes(predicate.p_type) ||
        !Number.isInteger(predicate.p_value) ||
        predicate.p_value < -2147483648 ||
        predicate.p_value > 2147483647 ||
        !predicateProof ||
        !Number.isInteger(predicateProof.sub_proof_index) ||
        predicateProof.sub_proof_index < 0
      ) {
        throw new ValidationError([
          'Verified presentation is missing a predicate',
        ]);
      }
      return {
        referent,
        name: predicate.name,
        pType: predicate.p_type,
        pValue: predicate.p_value,
        satisfied: true,
      };
    },
  );
}
