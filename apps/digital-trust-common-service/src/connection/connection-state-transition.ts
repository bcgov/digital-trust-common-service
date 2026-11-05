import { connectionStatesBelow } from '../protocol-state-change/state-mapping';

import { Connection, ConnectionState } from './connection.entity';

export async function transitionConnectionState(
  target: ConnectionState,
  write: (
    state: ConnectionState,
    fromStates: ConnectionState[],
  ) => Promise<Connection | null>,
): Promise<{ connection: Connection | null; established: boolean }> {
  // Claim ACTIVE even when the backend skips it; both writes share a transaction.
  const active =
    target === ConnectionState.COMPLETED
      ? await write(
          ConnectionState.ACTIVE,
          connectionStatesBelow(ConnectionState.ACTIVE),
        )
      : null;
  const updated = await write(target, connectionStatesBelow(target));
  return {
    connection: updated ?? active,
    established:
      active !== null ||
      (updated !== null && target === ConnectionState.ACTIVE),
  };
}
