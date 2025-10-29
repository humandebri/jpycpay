import type { Principal } from "@dfinity/principal";

type CandidIDL = typeof import("@dfinity/candid").IDL;

export const idlFactory = ({ IDL }: { IDL: CandidIDL }) => {
  const InfoResponse = IDL.Record({
    relayer_addr: IDL.Text,
    threshold_wei: IDL.Nat,
    gas_wei: IDL.Nat,
    cycles_balance: IDL.Nat,
  });

  const LogEntry = IDL.Record({
    id: IDL.Nat64,
    to: IDL.Text,
    ts: IDL.Nat64,
    tx: IDL.Opt(IDL.Text),
    status: IDL.Text,
    value: IDL.Nat,
    from: IDL.Text,
    fail_reason: IDL.Opt(IDL.Text),
  });

  const Result = IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text });
  const Result_1 = IDL.Variant({ Ok: IDL.Text, Err: IDL.Text });

  const SubmitAuthorizationRequest = IDL.Record({
    to: IDL.Vec(IDL.Nat8),
    valid_after: IDL.Nat,
    asset: IDL.Principal,
    valid_before: IDL.Nat,
    value: IDL.Nat,
    from: IDL.Vec(IDL.Nat8),
    sig_r: IDL.Vec(IDL.Nat8),
    sig_s: IDL.Vec(IDL.Nat8),
    sig_v: IDL.Nat8,
    nonce: IDL.Vec(IDL.Nat8),
  });

  return IDL.Service({
    add_asset: IDL.Func([IDL.Principal, IDL.Text, IDL.Nat], [], []),
    deprecate_asset: IDL.Func([IDL.Principal], [], []),
    disable_asset: IDL.Func([IDL.Principal], [], []),
    derive_relayer_address: IDL.Func([], [Result_1], []),
    get_relayer_address: IDL.Func([], [IDL.Opt(IDL.Text)], ["query"]),
    info: IDL.Func([], [InfoResponse], ["query"]),
    logs: IDL.Func([IDL.Opt(IDL.Nat64), IDL.Nat32], [IDL.Vec(LogEntry)], ["query"]),
    pause: IDL.Func([IDL.Bool], [], []),
    refresh_gas_balance: IDL.Func([], [Result], []),
    set_chain_id: IDL.Func([IDL.Nat], [], []),
    set_ecdsa_derivation_path: IDL.Func([IDL.Vec(IDL.Vec(IDL.Nat8))], [], []),
    set_relayer_address: IDL.Func([IDL.Text], [], []),
    set_rpc_endpoint: IDL.Func([IDL.Text], [], []),
    set_threshold: IDL.Func([IDL.Nat], [], []),
    submit_authorization: IDL.Func([SubmitAuthorizationRequest], [Result_1], []),
  });
};

export interface InfoResponse {
  relayer_addr: string;
  threshold_wei: bigint;
  gas_wei: bigint;
  cycles_balance: bigint;
}

export interface LogEntry {
  id: bigint;
  to: string;
  ts: bigint;
  tx: [] | [string];
  status: string;
  value: bigint;
  from: string;
  fail_reason: [] | [string];
}

export type Result = { Ok: bigint } | { Err: string };
export type Result_1 = { Ok: string } | { Err: string };

export interface SubmitAuthorizationRequest {
  to: Uint8Array;
  valid_after: bigint;
  asset: Principal;
  valid_before: bigint;
  value: bigint;
  from: Uint8Array;
  sig_r: Uint8Array;
  sig_s: Uint8Array;
  sig_v: number;
  nonce: Uint8Array;
}

export interface InitArgs {
  daily_cap_token: [] | [bigint];
  ecdsa_key_name: string;
  priority_multiplier: [] | [number];
  ecdsa_derivation_path: [] | [Uint8Array[]];
  rate_limit_per_min: [] | [number];
  chain_id: [] | [bigint];
  threshold_wei: [] | [bigint];
  admins: Principal[];
  max_fee_multiplier: [] | [number];
}

export interface _SERVICE {
  add_asset: (arg_0: Principal, arg_1: string, arg_2: bigint) => Promise<void>;
  deprecate_asset: (arg_0: Principal) => Promise<void>;
  disable_asset: (arg_0: Principal) => Promise<void>;
  derive_relayer_address: () => Promise<Result_1>;
  get_relayer_address: () => Promise<[] | [string]>;
  info: () => Promise<InfoResponse>;
  logs: (arg_0: [] | [bigint], arg_1: number) => Promise<Array<LogEntry>>;
  pause: (arg_0: boolean) => Promise<void>;
  refresh_gas_balance: () => Promise<Result>;
  set_chain_id: (arg_0: bigint) => Promise<void>;
  set_ecdsa_derivation_path: (arg_0: Uint8Array[]) => Promise<void>;
  set_relayer_address: (arg_0: string) => Promise<void>;
  set_rpc_endpoint: (arg_0: string) => Promise<void>;
  set_threshold: (arg_0: bigint) => Promise<void>;
  submit_authorization: (arg_0: SubmitAuthorizationRequest) => Promise<Result_1>;
}
