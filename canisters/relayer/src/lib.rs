//! ICP Relayer canister skeleton for gasless JPYC transfers via EIP-3009.
//! This implementation sets up the persistent state, admin APIs, and an
//! entry point to submit authorizations. EVM RPC integration is modelled
//! via structured requests to the official EVM RPC canister.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

use candid::{CandidType, Nat, Principal};
use ic_cdk::api::call::call_with_payment128;
use ic_cdk::api::caller;
use ic_cdk::api::management_canister::ecdsa::{
    sign_with_ecdsa, EcdsaCurve, EcdsaKeyId, SignWithEcdsaArgument, SignWithEcdsaResponse,
};
use ic_cdk::api::time;
use ic_cdk::storage::{stable_restore, stable_save};
use ic_cdk::trap;
use ic_cdk_macros::{init, post_upgrade, pre_upgrade, query, update};
use num_bigint::BigUint;
use num_traits::ToPrimitive;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

type InternalResult<T> = std::result::Result<T, RelayError>;

thread_local! {
    static STATE: RefCell<Option<RelayerState>> = RefCell::new(None);
}

#[derive(Clone, Debug, Default, CandidType, Deserialize, Serialize)]
struct RelayerState {
    admins: BTreeSet<Principal>,
    config: RelayerConfig,
    assets: BTreeMap<Principal, AssetConfig>,
    rate_limit: RateLimitConfig,
    rate_state: RateLimitState,
    logs: Vec<PaymentLog>,
    next_log_id: u64,
    last_known_gas: Nat,
}

