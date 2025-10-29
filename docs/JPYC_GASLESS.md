# Polygon JPYC ガスレス送金（EIP-3009）× ICP リレー 実装設計

> 目的：**ユーザーは MetaMask 等で EIP-3009 署名のみ**。**ICPキャニスター（財務/リレー）が Polygon へ EIP-1559 Tx を送信**し、POL ガスはリレーが負担。  
> スコープ：Polygon Mainnet / Polygon Amoy、JPYC（FiatTokenV1 プロキシ）。II は任意（ログイン用途のみ）。

---

## 0. 全体図

```
[User Wallet(EVM)]
  └─ signTypedData(EIP-712: TransferWithAuthorization) ─▶
      JSON(署名+ペイロード)
                                [ICP Relayer Canister]
                                ├─ 事前検証: authorizationState/validBefore
                                ├─ 手数料/残高チェック(POL 残高)
                                ├─ EIP-1559 Tx 組立 + tECDSA署名
                                └─ sendRawTransaction ▶ Polygon RPC
                                                       └─ TxHash → Polygonscan
```

---

## 1. コンフィグ（env テンプレ）

> キャニスターは ENV を直接読めない。**起動後に Admin API で設定投入**すること。  
> フロントは ENV で OK。

```bash
# .env.local (frontend)
NEXT_PUBLIC_CHAIN_ID=137                    # 137: Polygon Mainnet / 80002: Polygon Amoy
NEXT_PUBLIC_RPC_URL=...
NEXT_PUBLIC_EXPLORER_BASE=https://polygonscan.com
NEXT_PUBLIC_JPYC_ADDRESS=0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29
NEXT_PUBLIC_AUTH_VALIDITY_SECONDS=900

# relayer (運用メモ; Admin APIで投入)
RELAYER_EVM_RPC_CANISTER=br5f7-7uaaa-aaaaa-qaaca-cai
RELAYER_EVM_RPC_NETWORK=polygon-mainnet
RELAYER_CHAIN_ID=137
RELAYER_JPYC_ADDRESS=0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29
RELAYER_GAS_THRESHOLD_WEI=20000000000000000 # 0.02 POL 目安（適宜調整）
RELAYER_MAX_FEE_MULTIPLIER=2.0
RELAYER_PRIORITY_MULTIPLIER=1.2
RELAYER_ECDSA_DERIVATION_PATH=["<32byte index>"]
RATE_LIMIT_PER_ADDR_PER_MIN=10
DAILY_CAP_JPYC=10000
```

---

## 2. フロント（署名→送信）

### 2.1 依存と接続

```ts
import { createConfig, http } from 'wagmi'
import { polygon } from 'wagmi/chains'

export const config = createConfig({
  chains: [polygon],
  transports: { [polygon.id]: http(process.env.NEXT_PUBLIC_RPC_URL!) },
})
```

### 2.2 JPYC メタ情報取得（必須）

```ts
import { createPublicClient, http } from 'viem'
import { polygon } from 'viem/chains'
import ERC20_META_ABI from './abi/ERC20Meta.json'

const client = createPublicClient({ chain: polygon, transport: http(process.env.NEXT_PUBLIC_RPC_URL!) })
const JPYC = process.env.NEXT_PUBLIC_JPYC_ADDRESS as `0x${string}`

export async function fetchTokenMeta() {
  const [name, version, decimals] = await Promise.all([
    client.readContract({ address: JPYC, abi: ERC20_META_ABI, functionName: 'name' }),
    client.readContract({ address: JPYC, abi: ERC20_META_ABI, functionName: 'version' }),
    client.readContract({ address: JPYC, abi: ERC20_META_ABI, functionName: 'decimals' }),
  ])
  return { name: String(name), version: String(version), decimals: Number(decimals) }
}
```

### 2.3 EIP-3009 署名（TransferWithAuthorization）

