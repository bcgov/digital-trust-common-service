import { transitionConnectionState } from './connection-state-transition';
import { Connection, ConnectionState } from './connection.entity';

describe('transitionConnectionState', () => {
  it.each([
    [ConnectionState.INVITED, ConnectionState.ACTIVE, true, true],
    [ConnectionState.INVITED, ConnectionState.COMPLETED, true, true],
    [ConnectionState.ACTIVE, ConnectionState.COMPLETED, true, false],
    [ConnectionState.COMPLETED, ConnectionState.COMPLETED, false, false],
    [ConnectionState.ABANDONED, ConnectionState.COMPLETED, false, false],
    [ConnectionState.REQUESTED, ConnectionState.RESPONDED, true, false],
    [ConnectionState.REQUESTED, ConnectionState.ABANDONED, true, false],
  ])(
    'reports %s -> %s as transitioned=%s, established=%s',
    async (initial, target, transitioned, established) => {
      const connection = { state: initial } as Connection;
      const write = jest.fn(
        (state: ConnectionState, fromStates: ConnectionState[]) => {
          if (!fromStates.includes(connection.state)) {
            return Promise.resolve(null);
          }
          connection.state = state;
          return Promise.resolve(connection);
        },
      );
      const result = await transitionConnectionState(target, write);
      expect(result.established).toBe(established);
      expect(result.connection !== null).toBe(transitioned);
      expect(connection.state).toBe(transitioned ? target : initial);
    },
  );

  it('propagates a failed write so the caller rolls back its transaction', async () => {
    const error = new Error('write failed');
    await expect(
      transitionConnectionState(
        ConnectionState.COMPLETED,
        jest.fn().mockRejectedValue(error),
      ),
    ).rejects.toBe(error);
  });
});