#[derive(Clone, Debug, Default, CandidType, Deserialize, Serialize)]
struct RelayerConfig {
    evm_addr: Option<String>,
    ecdsa_key_name: String,
    ecdsa_derivation_path: Vec<Vec<u8>>,
    chain_id: Option<Nat>,
    threshold_wei: Nat,
    rpc_target: Option<RpcTarget>,
    max_fee_multiplier: f64,
    priority_multiplier: f64,
    paused: bool,
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
struct RpcTarget {
    canister: Principal,
    network: String,
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
enum RpcService {
    Chain(u64),
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
struct RpcCanisterError {
    code: i64,
    message: String,
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
struct AssetConfig {
    evm_address: String,
    status: AssetStatus,
    fee_bps: u16,
    version: u32,
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
enum AssetStatus {
    Active,
    Deprecated,
    Disabled,
}

impl Default for AssetStatus {
    fn default() -> Self {
        AssetStatus::Active
    }
}

#[derive(Clone, Debug, Default, CandidType, Deserialize, Serialize)]
struct RateLimitConfig {
    per_addr_per_min: u32,
    daily_cap_token: u64,
}

#[derive(Clone, Debug, Default, CandidType, Deserialize, Serialize)]
struct RateLimitState {
    per_min_counter: BTreeMap<String, RateWindowCounter>,
    daily_counter: BTreeMap<String, RateWindowCounter>,
}

#[derive(Clone, Debug, Default, CandidType, Deserialize, Serialize)]
struct RateWindowCounter {
    window_start_sec: u64,
    amount: Nat,
    hits: u32,
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
struct PaymentLog {
    id: u64,
    ts_sec: u64,
    asset: Principal,
    from: String,
    to: String,
    value: Nat,
    status: PaymentStatus,
    tx_hash: Option<String>,
    fail_reason: Option<String>,
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
enum PaymentStatus {
    Accepted,
    Broadcasted,
    Failed,
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
struct InfoResponse {
    relayer_addr: String,
    gas_wei: Nat,
    threshold_wei: Nat,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
struct SubmitAuthorizationRequest {
    asset: Principal,
    from: Vec<u8>,
    to: Vec<u8>,
    value: Nat,
    valid_after: Nat,
    valid_before: Nat,
    nonce: Vec<u8>,
    sig_v: u8,
    sig_r: Vec<u8>,
    sig_s: Vec<u8>,
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
struct LogEntry {
    id: u64,
    ts: u64,
    from: String,
    to: String,
    value: Nat,
    tx: Option<String>,
    status: String,
    fail_reason: Option<String>,
}

#[derive(Clone, Debug, CandidType, Deserialize, Serialize)]
enum RelayError {
    NotAuthorized,
    NotInitialized,
    Paused,
    ConfigurationMissing {
        field: String,
    },
    RelayerAddressMissing,
    AssetNotRegistered,
    AssetNotActive,
    AuthorizationExpired,
    AuthorizationAlreadyUsed,
    InvalidAddressLength {
        field: String,
        expected: usize,
        actual: usize,
    },
    InvalidNonceLength {
        expected: usize,
        actual: usize,
    },
    InvalidSignatureLength {
        field: String,
        expected: usize,
        actual: usize,
    },
    RpcError {
        code: i64,
        message: String,
    },
    RpcTransportError {
        code: String,
        message: String,
    },
    RpcResultTypeMismatch {
        expected: &'static str,
    },
    HexDecodeFailed {
        value: String,
    },
    NumberOutOfRange {
        field: String,
    },
    SimulationFailed {
        message: String,
    },
    GasEstimateFailed {
        message: String,
    },
    GasBalanceLow {
        required: Nat,
        actual: Nat,
    },
    RateLimited,
    JsonError {
        message: String,
    },
    NotImplemented {
        feature: String,
    },
}

struct SignatureParts {
    y_parity: u8,
    r: Vec<u8>,
    s: Vec<u8>,
}

impl std::fmt::Display for RelayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RelayError::NotAuthorized => write!(f, "not authorized"),
            RelayError::NotInitialized => write!(f, "state not initialized"),
            RelayError::Paused => write!(f, "service paused"),
            RelayError::ConfigurationMissing { field } => {
                write!(f, "configuration missing: {}", field)
            }
            RelayError::RelayerAddressMissing => write!(f, "relayer address not configured"),
            RelayError::AssetNotRegistered => write!(f, "asset not registered"),
            RelayError::AssetNotActive => write!(f, "asset not active"),
            RelayError::AuthorizationExpired => write!(f, "authorization expired"),
            RelayError::AuthorizationAlreadyUsed => write!(f, "authorization already used"),
            RelayError::InvalidAddressLength {
                field,
                expected,
                actual,
            } => write!(
                f,
                "invalid {} length: expected {}, got {}",
                field, expected, actual
            ),
            RelayError::InvalidNonceLength { expected, actual } => {
                write!(
                    f,
                    "invalid nonce length: expected {}, got {}",
                    expected, actual
                )
            }
            RelayError::InvalidSignatureLength {
                field,
                expected,
                actual,
            } => write!(
                f,
                "invalid {} length: expected {}, got {}",
                field, expected, actual
            ),
            RelayError::RpcError { code, message } => write!(f, "rpc error {}: {}", code, message),
            RelayError::RpcTransportError { code, message } => {
                write!(f, "rpc transport error {}: {}", code, message)
            }
            RelayError::RpcResultTypeMismatch { expected } => {
                write!(f, "unexpected rpc result type, expected {}", expected)
            }
            RelayError::HexDecodeFailed { value } => write!(f, "failed to decode hex: {}", value),
            RelayError::NumberOutOfRange { field } => write!(f, "number out of range: {}", field),
            RelayError::SimulationFailed { message } => write!(f, "simulation failed: {}", message),
            RelayError::GasEstimateFailed { message } => {
                write!(f, "gas estimation failed: {}", message)
            }
            RelayError::GasBalanceLow { required, actual } => write!(
                f,
                "gas balance low: required {}, actual {}",
                required, actual
            ),
            RelayError::RateLimited => write!(f, "rate limit exceeded"),
            RelayError::JsonError { message } => write!(f, "json error: {}", message),
            RelayError::NotImplemented { feature } => {
                write!(f, "feature not implemented: {}", feature)
            }
        }
    }
}

impl std::error::Error for RelayError {}

#[derive(Clone, Debug, CandidType, Deserialize)]
struct InitArgs {
    admins: Vec<Principal>,
    ecdsa_key_name: String,
    chain_id: Option<Nat>,
    ecdsa_derivation_path: Option<Vec<Vec<u8>>>,
    threshold_wei: Option<Nat>,
    max_fee_multiplier: Option<f64>,
    priority_multiplier: Option<f64>,
    rate_limit_per_min: Option<u32>,
    daily_cap_token: Option<u64>,
}

impl Default for InitArgs {
    fn default() -> Self {
        Self {
            admins: Vec::new(),
            ecdsa_key_name: "test_key_1".to_string(),
            chain_id: None,
            ecdsa_derivation_path: None,
            threshold_wei: Some(Nat::from(0u32)),
            max_fee_multiplier: Some(2.0),
            priority_multiplier: Some(1.2),
            rate_limit_per_min: Some(10),
            daily_cap_token: Some(10_000),
        }
    }
}

fn state_mut<T>(f: impl FnOnce(&mut RelayerState) -> T) -> T {
    STATE.with(|cell| {
        let mut guard = cell.borrow_mut();
        let state = guard.as_mut().expect("relayer state not initialized");
        f(state)
    })
}

fn state_ref<T>(f: impl FnOnce(&RelayerState) -> T) -> T {
    STATE.with(|cell| {
        let guard = cell.borrow();
        let state = guard.as_ref().expect("relayer state not initialized");
        f(state)
    })
}

fn ensure_admin() -> InternalResult<()> {
    let caller = caller();
    state_ref(|state| {
        if state.admins.contains(&caller) {
            Ok(())
        } else {
            Err(RelayError::NotAuthorized)
        }
    })
}

#[init]
fn init(args: Option<InitArgs>) {
    let args = args.unwrap_or_default();
    let mut admins: BTreeSet<Principal> = args.admins.into_iter().collect();
    admins.insert(caller());

    let config = RelayerConfig {
        evm_addr: None,
        ecdsa_key_name: args.ecdsa_key_name,
        ecdsa_derivation_path: args.ecdsa_derivation_path.unwrap_or_default(),
        chain_id: args.chain_id,
        threshold_wei: args.threshold_wei.unwrap_or_else(|| Nat::from(0_u32)),
        rpc_target: None,
        max_fee_multiplier: args.max_fee_multiplier.unwrap_or(2.0),
        priority_multiplier: args.priority_multiplier.unwrap_or(1.2),
        paused: true,
    };

    let rate_limit = RateLimitConfig {
        per_addr_per_min: args.rate_limit_per_min.unwrap_or(10),
        daily_cap_token: args.daily_cap_token.unwrap_or(10_000),
    };

    let state = RelayerState {
        admins,
        config,
        assets: BTreeMap::new(),
        rate_limit,
        rate_state: RateLimitState::default(),
        logs: Vec::new(),
        next_log_id: 1,
        last_known_gas: Nat::from(0_u32),
    };

    STATE.with(|cell| {
        *cell.borrow_mut() = Some(state);
    });
}

#[pre_upgrade]
fn pre_upgrade() {
    let snapshot = STATE.with(|cell| cell.borrow().clone());
    if let Err(e) = stable_save((snapshot,)) {
        trap(&format!("failed to save state: {}", e));
    }
}

#[post_upgrade]
fn post_upgrade() {
    let (snapshot,): (Option<RelayerState>,) =
        stable_restore().unwrap_or_else(|e| trap(&format!("failed to restore state: {}", e)));
    STATE.with(|cell| {
        *cell.borrow_mut() = Some(snapshot.unwrap_or_default());
    });
}

#[query]
fn info() -> InfoResponse {
    state_ref(|state| InfoResponse {
        relayer_addr: state
            .config
            .evm_addr
            .clone()
            .unwrap_or_else(|| "".to_string()),
        gas_wei: state.last_known_gas.clone(),
        threshold_wei: state.config.threshold_wei.clone(),
    })
}

#[query]
fn logs(start_after: Option<u64>, limit: u32) -> Vec<LogEntry> {
    state_ref(|state| {
        let mut entries = Vec::new();
        for log in state.logs.iter().rev() {
            if let Some(cursor) = start_after {
                if log.id <= cursor {
                    continue;
                }
            }
            if entries.len() as u32 >= limit.max(1) {
                break;
            }
            entries.push(LogEntry {
                id: log.id,
                ts: log.ts_sec,
                from: log.from.clone(),
                to: log.to.clone(),
                value: log.value.clone(),
                tx: log.tx_hash.clone(),
                status: match log.status {
                    PaymentStatus::Accepted => "accepted".to_string(),
                    PaymentStatus::Broadcasted => "broadcasted".to_string(),
                    PaymentStatus::Failed => "failed".to_string(),
                },
                fail_reason: log.fail_reason.clone(),
            });
        }
        entries
    })
}

#[update]
fn set_rpc_target(canister: Principal, network: String) {
    if let Err(err) = ensure_admin() {
        ic_cdk::trap(&err.to_string());
    }
    state_mut(|state| state.config.rpc_target = Some(RpcTarget { canister, network }));
}

#[update]
fn set_threshold(value: Nat) {
    if let Err(err) = ensure_admin() {
        ic_cdk::trap(&err.to_string());
    }
    state_mut(|state| state.config.threshold_wei = value);
}

#[update]
fn set_chain_id(chain_id: Nat) {
    if let Err(err) = ensure_admin() {
        ic_cdk::trap(&err.to_string());
    }
    state_mut(|state| state.config.chain_id = Some(chain_id));
}

#[update]
fn set_ecdsa_derivation_path(path: Vec<Vec<u8>>) {
    if let Err(err) = ensure_admin() {
        ic_cdk::trap(&err.to_string());
    }
    state_mut(|state| state.config.ecdsa_derivation_path = path);
}

#[update]
fn set_relayer_address(address: String) {
    if let Err(err) = ensure_admin() {
        ic_cdk::trap(&err.to_string());
    }
    let normalized = match normalize_evm_address(&address) {
        Ok(addr) => addr,
        Err(err) => ic_cdk::trap(&err.to_string()),
    };
    state_mut(|state| state.config.evm_addr = Some(normalized));
}

#[query]
fn get_relayer_address() -> Option<String> {
    state_ref(|state| state.config.evm_addr.clone())
}

#[update]
async fn refresh_gas_balance() -> Result<Nat, String> {
    let (address_opt, chain_id_opt) =
        state_ref(|state| (state.config.evm_addr.clone(), state.config.chain_id.clone()));

    let address = address_opt.ok_or_else(|| RelayError::RelayerAddressMissing.to_string())?;
    let chain_id_nat = chain_id_opt.ok_or_else(|| {
        RelayError::ConfigurationMissing {
            field: "chain_id".into(),
        }
        .to_string()
    })?;

    let chain_id_u64 = nat_to_u64(&chain_id_nat).map_err(|e| e.to_string())?;

    let balance = fetch_balance(chain_id_u64, &address)
        .await
        .map_err(|e| e.to_string())?;

    state_mut(|state| state.last_known_gas = balance.clone());

    Ok(balance)
}

#[update]
fn add_asset(asset: Principal, evm_address: String, fee_bps: Nat) {
    if let Err(err) = ensure_admin() {
        ic_cdk::trap(&err.to_string());
    }
    let fee = match nat_to_u32(&fee_bps) {
        Ok(v) if v <= u16::MAX as u32 => v as u16,
        _ => ic_cdk::trap("fee_bps out of range"),
    };
    let normalized = match normalize_evm_address(&evm_address) {
        Ok(addr) => addr,
        Err(err) => ic_cdk::trap(&err.to_string()),
    };
    state_mut(|state| {
        state.assets.insert(
            asset,
            AssetConfig {
                evm_address: normalized,
                status: AssetStatus::Active,
                fee_bps: fee,
                version: 1,
            },
        );
    });
}

#[update]
fn deprecate_asset(asset: Principal) {
    if let Err(err) = ensure_admin() {
        ic_cdk::trap(&err.to_string());
    }
    state_mut(|state| {
        if let Some(cfg) = state.assets.get_mut(&asset) {
            cfg.status = AssetStatus::Deprecated;
        }
    });
}

#[update]
fn disable_asset(asset: Principal) {
    if let Err(err) = ensure_admin() {
        ic_cdk::trap(&err.to_string());
    }
    state_mut(|state| {
        if let Some(cfg) = state.assets.get_mut(&asset) {
            cfg.status = AssetStatus::Disabled;
        }
    });
}

#[update]
fn pause(flag: bool) {
    if let Err(err) = ensure_admin() {
        ic_cdk::trap(&err.to_string());
    }
    state_mut(|state| state.config.paused = flag);
}

#[update]
async fn submit_authorization(req: SubmitAuthorizationRequest) -> Result<String, String> {
    match submit_authorization_internal(req).await {
        Ok(tx_hash) => Ok(tx_hash),
        Err(err) => Err(err.to_string()),
    }
}

async fn submit_authorization_internal(req: SubmitAuthorizationRequest) -> InternalResult<String> {
    if state_ref(|state| state.config.paused) {
        return Err(RelayError::Paused);
    }

    if req.from.len() != 20 {
        return Err(RelayError::InvalidAddressLength {
            field: "from".into(),
            expected: 20,
            actual: req.from.len(),
        });
    }
    if req.to.len() != 20 {
        return Err(RelayError::InvalidAddressLength {
            field: "to".into(),
            expected: 20,
            actual: req.to.len(),
        });
    }

    let asset_cfg = state_ref(|state| state.assets.get(&req.asset).cloned());
    let asset_cfg = asset_cfg.ok_or(RelayError::AssetNotRegistered)?;
    if !matches!(
        asset_cfg.status,
        AssetStatus::Active | AssetStatus::Deprecated
    ) {
        return Err(RelayError::AssetNotActive);
    }

    let config_snapshot = state_ref(|state| state.config.clone());
    let threshold_wei = config_snapshot.threshold_wei.clone();
    let max_fee_multiplier = config_snapshot.max_fee_multiplier;
    let priority_multiplier = config_snapshot.priority_multiplier;
    let relayer_addr_opt = config_snapshot.evm_addr.clone();
    let chain_id_opt = config_snapshot.chain_id.clone();
    let ecdsa_key_name = config_snapshot.ecdsa_key_name.clone();
    let derivation_path = config_snapshot.ecdsa_derivation_path.clone();

    let now_sec = time() / 1_000_000_000;
    let valid_before = nat_to_u64(&req.valid_before).map_err(|_| RelayError::NumberOutOfRange {
        field: "valid_before".to_string(),
    })?;
    if valid_before <= now_sec {
        return Err(RelayError::AuthorizationExpired);
    }

    let from_hex = to_hex_address(&req.from)?;
    let to_hex = to_hex_address(&req.to)?;

    state_mut(|state| enforce_rate_limits(state, &from_hex, &req.value))?;

    let log_id = state_mut(|state| {
        let id = state.next_log_id;
        state.next_log_id += 1;
        state.logs.push(PaymentLog {
            id,
            ts_sec: now_sec,
            asset: req.asset,
            from: from_hex.clone(),
            to: to_hex.clone(),
            value: req.value.clone(),
            status: PaymentStatus::Accepted,
            tx_hash: None,
            fail_reason: None,
        });
        id
    });

    if state_ref(|state| state.config.rpc_target.is_none()) {
        mark_log_failure(log_id, "rpc target not configured");
        return Err(RelayError::ConfigurationMissing {
            field: "rpc_target".into(),
        });
    }

    let relayer_addr = relayer_addr_opt.ok_or_else(|| {
        mark_log_failure(log_id, "relayer address not configured");
        RelayError::RelayerAddressMissing
    })?;

    let chain_id_nat = match chain_id_opt {
        Some(ref id) => id.clone(),
        None => {
            mark_log_failure(log_id, "chain id not configured");
            return Err(RelayError::ConfigurationMissing {
                field: "chain_id".into(),
            });
        }
    };

    let chain_id_u64 = match nat_to_u64(&chain_id_nat) {
        Ok(value) => value,
        Err(err) => {
            mark_log_failure(log_id, &err.to_string());
            return Err(err);
        }
    };

    if let Err(err) =
        ensure_authorization_unused(chain_id_u64, &asset_cfg.evm_address, &req.from, &req.nonce)
            .await
    {
        mark_log_failure(log_id, &err.to_string());
        return Err(err);
    }

    let call_data = match encode_transfer_with_authorization_call(
        &req.from,
        &req.to,
        &req.value,
        &req.valid_after,
        &req.valid_before,
        &req.nonce,
        req.sig_v,
        &req.sig_r,
        &req.sig_s,
    ) {
        Ok(data) => data,
        Err(err) => {
            mark_log_failure(log_id, &err.to_string());
            return Err(err);
        }
    };

    if let Err(err) = simulate_transfer_call(
        chain_id_u64,
        &asset_cfg.evm_address,
        &relayer_addr,
        &call_data,
    )
    .await
    {
        mark_log_failure(log_id, &err.to_string());
        return Err(err);
    }

    let gas_estimate = match estimate_gas(
        chain_id_u64,
        &asset_cfg.evm_address,
        &relayer_addr,
        &call_data,
    )
    .await
    {
        Ok(value) => value,
        Err(err) => {
            mark_log_failure(log_id, &err.to_string());
            return Err(err);
        }
    };

    let mut gas_limit = gas_estimate.clone();
    let minimum_limit = Nat::from(50_000u64);
    if gas_limit < minimum_limit {
        gas_limit = minimum_limit;
    }
    gas_limit = match scale_nat(&gas_limit, 1.2) {
        Ok(val) => {
            if val < gas_estimate {
                gas_estimate.clone()
            } else {
                val
            }
        }
        Err(err) => {
            mark_log_failure(log_id, &err.to_string());
            return Err(err);
        }
    };

    let base_fee = match fetch_base_fee(chain_id_u64).await {
        Ok(val) => val,
        Err(err) => {
            mark_log_failure(log_id, &err.to_string());
            return Err(err);
        }
    };

    let priority_fee = match fetch_max_priority_fee(chain_id_u64).await {
        Ok(val) => val,
        Err(err) => {
            mark_log_failure(log_id, &err.to_string());
            return Err(err);
        }
    };

    let priority_fee_effective = match scale_nat(&priority_fee, priority_multiplier) {
        Ok(val) => {
            if val < priority_fee {
                priority_fee.clone()
            } else {
                val
            }
        }
        Err(err) => {
            mark_log_failure(log_id, &err.to_string());
            return Err(err);
        }
    };

    let priority_fee_effective = if priority_fee_effective == Nat::from(0u64) {
        Nat::from(1_000_000_000u64)
    } else {
        priority_fee_effective
    };

    let base_fee_scaled = match scale_nat(&base_fee, max_fee_multiplier) {
        Ok(val) => {
            if val < base_fee {
                base_fee.clone()
            } else {
                val
            }
        }
        Err(err) => {
            mark_log_failure(log_id, &err.to_string());
            return Err(err);
        }
    };

    let max_fee_per_gas = base_fee_scaled.clone() + priority_fee_effective.clone();

    let balance = match fetch_balance(chain_id_u64, &relayer_addr).await {
        Ok(val) => val,
        Err(err) => {
            mark_log_failure(log_id, &err.to_string());
            return Err(err);
        }
    };

    state_mut(|state| state.last_known_gas = balance.clone());

    if balance < threshold_wei {
        mark_log_failure(log_id, "relayer gas below threshold");
        return Err(RelayError::GasBalanceLow {
            required: threshold_wei,
            actual: balance,
        });
    }

    let chain_id = chain_id_nat;

    let nonce = match fetch_nonce(chain_id_u64, &relayer_addr).await {
        Ok(val) => val,
        Err(err) => {
            mark_log_failure(log_id, &err.to_string());
            return Err(err);
        }
    };

    let asset_address_bytes = match evm_address_bytes(&asset_cfg.evm_address) {
        Ok(bytes) => bytes,
        Err(err) => {
            mark_log_failure(log_id, &err.to_string());
            return Err(err);
        }
    };

    let mut unsigned_items = Vec::new();
    unsigned_items.push(rlp_encode_nat_value(&chain_id));
    unsigned_items.push(rlp_encode_nat_value(&nonce));
    unsigned_items.push(rlp_encode_nat_value(&priority_fee_effective));
    unsigned_items.push(rlp_encode_nat_value(&max_fee_per_gas));
    unsigned_items.push(rlp_encode_nat_value(&gas_limit));
    unsigned_items.push(rlp_encode_bytes(&asset_address_bytes));
    unsigned_items.push(rlp_encode_nat_value(&Nat::from(0u64))); // value = 0
    unsigned_items.push(rlp_encode_bytes(&call_data));
    unsigned_items.push(rlp_encode_list(&[])); // access list

    let unsigned_rlp = rlp_encode_list(&unsigned_items);
    let mut signing_payload = Vec::with_capacity(1 + unsigned_rlp.len());
    signing_payload.push(0x02);
    signing_payload.extend_from_slice(&unsigned_rlp);
    let sighash = keccak256(&signing_payload);

    let signature = match sign_prehashed_message(&ecdsa_key_name, &derivation_path, &sighash).await
    {
        Ok(sig) => sig,
        Err(err) => {
            mark_log_failure(log_id, &err.to_string());
            return Err(err);
        }
    };

    let mut signed_items = unsigned_items;
    signed_items.push(rlp_encode_nat_value(&Nat::from(signature.y_parity as u64)));
    signed_items.push(rlp_encode_bytes(&signature.r));
    signed_items.push(rlp_encode_bytes(&signature.s));

    let signed_rlp = rlp_encode_list(&signed_items);
    let mut raw_tx = Vec::with_capacity(1 + signed_rlp.len());
    raw_tx.push(0x02);
    raw_tx.extend_from_slice(&signed_rlp);

    let tx_hash = match send_raw_transaction(chain_id_u64, &raw_tx).await {
        Ok(hash) => hash,
        Err(err) => {
            mark_log_failure(log_id, &err.to_string());
            return Err(err);
        }
    };

    mark_log_success(log_id, &tx_hash);
    Ok(tx_hash)
}

fn nat_to_u32(value: &Nat) -> InternalResult<u32> {
    value
        .0
        .to_u32()
        .ok_or_else(|| RelayError::NumberOutOfRange {
            field: "u32".to_string(),
        })
}

fn nat_to_u64(value: &Nat) -> InternalResult<u64> {
    value
        .0
        .to_u64()
        .ok_or_else(|| RelayError::NumberOutOfRange {
            field: "u64".to_string(),
        })
}

fn to_hex_address(bytes: &[u8]) -> InternalResult<String> {
    if bytes.len() != 20 {
        return Err(RelayError::InvalidAddressLength {
            field: "address".into(),
            expected: 20,
            actual: bytes.len(),
        });
    }
    Ok(format!("0x{}", hex::encode(bytes)))
}

fn mark_log_failure(log_id: u64, reason: &str) {
    state_mut(|state| {
        if let Some(log) = state.logs.iter_mut().find(|l| l.id == log_id) {
            log.status = PaymentStatus::Failed;
            log.fail_reason = Some(reason.to_string());
        }
    });
}

fn mark_log_success(log_id: u64, tx_hash: &str) {
    state_mut(|state| {
        if let Some(log) = state.logs.iter_mut().find(|l| l.id == log_id) {
            log.status = PaymentStatus::Broadcasted;
            log.tx_hash = Some(tx_hash.to_string());
            log.fail_reason = None;
        }
    });
}

fn normalize_evm_address(address: &str) -> InternalResult<String> {
    let trimmed = address.trim();
    if trimmed.len() != 42 || !trimmed.starts_with("0x") {
        return Err(RelayError::InvalidAddressLength {
            field: "evm_address".into(),
            expected: 42,
            actual: trimmed.len(),
        });
    }
    let bytes = hex::decode(&trimmed[2..]).map_err(|_| RelayError::HexDecodeFailed {
        value: trimmed.to_string(),
    })?;
    if bytes.len() != 20 {
        return Err(RelayError::InvalidAddressLength {
            field: "evm_address".into(),
            expected: 20,
            actual: bytes.len(),
        });
    }
    Ok(format!("0x{}", hex::encode(bytes)))
}

fn pad_left(value: &[u8], len: usize) -> Vec<u8> {
    if value.len() >= len {
        return value[value.len() - len..].to_vec();
    }
    let mut out = vec![0u8; len - value.len()];
    out.extend_from_slice(value);
    out
}

fn encode_uint_nat(value: &Nat) -> InternalResult<Vec<u8>> {
    let bytes = value.0.to_bytes_be();
    if bytes.len() > 32 {
        return Err(RelayError::NumberOutOfRange {
            field: "uint256".into(),
        });
    }
    Ok(pad_left(&bytes, 32))
}

fn encode_uint_u8(value: u8) -> Vec<u8> {
    pad_left(&[value], 32)
}

fn encode_bytes32(value: &[u8]) -> InternalResult<Vec<u8>> {
    if value.len() != 32 {
        return Err(RelayError::InvalidNonceLength {
            expected: 32,
            actual: value.len(),
        });
    }
    Ok(value.to_vec())
}

fn to_hex_prefixed(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(bytes))
}

fn parse_hex_bytes(value: &str) -> InternalResult<Vec<u8>> {
    let trimmed = value.trim();
    if !trimmed.starts_with("0x") {
        return Err(RelayError::HexDecodeFailed {
            value: trimmed.to_string(),
        });
    }
    hex::decode(&trimmed[2..]).map_err(|_| RelayError::HexDecodeFailed {
        value: trimmed.to_string(),
    })
}

fn decode_bool_abi(bytes: &[u8]) -> InternalResult<bool> {
    if bytes.is_empty() {
        return Ok(false);
    }
    Ok(bytes[bytes.len() - 1] != 0)
}

fn nat_from_hex(value: &str) -> InternalResult<Nat> {
    let bytes = parse_hex_bytes(value)?;
    Ok(Nat::from(BigUint::from_bytes_be(&bytes)))
}

fn nat_from_hex_with_zero_default(value: &str) -> InternalResult<Nat> {
    if value == "0x" {
        Ok(Nat::from(0u32))
    } else {
        nat_from_hex(value)
    }
}

fn nat_to_u128(value: &Nat) -> InternalResult<u128> {
    value
        .0
        .to_u128()
        .ok_or_else(|| RelayError::NumberOutOfRange {
            field: "u128".into(),
        })
}

fn scale_nat(value: &Nat, multiplier: f64) -> InternalResult<Nat> {
    let base = nat_to_u128(value)?;
    let scaled = (base as f64 * multiplier).ceil();
    if scaled.is_nan() || scaled.is_infinite() || scaled < 0.0 {
        return Err(RelayError::NumberOutOfRange {
            field: "scaled nat".into(),
        });
    }
    Ok(Nat::from(scaled as u128))
}

const JPYC_UNIT_MULTIPLIER: u128 = 1_000_000_000_000_000_000;
const RPC_CALL_CYCLES: u128 = 2_000_000_000_000;
const RPC_RESPONSE_ESTIMATE: u64 = 64 * 1024;
static JSON_RPC_ID: AtomicU64 = AtomicU64::new(1);

fn daily_cap_in_smallest_unit(config: &RateLimitConfig) -> Option<Nat> {
    if config.daily_cap_token == 0 {
        None
    } else {
        Some(Nat::from(config.daily_cap_token) * Nat::from(JPYC_UNIT_MULTIPLIER))
    }
}

fn enforce_rate_limits(state: &mut RelayerState, from: &str, amount: &Nat) -> InternalResult<()> {
    let now_sec = time() / 1_000_000_000;
    if state.rate_limit.per_addr_per_min > 0 {
        let window = now_sec / 60;
        let counter = state
            .rate_state
            .per_min_counter
            .entry(from.to_string())
            .or_default();
        if counter.window_start_sec != window {
            counter.window_start_sec = window;
            counter.amount = Nat::from(0u32);
            counter.hits = 0;
        }
        if counter.hits >= state.rate_limit.per_addr_per_min {
            return Err(RelayError::RateLimited);
        }
        counter.hits += 1;
        counter.amount = counter.amount.clone() + amount.clone();
    }

    if let Some(cap) = daily_cap_in_smallest_unit(&state.rate_limit) {
        let window = now_sec / 86_400;
        let counter = state
            .rate_state
            .daily_counter
            .entry(from.to_string())
            .or_default();
        if counter.window_start_sec != window {
            counter.window_start_sec = window;
            counter.amount = Nat::from(0u32);
            counter.hits = 0;
        }
        counter.hits += 1;
        counter.amount = counter.amount.clone() + amount.clone();
        if counter.amount > cap {
            return Err(RelayError::RateLimited);
        }
    }
    Ok(())
}

fn trim_leading_zeroes(data: &[u8]) -> Vec<u8> {
    let mut index = 0;
    while index < data.len() && data[index] == 0 {
        index += 1;
    }
    if index >= data.len() {
        Vec::new()
    } else {
        data[index..].to_vec()
    }
}

fn nat_to_be_bytes(value: &Nat) -> Vec<u8> {
    let bytes = value.0.to_bytes_be();
    trim_leading_zeroes(&bytes)
}

fn length_to_bytes(len: usize) -> Vec<u8> {
    let mut value = len;
    let mut bytes = Vec::new();
    while value > 0 {
        bytes.push((value & 0xff) as u8);
        value >>= 8;
    }
    bytes.reverse();
    if bytes.is_empty() {
        vec![0]
    } else {
        bytes
    }
}

fn rlp_encode_bytes(data: &[u8]) -> Vec<u8> {
    match data.len() {
        0 => vec![0x80],
        1 if data[0] < 0x80 => vec![data[0]],
        len if len <= 55 => {
            let mut out = Vec::with_capacity(1 + len);
            out.push(0x80 + len as u8);
            out.extend_from_slice(data);
            out
        }
        len => {
            let len_bytes = length_to_bytes(len);
            let mut out = Vec::with_capacity(1 + len_bytes.len() + len);
            out.push(0xB7 + len_bytes.len() as u8);
            out.extend_from_slice(&len_bytes);
            out.extend_from_slice(data);
            out
        }
    }
}

fn rlp_encode_nat_value(value: &Nat) -> Vec<u8> {
    let bytes = nat_to_be_bytes(value);
    rlp_encode_bytes(&bytes)
}

fn rlp_encode_list(items: &[Vec<u8>]) -> Vec<u8> {
    let total_len: usize = items.iter().map(|item| item.len()).sum();
    if total_len <= 55 {
        let mut out = Vec::with_capacity(1 + total_len);
        out.push(0xC0 + total_len as u8);
        for item in items {
            out.extend_from_slice(item);
        }
        out
    } else {
        let len_bytes = length_to_bytes(total_len);
        let mut out = Vec::with_capacity(1 + len_bytes.len() + total_len);
        out.push(0xF7 + len_bytes.len() as u8);
        out.extend_from_slice(&len_bytes);
        for item in items {
            out.extend_from_slice(item);
        }
        out
    }
}

const KECCAKF_ROUND_CONSTANTS: [u64; 24] = [
    0x0000000000000001,
    0x0000000000008082,
    0x800000000000808a,
    0x8000000080008000,
    0x000000000000808b,
    0x0000000080000001,
    0x8000000080008081,
    0x8000000000008009,
    0x000000000000008a,
    0x0000000000000088,
    0x0000000080008009,
    0x000000008000000a,
    0x000000008000808b,
    0x800000000000008b,
    0x8000000000008089,
    0x8000000000008003,
    0x8000000000008002,
    0x8000000000000080,
    0x000000000000800a,
    0x800000008000000a,
    0x8000000080008081,
    0x8000000000008080,
    0x0000000080000001,
    0x8000000080008008,
];

const KECCAKF_ROTATION: [u32; 24] = [
    1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
];

const KECCAKF_PERMUTATION: [usize; 24] = [
    10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
];

fn keccak_f1600(state: &mut [u64; 25]) {
    let mut bc = [0u64; 5];
    for &rc in KECCAKF_ROUND_CONSTANTS.iter() {
        for i in 0..5 {
            bc[i] = state[i] ^ state[i + 5] ^ state[i + 10] ^ state[i + 15] ^ state[i + 20];
        }
        for i in 0..5 {
            let t = bc[(i + 4) % 5] ^ bc[(i + 1) % 5].rotate_left(1);
            for j in (0..25).step_by(5) {
                state[i + j] ^= t;
            }
        }
        let mut t = state[1];
        for i in 0..24 {
            let j = KECCAKF_PERMUTATION[i];
            let tmp = state[j];
            state[j] = t.rotate_left(KECCAKF_ROTATION[i]);
            t = tmp;
        }
        for j in (0..25).step_by(5) {
            for i in 0..5 {
                bc[i] = state[j + i];
            }
            for i in 0..5 {
                state[j + i] ^= (!bc[(i + 1) % 5]) & bc[(i + 2) % 5];
            }
        }
        state[0] ^= rc;
    }
}

fn absorb_block(state: &mut [u64; 25], block: &[u8]) {
    for (i, chunk) in block.chunks(8).enumerate() {
        let mut lane_bytes = [0u8; 8];
        lane_bytes[..chunk.len()].copy_from_slice(chunk);
        state[i] ^= u64::from_le_bytes(lane_bytes);
    }
}

fn state_to_bytes(state: &[u64; 25]) -> [u8; 200] {
    let mut out = [0u8; 200];
    for (i, lane) in state.iter().enumerate() {
        out[i * 8..(i + 1) * 8].copy_from_slice(&lane.to_le_bytes());
    }
    out
}

fn keccak256(input: &[u8]) -> [u8; 32] {
    const RATE: usize = 136;
    let mut state = [0u64; 25];
    let mut offset = 0;
    while offset + RATE <= input.len() {
        absorb_block(&mut state, &input[offset..offset + RATE]);
        keccak_f1600(&mut state);
        offset += RATE;
    }

    let mut block = [0u8; RATE];
    let remainder = &input[offset..];
    block[..remainder.len()].copy_from_slice(remainder);
    block[remainder.len()] = 0x01;
    block[RATE - 1] |= 0x80;
    absorb_block(&mut state, &block);
    keccak_f1600(&mut state);

    let mut output = [0u8; 32];
    let mut out_offset = 0;
    loop {
        let state_bytes = state_to_bytes(&state);
        let take = std::cmp::min(32 - out_offset, RATE);
        output[out_offset..out_offset + take].copy_from_slice(&state_bytes[..take]);
        out_offset += take;
        if out_offset >= 32 {
            break;
        }
        keccak_f1600(&mut state);
    }
    output
}

fn function_selector(signature: &str) -> [u8; 4] {
    let hash = keccak256(signature.as_bytes());
    [hash[0], hash[1], hash[2], hash[3]]
}

fn encode_authorization_state_call(from: &[u8], nonce: &[u8]) -> InternalResult<Vec<u8>> {
    let mut data = Vec::with_capacity(4 + 32 * 2);
    let selector = function_selector("authorizationState(address,bytes32)");
    data.extend_from_slice(&selector);
    data.extend_from_slice(&pad_left(from, 32));
    data.extend_from_slice(&encode_bytes32(nonce)?);
    Ok(data)
}

#[allow(clippy::too_many_arguments)]
fn encode_transfer_with_authorization_call(
    from: &[u8],
    to: &[u8],
    value: &Nat,
    valid_after: &Nat,
    valid_before: &Nat,
    nonce: &[u8],
    sig_v: u8,
    sig_r: &[u8],
    sig_s: &[u8],
) -> InternalResult<Vec<u8>> {
    if sig_r.len() != 32 {
        return Err(RelayError::InvalidSignatureLength {
            field: "sig_r".into(),
            expected: 32,
            actual: sig_r.len(),
        });
    }
    if sig_s.len() != 32 {
        return Err(RelayError::InvalidSignatureLength {
            field: "sig_s".into(),
            expected: 32,
            actual: sig_s.len(),
        });
    }
    let mut data = Vec::with_capacity(4 + 32 * 9);
    let selector = function_selector("transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)");
    data.extend_from_slice(&selector);
    data.extend_from_slice(&pad_left(from, 32));
    data.extend_from_slice(&pad_left(to, 32));
    data.extend_from_slice(&encode_uint_nat(value)?);
    data.extend_from_slice(&encode_uint_nat(valid_after)?);
    data.extend_from_slice(&encode_uint_nat(valid_before)?);
    data.extend_from_slice(&encode_bytes32(nonce)?);
    data.extend_from_slice(&encode_uint_u8(sig_v));
    data.extend_from_slice(sig_r);
    data.extend_from_slice(sig_s);
    Ok(data)
}

fn evm_address_bytes(address: &str) -> InternalResult<[u8; 20]> {
    let bytes = parse_hex_bytes(address)?;
    if bytes.len() != 20 {
        return Err(RelayError::InvalidAddressLength {
            field: "evm_address".into(),
            expected: 20,
            actual: bytes.len(),
        });
    }
    let mut out = [0u8; 20];
    out.copy_from_slice(&bytes);
    Ok(out)
}

async fn sign_prehashed_message(
    key_name: &str,
    derivation_path: &[Vec<u8>],
    message_hash: &[u8],
) -> InternalResult<SignatureParts> {
    if message_hash.len() != 32 {
        return Err(RelayError::NotImplemented {
            feature: "non-32-byte hash signing".into(),
        });
    }

    let arg = SignWithEcdsaArgument {
        message_hash: message_hash.to_vec(),
        derivation_path: derivation_path.to_vec(),
        key_id: EcdsaKeyId {
            curve: EcdsaCurve::Secp256k1,
            name: key_name.to_string(),
        },
    };

    let (SignWithEcdsaResponse { signature },) =
        sign_with_ecdsa(arg)
            .await
            .map_err(|(code, message)| RelayError::RpcTransportError {
                code: format!("{:?}", code),
                message,
            })?;
    if signature.len() != 65 {
        return Err(RelayError::RpcResultTypeMismatch {
            expected: "65-byte secp256k1 signature",
        });
    }

    let r_raw = &signature[0..32];
    let s_raw = &signature[32..64];
    let y_parity = signature[64];

    let mut r = trim_leading_zeroes(r_raw);
    if r.is_empty() {
        r.push(0);
    }
    let mut s = trim_leading_zeroes(s_raw);
    if s.is_empty() {
        s.push(0);
    }

    Ok(SignatureParts { y_parity, r, s })
}

async fn ensure_authorization_unused(
    chain_id: u64,
    asset_address: &str,
    from: &[u8],
    nonce: &[u8],
) -> InternalResult<()> {
    let data = encode_authorization_state_call(from, nonce)?;
    let payload = json!({
        "jsonrpc": "2.0",
        "id": next_json_rpc_id(),
        "method": "eth_call",
        "params": [
            {
                "to": asset_address,
                "data": to_hex_prefixed(&data),
            },
            "latest"
        ],
    });
    let value = rpc_request(chain_id, payload).await?;
    let hex = value.as_str().ok_or(RelayError::RpcResultTypeMismatch {
        expected: "hex string",
    })?;
    let bytes = parse_hex_bytes(hex)?;
    let used = decode_bool_abi(&bytes)?;
    if used {
        Err(RelayError::AuthorizationAlreadyUsed)
    } else {
        Ok(())
    }
}

async fn simulate_transfer_call(
    chain_id: u64,
    asset_address: &str,
    from_address: &str,
    call_data: &[u8],
) -> InternalResult<()> {
    let payload = json!({
        "jsonrpc": "2.0",
        "id": next_json_rpc_id(),
        "method": "eth_call",
        "params": [
            {
                "from": from_address,
                "to": asset_address,
                "data": to_hex_prefixed(call_data),
            },
            "latest"
        ],
    });
    match rpc_request(chain_id, payload).await {
        Ok(_) => Ok(()),
        Err(RelayError::RpcError { message, .. }) => Err(RelayError::SimulationFailed { message }),
        Err(other) => Err(other),
    }
}

async fn estimate_gas(
    chain_id: u64,
    asset_address: &str,
    from_address: &str,
    call_data: &[u8],
) -> InternalResult<Nat> {
    let payload = json!({
        "jsonrpc": "2.0",
        "id": next_json_rpc_id(),
        "method": "eth_estimateGas",
        "params": [
            {
                "from": from_address,
                "to": asset_address,
                "data": to_hex_prefixed(call_data),
            }
        ],
    });
    match rpc_request(chain_id, payload).await {
        Ok(value) => {
            let hex = value.as_str().ok_or(RelayError::RpcResultTypeMismatch {
                expected: "hex string",
            })?;
            nat_from_hex(hex).map_err(|err| match err {
                RelayError::HexDecodeFailed { value } => {
                    RelayError::GasEstimateFailed { message: value }
                }
                other => other,
            })
        }
        Err(RelayError::RpcError { message, .. }) => Err(RelayError::GasEstimateFailed { message }),
        Err(other) => Err(other),
    }
}

async fn fetch_balance(chain_id: u64, address: &str) -> InternalResult<Nat> {
    let payload = json!({
        "jsonrpc": "2.0",
        "id": next_json_rpc_id(),
        "method": "eth_getBalance",
        "params": [address, "latest"],
    });
    let value = rpc_request(chain_id, payload).await?;
    let hex = value.as_str().ok_or(RelayError::RpcResultTypeMismatch {
        expected: "hex string",
    })?;
    nat_from_hex_with_zero_default(hex)
}

async fn fetch_nonce(chain_id: u64, address: &str) -> InternalResult<Nat> {
    let payload = json!({
        "jsonrpc": "2.0",
        "id": next_json_rpc_id(),
        "method": "eth_getTransactionCount",
        "params": [address, "pending"],
    });
    let value = rpc_request(chain_id, payload).await?;
    let hex = value.as_str().ok_or(RelayError::RpcResultTypeMismatch {
        expected: "hex string",
    })?;
    nat_from_hex_with_zero_default(hex)
}

async fn fetch_max_priority_fee(chain_id: u64) -> InternalResult<Nat> {
    let payload = json!({
        "jsonrpc": "2.0",
        "id": next_json_rpc_id(),
        "method": "eth_maxPriorityFeePerGas",
        "params": [],
    });
    let value = rpc_request(chain_id, payload).await?;
    let hex = value.as_str().ok_or(RelayError::RpcResultTypeMismatch {
        expected: "hex string",
    })?;
    nat_from_hex_with_zero_default(hex)
}

async fn fetch_base_fee(chain_id: u64) -> InternalResult<Nat> {
    let payload = json!({
        "jsonrpc": "2.0",
        "id": next_json_rpc_id(),
        "method": "eth_getBlockByNumber",
        "params": ["latest", false],
    });
    let value = rpc_request(chain_id, payload).await?;
    match value {
        Value::Object(map) => {
            if let Some(base_fee) = map.get("baseFeePerGas").and_then(Value::as_str) {
                nat_from_hex_with_zero_default(base_fee)
            } else {
                Err(RelayError::RpcResultTypeMismatch {
                    expected: "baseFeePerGas",
                })
            }
        }
        _ => Err(RelayError::RpcResultTypeMismatch {
            expected: "block object",
        }),
    }
}

async fn send_raw_transaction(chain_id: u64, raw_tx: &[u8]) -> InternalResult<String> {
    let payload = json!({
        "jsonrpc": "2.0",
        "id": next_json_rpc_id(),
        "method": "eth_sendRawTransaction",
        "params": [to_hex_prefixed(raw_tx)],
    });
    let value = rpc_request(chain_id, payload).await?;
    value
        .as_str()
        .map(str::to_string)
        .ok_or(RelayError::RpcResultTypeMismatch {
            expected: "transaction hash",
        })
}

fn next_json_rpc_id() -> u64 {
    JSON_RPC_ID.fetch_add(1, Ordering::Relaxed)
}

fn get_rpc_target() -> InternalResult<RpcTarget> {
    state_ref(|state| state.config.rpc_target.clone()).ok_or(RelayError::ConfigurationMissing {
        field: "rpc_target".into(),
    })
}

async fn rpc_request(chain_id: u64, payload: Value) -> InternalResult<Value> {
    let target = get_rpc_target()?;
    let payload_str = serde_json::to_string(&payload).map_err(|err| RelayError::JsonError {
        message: err.to_string(),
    })?;

    let (response,): (Result<String, RpcCanisterError>,) = call_with_payment128(
        target.canister,
        "request",
        (
            RpcService::Chain(chain_id),
            payload_str,
            RPC_RESPONSE_ESTIMATE,
        ),
        RPC_CALL_CYCLES,
    )
    .await
    .map_err(|(code, message)| RelayError::RpcTransportError {
        code: format!("{:?}", code),
        message,
    })?;

    let body = response.map_err(|err| RelayError::RpcError {
        code: err.code,
        message: err.message,
    })?;

    let value: Value = serde_json::from_str(&body).map_err(|err| RelayError::JsonError {
        message: err.to_string(),
    })?;

    if let Some(error) = value.get("error") {
        let code = error.get("code").and_then(Value::as_i64).unwrap_or(-32_000);
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown error")
            .to_string();
        return Err(RelayError::RpcError { code, message });
    }

    value
        .get("result")
        .cloned()
        .ok_or(RelayError::RpcResultTypeMismatch { expected: "result" })
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_conversion() {
        let bytes = vec![0u8; 20];
        let hex = to_hex_address(&bytes).unwrap();
        assert_eq!(hex.len(), 42);
        assert!(hex.starts_with("0x"));
    }

    #[test]
    fn nat_helpers() {
        let n32 = Nat::from(100_u32);
        assert_eq!(nat_to_u32(&n32).unwrap(), 100_u32);

        let n64 = Nat::from(1_000_000_u64);
        assert_eq!(nat_to_u64(&n64).unwrap(), 1_000_000_u64);
    }
}
