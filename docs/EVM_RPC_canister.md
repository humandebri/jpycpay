# EVM RPC Canister — Advanced Guide

## Overview

The **EVM RPC Canister** provides a unified interface to query and interact with Ethereum-compatible networks (Ethereum, Arbitrum, Base, Optimism, etc.) directly from the Internet Computer (ICP).

It supports both read-only (replicated) operations such as querying balances or logs, and write operations like sending signed transactions.

---

## 🧠 When to Use

* **Use `ic-alloy`** for:
  Creating and signing transactions (non-replicated, one-provider calls).

* **Use `EVM RPC Canister` directly** for:
  Querying balances, transaction confirmations, or logs that require **replicated responses**.

---

## 📚 Supported JSON-RPC Methods

| Method                      | Description                                           |
| --------------------------- | ----------------------------------------------------- |
| `eth_feeHistory`            | Queries historical fee data to estimate gas prices.   |
| `eth_getLogs`               | Retrieves logs for a specified block or transaction.  |
| `eth_getBlockByNumber`      | Fetches information about a given block.              |
| `eth_getTransactionCount`   | Returns the number of transactions for an address.    |
| `eth_getTransactionReceipt` | Gets details of a submitted transaction.              |
| `eth_sendRawTransaction`    | Submits a signed transaction to the Ethereum network. |
| `eth_call`                  | Queries the state of a smart contract.                |

Other JSON-RPC methods (including custom L2 endpoints) can be accessed via the `request` method.

---

## ⚙️ Supported RPC Providers

Built-in support for:

* **Alchemy** (Mainnet, Sepolia, L2)
* **Ankr**
* **BlockPI**
* **Cloudflare Web3**
* **Public Node**
* **LlamaNodes**

