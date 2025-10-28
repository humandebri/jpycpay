import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export type AssetStatus = { 'Active' : null } |
  { 'Disabled' : null } |
  { 'Deprecated' : null };
export interface InfoResponse {
  'relayer_addr' : string,
  'threshold_wei' : bigint,
  'gas_wei' : bigint,
}
export interface LogEntry {
  'id' : bigint,
  'to' : string,
  'ts' : bigint,
  'tx' : [] | [string],
  'status' : string,
  'value' : bigint,
  'from' : string,
  'fail_reason' : [] | [string],
}
export interface SubmitAuthorizationRequest {
  'to' : Uint8Array | number[],
  'valid_after' : bigint,
  'asset' : Principal,
  'valid_before' : bigint,
  'value' : bigint,
  'from' : Uint8Array | number[],
  'sig_r' : Uint8Array | number[],
  'sig_s' : Uint8Array | number[],
  'sig_v' : number,
  'nonce' : Uint8Array | number[],
}
export type SubmitAuthorizationResponse = { 'ok' : string } |
  { 'err' : string };
export interface _SERVICE {
  'add_asset' : ActorMethod<[Principal, string, bigint], undefined>,
  'deprecate_asset' : ActorMethod<[Principal], undefined>,
  'disable_asset' : ActorMethod<[Principal], undefined>,
  'get_relayer_address' : ActorMethod<[], [] | [string]>,
  'info' : ActorMethod<[], InfoResponse>,
  'logs' : ActorMethod<[[] | [bigint], number], Array<LogEntry>>,
  'pause' : ActorMethod<[boolean], undefined>,
  'refresh_gas_balance' : ActorMethod<
    [],
    { 'ok' : bigint } |
      { 'err' : string }
  >,
  'set_chain_id' : ActorMethod<[bigint], undefined>,
  'set_ecdsa_derivation_path' : ActorMethod<
    [Array<Uint8Array | number[]>],
    undefined
  >,
  'set_relayer_address' : ActorMethod<[string], undefined>,
  'set_rpc_target' : ActorMethod<[Principal, string], undefined>,
  'set_threshold' : ActorMethod<[bigint], undefined>,
  'submit_authorization' : ActorMethod<
    [SubmitAuthorizationRequest],
    SubmitAuthorizationResponse
  >,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
