import { ShutdownParticipant, ShutdownRegistry } from './shutdown-registry';

describe('ShutdownRegistry', () => {
  let registry: ShutdownRegistry;

  beforeEach(() => {
    registry = new ShutdownRegistry();
  });

  it('should be defined', () => {
    expect(registry).toBeDefined();
  });

  describe('register', () => {
    it('should register a participant', () => {
      const participant: ShutdownParticipant = {
        order: 1,
        name: 'TestParticipant',
        shutdown: jest.fn(),
      };

      registry.register(participant);

      const participants = registry.getParticipants();
      expect(participants).toContain(participant);
    });

    it('should register multiple participants', () => {
      const participant1: ShutdownParticipant = {
        order: 1,
        name: 'Participant1',
        shutdown: jest.fn(),
      };

      const participant2: ShutdownParticipant = {
        order: 2,
        name: 'Participant2',
        shutdown: jest.fn(),
      };

      registry.register(participant1);
      registry.register(participant2);

      const participants = registry.getParticipants();
      expect(participants).toHaveLength(2);
      expect(participants).toContain(participant1);
      expect(participants).toContain(participant2);
    });
  });

  describe('getParticipants', () => {
    it('should return an empty array when no participants registered', () => {
      const participants = registry.getParticipants();
      expect(participants).toEqual([]);
    });

    it('should return participants sorted by order in descending order (highest priority first)', () => {
      const participant3: ShutdownParticipant = {
        order: 3,
        name: 'Third',
        shutdown: jest.fn(),
      };

      const participant1: ShutdownParticipant = {
        order: 1,
        name: 'First',
        shutdown: jest.fn(),
      };

      const participant2: ShutdownParticipant = {
        order: 2,
        name: 'Second',
        shutdown: jest.fn(),
      };

      registry.register(participant3);
      registry.register(participant1);
      registry.register(participant2);

      const participants = registry.getParticipants();
      expect(participants).toEqual([participant3, participant2, participant1]);
    });

    it('should handle participants with the same order', () => {
      const participant1: ShutdownParticipant = {
        order: 1,
        name: 'First',
        shutdown: jest.fn(),
      };

      const participant2: ShutdownParticipant = {
        order: 1,
        name: 'AlsoFirst',
        shutdown: jest.fn(),
      };

      registry.register(participant1);
      registry.register(participant2);

      const participants = registry.getParticipants();
      expect(participants).toHaveLength(2);
      expect(participants[0].order).toBe(1);
      expect(participants[1].order).toBe(1);
    });

    it('should handle negative order values', () => {
      const participant1: ShutdownParticipant = {
        order: -1,
        name: 'Negative',
        shutdown: jest.fn(),
      };

      const participant2: ShutdownParticipant = {
        order: 1,
        name: 'Positive',
        shutdown: jest.fn(),
      };

      registry.register(participant2);
      registry.register(participant1);

      const participants = registry.getParticipants();
      expect(participants[0]).toBe(participant2);
      expect(participants[1]).toBe(participant1);
    });

    it('should return a new array, not the original', () => {
      const participant: ShutdownParticipant = {
        order: 1,
        name: 'Test',
        shutdown: jest.fn(),
      };

      registry.register(participant);

      const participants1 = registry.getParticipants();
      const participants2 = registry.getParticipants();

      expect(participants1).not.toBe(participants2);
      expect(participants1).toEqual(participants2);
    });
  });
});