Additional providers from [ChainList.org](https://chainlist.org/) can be configured through `request`.

---

## 🧩 Importing or Deploying the Canister

### Using `dfx deps`

`dfx.json`:

```json
{
  "canisters": {
    "evm_rpc": {
      "type": "pull",
      "id": "7hfb6-caaaa-aaaar-qadga-cai"
    }
  }
}
```

Commands:

```bash
dfx start --background
dfx deps pull
dfx deps init evm_rpc --argument '(record {})'
dfx deps deploy
```

---

### Using Candid & Wasm Files

```json
{
  "canisters": {
    "evm_rpc": {
      "type": "custom",
      "candid": "https://github.com/internet-computer-protocol/evm-rpc-canister/releases/latest/download/evm_rpc.did",
      "wasm": "https://github.com/internet-computer-protocol/evm-rpc-canister/releases/latest/download/evm_rpc.wasm.gz",
      "remote": {
        "id": { "ic": "7hfb6-caaaa-aaaar-qadga-cai" }
      }
    }
  }
}
```

Deploy locally:

```bash
dfx start --clean --background
dfx deploy evm_rpc --argument '(record {})'
```

---

### Forking & Deploying

```bash
git clone https://github.com/internet-computer-protocol/evm-rpc-canister
dfx deploy evm_rpc --network ic --argument '(record {})'
```

If rate limits occur, update your API keys (see below).

---

## 🦀 Using `ic-alloy`

* `ic-alloy` is a Rust crate simplifying interaction with EVM RPC.
* It provides higher-level abstractions for common Ethereum operations.
* See [`ic-alloy-toolkit`](https://github.com/internet-computer-protocol/ic-alloy-toolkit) for examples.

---

## 🧾 Example Workflows

### Get Logs

```rust
let rpc_providers = RpcServices::EthMainnet(Some(vec![EthMainnetService::Alchemy]));
let cycles = 20_000_000_000_000;

let (result,) = EVM_RPC.eth_get_logs(rpc_providers, None, get_logs_args, cycles).await.unwrap();
```

---

### Get Latest Block

```rust
use ic_cdk::api::call::call_with_payment128;
let (results,): (MultiGetBlockByNumberResult,) = call_with_payment128(
    evm_rpc.0,
    "eth_getBlockByNumber",
    (RpcServices::EthMainnet(None), (), BlockTag::Number(19709434.into())),
    2000000000,
).await.unwrap();
```

---

### Get Transaction Receipt

```rust
let (results,): (MultiGetTransactionReceiptResult,) = call_with_payment128(
    evm_rpc.0,
    "eth_getTransactionReceipt",
    (RpcServices::EthMainnet(None), (), "0x<tx_hash>"),
    10000000000,
).await.unwrap();
```

---

### Smart Contract Call

Encodes function call and sends an `eth_call` request via JSON-RPC.

```rust
let json_rpc_payload = serde_json::to_string(&JsonRpcRequest {
    id: next_id().await.0.try_into().unwrap(),
    jsonrpc: "2.0".into(),
    method: "eth_call".into(),
    params: (EthCallParams { to: contract_address, data: to_hex(&data) }, block_number.to_string()),
}).unwrap();

let res = call_with_payment(
    evm_rpc.0,
    "request",
    (RpcService::EthSepolia(EthSepoliaService::BlockPi), json_rpc_payload, 2048_u64),
    2_000_000_000,
).await;
```

---

### Get Transaction Count

```rust
let (results,): (MultiGetTransactionCountResult,) = call_with_payment128(
    evm_rpc.0,
    "eth_getTransactionCount",
    (
        RpcServices::EthMainnet(None),
        (),
        GetTransactionCountArgs {
            address: "0x1789F79e95324A47c5Fd6693071188e82E9a3558".to_string(),
            block: BlockTag::Latest,
        },
    ),
   20000000000,
).await.unwrap();
```

---

### Fee History

```rust
let args = FeeHistoryArgs {
    blockCount: 100u128,
    newestBlock: BlockTag::Latest,
    rewardPercentiles: None,
};
let (res,) = EvmRpcCanister::eth_fee_history(
    RpcServices::EthMainnet(None), None, args, 20000000
).await.unwrap();
```

---

### Send Raw Transaction

```rust
pub async fn send_raw_transaction(network: String, raw_tx: String) -> SendRawTransactionStatus {
    let services = RpcServices::EthMainnet(None);
    let cycles = 20000000;
    let (res,) = EvmRpcCanister::eth_send_raw_transaction(services, None, raw_tx, cycles).await.unwrap();
}
```

**Note:**
Some providers may return `"already known"` or `NonceTooLow` errors.
These are normal due to ICP HTTPS consensus behavior; the transaction is usually still valid on-chain.

---

## 💬 Send Raw JSON-RPC Request

```rust
let params = (
    RpcService::EthMainnet,
    "{\"jsonrpc\":\"2.0\",\"method\":\"eth_gasPrice\",\"params\":null,\"id\":1}".to_string(),
    1000_u64,
);
let (result,): (Result<String, RpcError>,) =
    call_with_payment128(evm_rpc.0, "request", params, 2000000000).await.unwrap();
```

---

## 🌍 Specifying Chains and RPC Services

### Using Chain IDs

```rust
let params = (RpcService::Chain(1), "{\"method\":\"eth_gasPrice\"...}", 1000u64);
```

### Using `RpcServices`

```rust
type RpcServices = variant {
  EthMainnet : opt vec EthMainnetService;
  EthSepolia : opt vec EthSepoliaService;
  ArbitrumOne : opt vec L2MainnetService;
  BaseMainnet : opt vec L2MainnetService;
  OptimismMainnet : opt vec L2MainnetService;
  Custom : record {
    chainId : nat64;
    services : vec record { url : text; headers : opt vec (text, text) };
  };
};
```

---

## 🔑 Replacing API Keys

View all providers:

```bash
dfx canister call evm_rpc getProviders
```

Example output:

```text
record {
  providerId = 0 : nat64;
  alias = opt variant { EthMainnet = variant { Cloudflare } };
  chainId = 1 : nat64;
  access = variant {
    Authenticated = record {
      publicUrl = opt "https://cloudflare-eth.com/v1/mainnet";
      auth = variant { BearerToken = record { url = "https://cloudflare-eth.com/v1/mainnet";} };
    }
  };
}
```

Update API key:

```bash
dfx canister call evm_rpc updateApiKeys '(vec { record { 0 : nat64;  opt "YOUR-API-KEY" } } )'
```

---

## ⚠️ Common Errors

### `TooFewCycles`

```
ProviderError(TooFewCycles { expected: 798336000, received: 307392000 })
```

Attach more cycles to fix. Unused cycles are refunded.

---

## 🧰 Log Filtering

### Show All Logs

```bash
dfx deploy evm_rpc --argument "(record { consoleFilter = opt variant { ShowAll } })"
```

### Hide All Logs

```bash
dfx deploy evm_rpc --argument "(record { consoleFilter = opt variant { HideAll } })"
```

### Filter by Regex

Show only INFO logs:

```bash
dfx deploy evm_rpc --argument "(record { consoleFilter = opt variant { ShowPattern = \"^INFO\" } })"
```

Hide TRACE logs:

```bash
dfx deploy evm_rpc --argument "(record { consoleFilter = opt variant { HidePattern = \"^TRACE_HTTP\" } })"
```

---

## 🧩 Important Notes

### RPC Result Consistency

The canister compares results across multiple providers.
You can manually choose which to query:

```bash
dfx canister call evm_rpc eth_getTransactionCount \
'(variant {EthMainnet = opt vec {Cloudflare; PublicNode}}, record {address = "0xdAC17F..."; block = variant {Tag = variant {Latest}}})' \
--with-cycles 100000000000
```

---

### HTTPS Outcall Consensus

For custom or L2 RPCs, ensure the provider’s JSON-RPC responses are consistent.
If not, contact the maintainers for potential support.

---

### Response Size Estimation

For large logs:

```bash
dfx canister call evm_rpc eth_getLogs \
"(variant {EthMainnet}, record {responseSizeEstimate = 5000}, record {addresses = vec {\"0xdAC17F...\"}})" \
--with-cycles=1000000000
```

The canister doubles the response size until success or cycles are exhausted.