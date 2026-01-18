export interface StatusValues {
  frameError: boolean;
  bitError: boolean;
  parityError: boolean;
  overflow: boolean;
  lost: boolean;
  sequenceNumber: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export interface SystemStatusValues {
  PROG?: false; // PROG should always be false as per your original logic
  LLM?: boolean;
  TLE?: boolean;
  ALE?: boolean;
  SE?: boolean;
  UE?: boolean;
  DM?: false; // DM should always be false as per your original logic
  PARITY?: boolean;
}