```ts
import { parseUnits, createWalletClient, custom } from 'viem'
import { polygon } from 'viem/chains'

const walletClient = createWalletClient({ chain: polygon, transport: custom((window as any).ethereum) })

export async function signTransferWithAuthorization(from: `0x${string}`, to: `0x${string}`, amount: string) {
  const { name, version } = await fetchTokenMeta()
  const domain = {
    name,
    version,
    chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID),
    verifyingContract: process.env.NEXT_PUBLIC_JPYC_ADDRESS as `0x${string}`,
  } as const

  const types = {
    TransferWithAuthorization: [
      { name: 'from',        type: 'address' },
      { name: 'to',          type: 'address' },
      { name: 'value',       type: 'uint256' },
      { name: 'validAfter',  type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce',       type: 'bytes32'  },
    ],
  } as const

  const validBefore = Math.floor(Date.now() / 1000) + Number(process.env.NEXT_PUBLIC_AUTH_VALIDITY_SECONDS || 900)
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32))
  const nonce = `0x${Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`

  const value = parseUnits(amount, 18)
  const message = { from, to, value, validAfter: 0n, validBefore: BigInt(validBefore), nonce }

  const signature = await walletClient.signTypedData({
    account: from, domain, types, primaryType: 'TransferWithAuthorization', message,
  })

  const sig = signature.slice(2)
  const r = `0x${sig.slice(0, 64)}` as `0x${string}`
  const s = `0x${sig.slice(64, 128)}` as `0x${string}`
  const v = Number(`0x${sig.slice(128, 130)}`)

  return { message, v, r, s }
}
```

### 2.4 ICP リレーへ送信

```ts
await fetch('/api/relayer/settle', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    asset: process.env.NEXT_PUBLIC_JPYC_ADDRESS,
    from, to,
    value: message.value.toString(),
    validAfter: message.validAfter.toString(),
    validBefore: message.validBefore.toString(),
    nonce: message.nonce,
    v, r, s,
  }),
})
```

---

## 3. ICP リレー（キャニスター）仕様

### 3.1 ステート

```text
Relayer {
  evm_addr: text,
  ecdsa_key_name: text,
  ecdsa_derivation_path: vec<blob>,
  chain_id: nat,
  threshold_wei: nat,
  rpc_canister: principal,
  rpc_network: text,
  assets: Map<principal, { evm_address: text, status: Active|Deprecated|Disabled, fee_bps: nat, version: nat }>,
  rate_limit: { per_addr_per_min: nat; daily_cap_token: nat },
  paused: bool,
}

PaymentLog {
  id, ts, chainId, asset, from, to, value, validBefore, nonce32, txHash?, status, fail_reason?
}
```

### 3.2 Candid（最小）

```candid
type AssetStatus = variant { Active; Deprecated; Disabled };

service : {
  submit_authorization: (record {
    asset: principal;
    from: blob;
    to: blob;
    value: nat;
    valid_after: nat;
    valid_before: nat;
    nonce: blob;
    sig_v: nat8;
    sig_r: blob;
    sig_s: blob;
  }) -> (variant { ok: text; err: text });

  info: () -> (record { relayer_addr: text; gas_wei: nat; threshold_wei: nat }) query;
  logs: (opt nat64, nat32) -> (vec record { ts: nat64; from: text; to: text; value: nat; tx: text; status: text }) query;

  set_rpc_target: (principal, text) -> ();
  set_threshold: (nat) -> ();
  set_chain_id: (nat) -> ();
  set_ecdsa_derivation_path: (vec blob) -> ();
  set_relayer_address: (text) -> ();
  derive_relayer_address: () -> (variant { Ok : text; Err : text });
  add_asset: (principal, text, nat) -> ();
  deprecate_asset: (principal) -> ();
  disable_asset: (principal) -> ();
  pause: (bool) -> ();
}
```

### 3.3 EVM RPC キャニスター経由の呼び出し

* `eth_call / eth_estimateGas / eth_sendRawTransaction` は EVM RPC キャニスターの `request` を利用。
* `call_with_payment128` で十分な cycles を添付し、ネットワーク設定文字列に応じて適切な `RpcService` を組み立てたうえで JSON-RPC ペイロードを送信する（v0.5 以降は `RpcService::Chain` が廃止されたため注意）。
* 応答は JSON 文字列。`error` フィールドが存在する場合は `RpcError` を組み立て、`result` をパースして利用する。
* `set_chain_id` により EIP-712 ドメインと RPC 呼び出し先チェーンを切り替え、`set_rpc_target` は接続先キャニスターの記録に専念させる。

### 3.4 事前検証フロー

1. `paused == false` を確認  
2. `asset.status == Active`  
3. `valid_before > now`  
4. `eth_call` で `authorizationState(from, nonce)` を確認  
5. 必要に応じて静的実行。  
6. レート制限  
7. `eth_maxPriorityFeePerGas` / `eth_getBlockByNumber` で手数料パラメータを算出  
8. `eth_getBalance(relayer)` ≥ `threshold_wei`

### 3.5 送信（EIP-1559）

* `to = JPYC`, `value = 0`  
* `data = transferWithAuthorization(...)`  
* `gas = eth_estimateGas`
* 手数料: `maxPriority`, `maxFee` を乗数で調整
* `nonce = eth_getTransactionCount(relayer)`
* RLP エンコード（0x02 typed）→ tECDSA 署名 → `eth_sendRawTransaction`

---

## 4. dfx / ローカル・ステージング・本番

### 4.1 ローカル

```bash
dfx start --clean --enable-tecdsa
dfx deploy relayer
# set_rpc_target / set_chain_id / set_ecdsa_derivation_path / derive_relayer_address / add_asset / set_threshold / pause(false)
```

### 4.2 ステージング（Polygon Amoy）

* EVM RPC ネットワークを `polygon-amoy` に設定。
  - 例: `dfx canister --network ic call relayer set_rpc_target '(principal "7hfb6-caaaa-aaaar-qadga-cai", "polygon-amoy")'`
  - `polygon-amoy` / `polygon-mainnet` は内部で公式パブリック RPC URL（Amoy: `https://rpc-amoy.polygon.technology`, Mainnet: `https://polygon-rpc.com`）に解決される。
  - 独自 RPC を使う場合は `custom:https://example.com`、特定プロバイダ ID を指定する場合は `provider:<ID>` の形式を使う。
* 少額で正常系/失敗系の E2E テストを実施。

### 4.3 本番（Polygon Mainnet）

* `pause(true)` → 設定投入 → `pause(false)`  
* 段階リリースとメトリクス監視
* Chain ID: 137 (Mainnet) / 80002 (Amoy)

---

## 5. ログ/監視/運用

* メトリクス: 成功率、失敗理由、レイテンシ、件数  
* アラート: ガス残高、失敗率、`domain_mismatch`  
* ダッシュボード: ガス残量、直近 Tx、失敗トップ理由

---

## 6. エラーコード

| code              | 対応                              |
| ----------------- | --------------------------------- |
| gas_empty         | リレー残高補充                     |
| expired           | 有効期限切れ → 再署名              |
| used              | 二重使用 → nonce 切り替え          |
| domain_mismatch   | メタ情報再取得 → 再署名            |
| estimation_fail   | 金額・宛先・ネットワーク確認       |
| broadcast_fail    | ネットワーク/nonce 競合 → リトライ |
| rate_limited      | クールダウン                       |
| paused            | 一時停止中                         |

---

## 7. テスト計画

* ユニット: ドメイン生成、署名パース、手数料計算  
* モックRPC: `authorizationState`、静的実行  
* Amoy E2E: 正常・期限切れ・二重使用・ドメイン不一致・ガス枯渇・見積り失敗  
* Polygon Mainnet ドライラン

---

## 8. セキュリティ/運用上の注意

* メタ情報は毎回チェーンから取得  
* ENV 直読み禁止、Admin API で設定  
* tECDSA 有効化必須  
* 冪等性とロックで二重送信防止  
* ガス監視とサーキットブレーカー  
* アセットの段階的無効化  
* レート制限  
* `cancelAuthorization` 導線  
* 監査ログ  
* 内部用詳細ログとユーザー向け簡潔なメッセージ

---

## 9. ロールアウト/ロールバック

* ロールアウト: Amoy → 本番 `pause(true)` → 設定 → 段階解放 → 監視  
* ロールバック: `pause(true)`、原因切り分け、必要に応じて `deprecate_asset`

---

## 10. UI 文言

* 署名モーダル: ガスレス説明、15分の有効期限  
* 完了: 手数料 0、Polygonscan リンク  
* ガス枯渇: 管理者の POL 補充待ち

---

### 付録: チェーン情報

* Chain ID: 137 (本番) / 80002 (Amoy)  
* JPYC の Proxy（0xE7C3…）を必ず利用（Implementation 直接呼び出しは禁止）  
* `signTypedData` は MetaMask / WalletConnect 対応

---

以上。
