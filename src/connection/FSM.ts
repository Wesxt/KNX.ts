/**
 * A generic, lightweight Finite State Machine (FSM) engine.
 *
 * This utility decouples state transition management from actual connection logic,
 * allowing each KNX service type to define its own states, events, and transitions
 * without violating the Single Responsibility Principle.
 *
 * @template TState - Union of string literals representing the machine's states.
 * @template TEvent - Union of string literals representing the machine's events.
 */
export class FSM<TState extends string, TEvent extends string> {
  private currentState: TState;
  private readonly transitions: Record<TState, Partial<Record<TEvent, TState>>>;
  private readonly onStateChange: (newState: TState, oldState: TState) => void | Promise<void>;

  /**
   * Creates an FSM instance.
   *
   * @param initialState - The starting state of the FSM.
   * @param transitions - The transition table mapping states and events to next states.
   * @param onStateChange - Callback executed whenever a state transition successfully occurs.
   */
  constructor(
    initialState: TState,
    transitions: Record<TState, Partial<Record<TEvent, TState>>>,
    onStateChange: (newState: TState, oldState: TState) => void | Promise<void>
  ) {
    this.currentState = initialState;
    this.transitions = transitions;
    this.onStateChange = onStateChange;
  }

  /**
   * Returns the current state.
   */
  public get state(): TState {
    return this.currentState;
  }

  /**
   * Attempts to execute a state transition based on the provided event.
   *
   * @param event - The event triggering the transition.
   * @returns `true` if the transition is valid and was executed, `false` otherwise.
   */
  public transition(event: TEvent): boolean {
    const nextState = this.transitions[this.currentState]?.[event];
    if (nextState) {
      const oldState = this.currentState;
      this.currentState = nextState;
      try {
        const result = this.onStateChange(nextState, oldState);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error(`[FSM Promise Error] failed in state change from ${oldState} to ${nextState}:`, err);
          });
        }
      } catch (err) {
        console.error(`[FSM Callback Error] failed during state change from ${oldState} to ${nextState}:`, err);
      }
      return true;
    }
    return false;
  }

  /**
   * Forcefully overrides the current state without triggering transitions or callbacks.
   * Useful during error states or manual cleanups.
   */
  public forceState(state: TState): void {
    this.currentState = state;
  }
}
