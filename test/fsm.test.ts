import { FSM } from "../src/connection/FSM";
import { KNXTunnelingState, KNXTunnelingEvent } from "../src/connection/KNXTunneling";
import { KNXUSBState, KNXUSBEvent } from "../src/connection/KNXUSBConnection";
import { KNXServerState, KNXServerEvent } from "../src/connection/KNXnetIPServer";
import { TPUARTState, TPUARTEvent } from "../src/connection/TPUART";

describe("Generic FSM Engine", () => {
  it("should initialize with the correct initial state", () => {
    const fsm = new FSM<"A" | "B", "GO">("A", { A: {}, B: {} }, jest.fn());
    expect(fsm.state).toBe("A");
  });

  it("should transition correctly and fire callback", () => {
    const callback = jest.fn();
    const fsm = new FSM<"A" | "B", "GO">("A", { A: { GO: "B" }, B: {} }, callback);

    const success = fsm.transition("GO");
    expect(success).toBe(true);
    expect(fsm.state).toBe("B");
    expect(callback).toHaveBeenCalledWith("B", "A");
  });

  it("should reject invalid transitions and not fire callback", () => {
    const callback = jest.fn();
    const fsm = new FSM<"A" | "B", "GO">("A", { A: {}, B: {} }, callback);

    const success = fsm.transition("GO");
    expect(success).toBe(false);
    expect(fsm.state).toBe("A");
    expect(callback).not.toHaveBeenCalled();
  });

  it("should allow forcing state without callbacks", () => {
    const callback = jest.fn();
    const fsm = new FSM<"A" | "B", "GO">("A", { A: { GO: "B" }, B: {} }, callback);

    fsm.forceState("B");
    expect(fsm.state).toBe("B");
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("KNXTunneling FSM Config", () => {
  it("should follow the expected connection and disconnection lifecycle", () => {
    const cb = jest.fn();
    const fsm = new FSM<KNXTunnelingState, KNXTunnelingEvent>(
      KNXTunnelingState.DISCONNECTED,
      {
        [KNXTunnelingState.DISCONNECTED]: { [KNXTunnelingEvent.START]: KNXTunnelingState.CONNECTING },
        [KNXTunnelingState.CONNECTING]: {
          [KNXTunnelingEvent.CONNECTED]: KNXTunnelingState.CONNECTED,
          [KNXTunnelingEvent.CONNECTION_LOST]: KNXTunnelingState.RECONNECTING,
          [KNXTunnelingEvent.STOP]: KNXTunnelingState.DISCONNECTED,
        },
        [KNXTunnelingState.CONNECTED]: {
          [KNXTunnelingEvent.CONNECTION_LOST]: KNXTunnelingState.RECONNECTING,
          [KNXTunnelingEvent.STOP]: KNXTunnelingState.DISCONNECTED,
        },
        [KNXTunnelingState.RECONNECTING]: {
          [KNXTunnelingEvent.CONNECTED]: KNXTunnelingState.CONNECTED,
          [KNXTunnelingEvent.RETRY]: KNXTunnelingState.RECONNECTING,
          [KNXTunnelingEvent.FAIL_FATAL]: KNXTunnelingState.FAULTED,
          [KNXTunnelingEvent.STOP]: KNXTunnelingState.DISCONNECTED,
        },
        [KNXTunnelingState.FAULTED]: {
          [KNXTunnelingEvent.START]: KNXTunnelingState.CONNECTING,
          [KNXTunnelingEvent.STOP]: KNXTunnelingState.DISCONNECTED,
        },
      },
      cb,
    );

    expect(fsm.state).toBe(KNXTunnelingState.DISCONNECTED);

    // Normal connect -> disconnect flow
    fsm.transition(KNXTunnelingEvent.START);
    expect(fsm.state).toBe(KNXTunnelingState.CONNECTING);

    fsm.transition(KNXTunnelingEvent.CONNECTED);
    expect(fsm.state).toBe(KNXTunnelingState.CONNECTED);

    fsm.transition(KNXTunnelingEvent.STOP);
    expect(fsm.state).toBe(KNXTunnelingState.DISCONNECTED);

    // Reconnection flow
    fsm.transition(KNXTunnelingEvent.START);
    fsm.transition(KNXTunnelingEvent.CONNECTED);
    fsm.transition(KNXTunnelingEvent.CONNECTION_LOST);
    expect(fsm.state).toBe(KNXTunnelingState.RECONNECTING);

    // Retry loop
    fsm.transition(KNXTunnelingEvent.RETRY);
    expect(fsm.state).toBe(KNXTunnelingState.RECONNECTING);

    // Fatal failure
    fsm.transition(KNXTunnelingEvent.FAIL_FATAL);
    expect(fsm.state).toBe(KNXTunnelingState.FAULTED);

    // Restart from fault
    fsm.transition(KNXTunnelingEvent.START);
    expect(fsm.state).toBe(KNXTunnelingState.CONNECTING);
  });
});

describe("KNXUSBConnection FSM Config", () => {
  it("should follow the expected USB lifecycle", () => {
    const fsm = new FSM<KNXUSBState, KNXUSBEvent>(
      KNXUSBState.DISCONNECTED,
      {
        [KNXUSBState.DISCONNECTED]: { [KNXUSBEvent.START]: KNXUSBState.CONNECTING },
        [KNXUSBState.CONNECTING]: {
          [KNXUSBEvent.CONNECTED]: KNXUSBState.CONNECTED,
          [KNXUSBEvent.ERROR]: KNXUSBState.FAULTED,
          [KNXUSBEvent.STOP]: KNXUSBState.DISCONNECTED,
        },
        [KNXUSBState.CONNECTED]: {
          [KNXUSBEvent.ERROR]: KNXUSBState.FAULTED,
          [KNXUSBEvent.STOP]: KNXUSBState.DISCONNECTED,
        },
        [KNXUSBState.FAULTED]: {
          [KNXUSBEvent.START]: KNXUSBState.CONNECTING,
          [KNXUSBEvent.STOP]: KNXUSBState.DISCONNECTED,
        },
      },
      jest.fn(),
    );

    fsm.transition(KNXUSBEvent.START);
    fsm.transition(KNXUSBEvent.CONNECTED);
    expect(fsm.state).toBe(KNXUSBState.CONNECTED);

    fsm.transition(KNXUSBEvent.ERROR);
    expect(fsm.state).toBe(KNXUSBState.FAULTED);

    fsm.transition(KNXUSBEvent.START);
    expect(fsm.state).toBe(KNXUSBState.CONNECTING);
  });
});

describe("KNXnetIPServer FSM Config", () => {
  it("should follow the expected Server lifecycle", () => {
    const fsm = new FSM<KNXServerState, KNXServerEvent>(
      KNXServerState.STOPPED,
      {
        [KNXServerState.STOPPED]: { [KNXServerEvent.START]: KNXServerState.STARTING },
        [KNXServerState.STARTING]: {
          [KNXServerEvent.RUNNING]: KNXServerState.RUNNING,
          [KNXServerEvent.ERROR]: KNXServerState.FAULTED,
          [KNXServerEvent.STOP]: KNXServerState.STOPPED,
        },
        [KNXServerState.RUNNING]: {
          [KNXServerEvent.ERROR]: KNXServerState.FAULTED,
          [KNXServerEvent.STOP]: KNXServerState.STOPPED,
        },
        [KNXServerState.FAULTED]: {
          [KNXServerEvent.START]: KNXServerState.STARTING,
          [KNXServerEvent.STOP]: KNXServerState.STOPPED,
        },
      },
      jest.fn(),
    );

    fsm.transition(KNXServerEvent.START);
    fsm.transition(KNXServerEvent.RUNNING);
    expect(fsm.state).toBe(KNXServerState.RUNNING);

    fsm.transition(KNXServerEvent.STOP);
    expect(fsm.state).toBe(KNXServerState.STOPPED);
  });
});

describe("TPUART FSM Config", () => {
  it("should follow the expected TPUART serial handshake lifecycle", () => {
    const fsm = new FSM<TPUARTState, TPUARTEvent>(
      TPUARTState.DISCONNECTED,
      {
        [TPUARTState.DISCONNECTED]: { [TPUARTEvent.START]: TPUARTState.RESET_WAIT },
        [TPUARTState.RESET_WAIT]: {
          [TPUARTEvent.RESET_RECEIVED]: TPUARTState.SET_ADDR_WAIT,
          [TPUARTEvent.ERROR]: TPUARTState.ERROR,
          [TPUARTEvent.STOP]: TPUARTState.DISCONNECTED,
        },
        [TPUARTState.SET_ADDR_WAIT]: {
          [TPUARTEvent.ADDR_SET]: TPUARTState.GET_STATE_WAIT,
          [TPUARTEvent.ERROR]: TPUARTState.ERROR,
          [TPUARTEvent.STOP]: TPUARTState.DISCONNECTED,
        },
        [TPUARTState.GET_STATE_WAIT]: {
          [TPUARTEvent.STATE_RECEIVED]: TPUARTState.ONLINE,
          [TPUARTEvent.ERROR]: TPUARTState.ERROR,
          [TPUARTEvent.STOP]: TPUARTState.DISCONNECTED,
        },
        [TPUARTState.ONLINE]: {
          [TPUARTEvent.ERROR]: TPUARTState.ERROR,
          [TPUARTEvent.STOP]: TPUARTState.DISCONNECTED,
        },
        [TPUARTState.ERROR]: {
          [TPUARTEvent.START]: TPUARTState.RESET_WAIT,
          [TPUARTEvent.STOP]: TPUARTState.DISCONNECTED,
        },
      },
      jest.fn(),
    );

    // Simulating full startup handshake
    fsm.transition(TPUARTEvent.START);
    expect(fsm.state).toBe(TPUARTState.RESET_WAIT);

    fsm.transition(TPUARTEvent.RESET_RECEIVED);
    expect(fsm.state).toBe(TPUARTState.SET_ADDR_WAIT);

    fsm.transition(TPUARTEvent.ADDR_SET);
    expect(fsm.state).toBe(TPUARTState.GET_STATE_WAIT);

    fsm.transition(TPUARTEvent.STATE_RECEIVED);
    expect(fsm.state).toBe(TPUARTState.ONLINE);

    fsm.transition(TPUARTEvent.ERROR);
    expect(fsm.state).toBe(TPUARTState.ERROR);
  });
});
