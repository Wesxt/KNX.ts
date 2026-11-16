import { SecureRoutingTimer, SecureRoutingTimerState } from "../src/connection/SecureRoutingTimer";
import { TimerNotify } from "../src/core/KNXnetIPSecureStructures";

describe("SecureRoutingTimer Multicast State Machine (03_08_09 §2.2.2.3.2)", () => {
  const backboneKey = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
  const localSerial = Buffer.from("00fa00000001", "hex");
  const peerSerial = Buffer.from("00fa00000002", "hex");
  const plainRoutingInd = Buffer.from("0610053000112900bcd011590ade010081", "hex");

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("wraps and unwraps multicast frames, updates mc_timer forward on E05, and drops outdated E08 frames", () => {
    let fakeNow = 1000;
    const sentNotifies: Buffer[] = [];

    const localTimer = new SecureRoutingTimer({
      backboneKey,
      serialNumber: localSerial,
      latencyToleranceMs: 2000,
      initialTimerValue: 5000n,
      nowMs: () => fakeNow,
      randomFn: () => 0.5,
      onSendTimerNotify: (frame) => sentNotifies.push(frame),
    });

    const peerTimer = new SecureRoutingTimer({
      backboneKey,
      serialNumber: peerSerial,
      latencyToleranceMs: 2000,
      initialTimerValue: 8000n,
      nowMs: () => fakeNow,
      randomFn: () => 0.5,
    });

    localTimer.start(false);

    // Peer sends a frame with timer = 8000 (> local 5000) -> Event E05
    const wrappedNewer = peerTimer.wrapMulticastFrame(plainRoutingInd, Buffer.from("1234", "hex"));
    const unwrapped = localTimer.unwrapMulticastFrame(wrappedNewer);
    expect(unwrapped?.equals(plainRoutingInd)).toBe(true);
    expect(localTimer.getTimerValue()).toBe(8000n);

    // Outdated frame with timer = 5000 (<= 8000 - 2000) -> Event E08: discarded and transitions to SCHED_UPDATE
    const peerOld = new SecureRoutingTimer({
      backboneKey,
      serialNumber: peerSerial,
      initialTimerValue: 5000n,
      nowMs: () => fakeNow,
    });
    const outdatedTag = Buffer.from("beef", "hex");
    const wrappedOutdated = peerOld.wrapMulticastFrame(plainRoutingInd, outdatedTag);

    expect(localTimer.unwrapMulticastFrame(wrappedOutdated)).toBeNull();
    expect(localTimer.state).toBe(SecureRoutingTimerState.SCHED_UPDATE);

    // When notify_timer expires (E10 from SCHED_UPDATE -> Action A6 + A8 + A3),
    // localTimer sends a TIMER_NOTIFY repeating peerSerial and outdatedTag, and becomes TimeKeeper!
    sentNotifies.length = 0;
    jest.advanceTimersByTime(3000);
    expect(sentNotifies.length).toBeGreaterThanOrEqual(1);

    const parsedNotify = TimerNotify.fromBuffer(sentNotifies[0]);
    expect(parsedNotify.serialNumber.equals(peerSerial)).toBe(true);
    expect(parsedNotify.messageTag.equals(outdatedTag)).toBe(true);
    expect(localTimer.isTimeKeeper).toBe(true);
    expect(localTimer.state).toBe(SecureRoutingTimerState.SCHED_PERIODIC);

    // Receiving a newer TIMER_NOTIFY (E01) updates mc_timer and makes localTimer a TimeFollower again (A9)
    const newerNotify = TimerNotify.create(20000n, peerSerial, Buffer.from("cafe", "hex"), backboneKey).toBuffer();
    expect(localTimer.handleTimerNotify(newerNotify)).toBe(true);
    expect(localTimer.getTimerValue()).toBe(20000n);
    expect(localTimer.isTimeKeeper).toBe(false);

    // Changing the backbone key to a new value (E11) resets mc_timer to 0
    localTimer.setBackboneKey("f0e0d0c0b0a090807060504030201000");
    expect(localTimer.getTimerValue()).toBe(0n);

    localTimer.stop();
  });
});
