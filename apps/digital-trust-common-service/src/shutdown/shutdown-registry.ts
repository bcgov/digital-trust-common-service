import { Injectable } from '@nestjs/common';

// Interface for components that participate in the shutdown process
export interface ShutdownParticipant {
  /**
   * Higher numbers shut down first (higher priority).
   */
  readonly order: number;

  /**
   * Used for logging.
   */
  readonly name: string;

  /**
   * Perform the shutdown process.
   * @param signal The shutdown signal received.
   */
  shutdown(this: void, signal?: string): Promise<void>;
}

@Injectable()
export class ShutdownRegistry {
  private readonly participants: ShutdownParticipant[] = [];

  public register(participant: ShutdownParticipant): void {
    this.participants.push(participant);
  }

  public getParticipants(): readonly ShutdownParticipant[] {
    return [...this.participants].sort((a, b) => b.order - a.order);
  }
}
