export const idlFactory = ({ IDL }) => {
  const InfoResponse = IDL.Record({
    'relayer_addr' : IDL.Text,
    'threshold_wei' : IDL.Nat,
    'gas_wei' : IDL.Nat,
  });
  const LogEntry = IDL.Record({
    'id' : IDL.Nat64,
    'to' : IDL.Text,
    'ts' : IDL.Nat64,
    'tx' : IDL.Opt(IDL.Text),
    'status' : IDL.Text,
    'value' : IDL.Nat,
    'from' : IDL.Text,
    'fail_reason' : IDL.Opt(IDL.Text),
  });
  const SubmitAuthorizationRequest = IDL.Record({
    'to' : IDL.Vec(IDL.Nat8),
    'valid_after' : IDL.Nat,
    'asset' : IDL.Principal,
    'valid_before' : IDL.Nat,
    'value' : IDL.Nat,
    'from' : IDL.Vec(IDL.Nat8),
    'sig_r' : IDL.Vec(IDL.Nat8),
    'sig_s' : IDL.Vec(IDL.Nat8),
    'sig_v' : IDL.Nat8,
    'nonce' : IDL.Vec(IDL.Nat8),
  });
  const SubmitAuthorizationResponse = IDL.Variant({
    'ok' : IDL.Text,
    'err' : IDL.Text,
  });
  return IDL.Service({
    'add_asset' : IDL.Func([IDL.Principal, IDL.Text, IDL.Nat], [], []),
    'deprecate_asset' : IDL.Func([IDL.Principal], [], []),
    'disable_asset' : IDL.Func([IDL.Principal], [], []),
    'get_relayer_address' : IDL.Func([], [IDL.Opt(IDL.Text)], ['query']),
    'info' : IDL.Func([], [InfoResponse], ['query']),
    'logs' : IDL.Func(
        [IDL.Opt(IDL.Nat64), IDL.Nat32],
        [IDL.Vec(LogEntry)],
        ['query'],
      ),
    'pause' : IDL.Func([IDL.Bool], [], []),
    'refresh_gas_balance' : IDL.Func(
        [],
        [IDL.Variant({ 'ok' : IDL.Nat, 'err' : IDL.Text })],
        [],
      ),
    'set_chain_id' : IDL.Func([IDL.Nat], [], []),
    'set_ecdsa_derivation_path' : IDL.Func(
        [IDL.Vec(IDL.Vec(IDL.Nat8))],
        [],
        [],
      ),
    'set_relayer_address' : IDL.Func([IDL.Text], [], []),
    'set_rpc_target' : IDL.Func([IDL.Principal, IDL.Text], [], []),
    'set_threshold' : IDL.Func([IDL.Nat], [], []),
    'submit_authorization' : IDL.Func(
        [SubmitAuthorizationRequest],
        [SubmitAuthorizationResponse],
        [],
      ),
  });
};
export const init = ({ IDL }) => { return []; };
