# Polygon JPYC ガスレス送金（EIP-3009）× ICP リレー 実装設計（コピー用）

> 目的：**ユーザーは MetaMask 等で EIP-3009 署名のみ**。**ICPキャニスター（財務/リレー）が Polygon へ EIP-1559 Tx を送信**し、MATIC ガスはリレーが負担。
> スコープ：Polygon Mainnet / Polygon Amoy、JPYC（FiatTokenV1 プロキシ）。II は任意（ログイン用途のみ）。

---

## 0. 全体図

```
[User Wallet(EVM)]
  └─ signTypedData(EIP-712: TransferWithAuthorization) ─▶
      JSON(署名+ペイロード)
                                [ICP Relayer Canister]
                                ├─ 事前検証: authorizationState/validBefore
                                ├─ 手数料/残高チェック(MATIC 残高)
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
NEXT_PUBLIC_RPC_URL=...                     # Alchemy/QuickNode 等
NEXT_PUBLIC_EXPLORER_BASE=https://polygonscan.com
NEXT_PUBLIC_JPYC_ADDRESS=0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29 # JPYC FiatTokenV1 プロキシ。name/version/decimals は必ずオンチェーン取得
NEXT_PUBLIC_AUTH_VALIDITY_SECONDS=900

# relayer (運用メモ; Admin APIで投入)
RELAYER_EVM_RPC_CANISTER=br5f7-7uaaa-aaaaa-qaaca-cai
RELAYER_EVM_RPC_NETWORK=polygon-mainnet
RELAYER_CHAIN_ID=137
RELAYER_JPYC_ADDRESS=0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29
RELAYER_GAS_THRESHOLD_WEI=20000000000000000 # 0.02 MATIC 相当（要調整）
RELAYER_MAX_FEE_MULTIPLIER=2.0
RELAYER_PRIORITY_MULTIPLIER=1.2
RELAYER_ECDSA_DERIVATION_PATH=["<32byte index>" ]
RATE_LIMIT_PER_ADDR_PER_MIN=10
DAILY_CAP_JPYC=10000
```

---

## 2. フロント（署名→送信）

### 2.1 依存と接続

```ts
// wagmi/viem セットアップ（Polygon Mainnet）
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
import ERC20_META_ABI from './abi/ERC20Meta.json' // name(), version(), decimals()

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

  const value = parseUnits(amount, 18) // JPYC 18 decimals
  const message = { from, to, value, validAfter: 0n, validBefore: BigInt(validBefore), nonce }

  const signature = await walletClient.signTypedData({
    account: from, domain, types, primaryType: 'TransferWithAuthorization', message
  })

  // v,r,s抽出
  const sig = signature.slice(2)
  const r = `0x${sig.slice(0, 64)}` as `0x${string}`
  const s = `0x${sig.slice(64, 128)}` as `0x${string}`
  const v = Number(`0x${sig.slice(128, 130)}`)

  return { message, v, r, s }
}
```

### 2.4 ICP リレーへ送信（Candid or HTTP）

```ts
// HTTP 例（JSON）
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

**UI 文言（固定）**

* 成功: `送金完了。手数料: 0（ガスは提供済み）。Tx: <Polygonscanリンク>`
* 失敗: 理由別（`gas_empty / expired / used / domain_mismatch / estimation_fail / broadcast_fail`）を具体表示。
* 「再署名」/「後で試す」/「通知を受け取る」ボタン。

---

## 3. ICP リレー（キャニスター）仕様

### 3.1 ステート

```text
Relayer {
  evm_addr: text,            // tECDSA公開鍵→EVM address
  ecdsa_key_name: text,      // "secp256k1" / "test_key_1"
  ecdsa_derivation_path: vec<blob>,
  chain_id: nat,
  threshold_wei: nat,
  rpc_canister: principal,
  rpc_network: text,         // "polygon-mainnet" / "polygon-amoy" など
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
  // user
  submit_authorization: (record {
    asset: principal;
    from: blob; to: blob;                // 20 bytes
    value: nat;
    valid_after: nat; valid_before: nat;
    nonce: blob;                         // 32 bytes
    sig_v: nat8; sig_r: blob; sig_s: blob;
  }) -> (variant { ok: text; err: text });

  // read
  info: () -> (record { relayer_addr: text; gas_wei: nat; threshold_wei: nat }) query;
  logs: (opt nat64, nat32) -> (vec record { ts: nat64; from: text; to: text; value: nat; tx: text; status: text }) query;

  // admin
  set_rpc_target: (principal, text) -> (); // (evm_rpc_canister, network)
  set_threshold: (nat) -> ();
  set_chain_id: (nat) -> ();
  set_ecdsa_derivation_path: (vec blob) -> ();
  set_relayer_address: (text) -> ();
  add_asset: (principal, text /*evm_address*/, nat /*fee_bps*/) -> ();
  deprecate_asset: (principal) -> ();
  disable_asset: (principal) -> ();
  pause: (bool) -> ();
}
```

### 3.3 EVM RPC キャニスター経由の呼び出し

* すべての `eth_call / eth_estimateGas / eth_sendRawTransaction` は **EVM RPC キャニスター**（例: `br5f7-7uaaa-aaaaa-qaaca-cai`）の `request` メソッドを利用。
* `call_with_payment128` で十分な cycles（例: `2_000_000_000_000`）を添付し、`RpcService::Chain(chainId)` を指定して JSON-RPC ペイロードを送信する。
* レスポンスは JSON 文字列で返るため、`result` フィールドをパースし `error` が含まれる場合は `RpcError` として扱う。
* `set_chain_id` で EIP-712 ドメインと RPC サービスの両方を切り替える。`set_rpc_target` は接続先キャニスターのみを記録（ネットワーク文字列はメモ用途）。

### 3.4 事前検証フロー

1. `paused == false` を確認
2. `asset.status == Active`（新規は新だけ受理）
3. **期限**: `valid_before > now`
4. **二重使用**: EVM RPC 経由の `eth_call` で `authorizationState(from, nonce) == false`
5. **(任意) 静的実行**: 同じく `eth_call` で `transferWithAuthorization` をシミュレート
6. **レート制限**: アドレス毎の回数・日次上限
7. **手数料前提**: `eth_maxPriorityFeePerGas` / `eth_getBlockByNumber` で優先手数料・BaseFee を取得
8. **ガス残高**: EVM RPC の `eth_getBalance(relayer)` ≥ `threshold_wei`（満たさない→`gas_empty`）

### 3.5 送信（EIP-1559）

* `to = JPYC`, `value = 0`
* `data = transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)`
* `gas = eth_estimateGas`（EVM RPC 経由で取得）
* 手数料：`maxPriority = eth_maxPriorityFeePerGas * PRIORITY_MULTIPLIER`
  `maxFee = baseFee * MAX_FEE_MULTIPLIER + maxPriority`
* `nonce = eth_getTransactionCount(relayer)`（同キャニスターへリクエスト）
* **0x02 Typed RLP エンコード → tECDSA 署名 → eth_sendRawTransaction**（EVM RPC キャニスターへ送信）
* 戻り: `txHash`（ログ保存）

---

## 4. dfx / ローカル・ステージング・本番

### 4.1 ローカル（tECDSA 有効）

```bash
dfx start --clean --enable-tecdsa
dfx deploy relayer
# Admin 設定投入: set_rpc_target / set_chain_id / set_ecdsa_derivation_path / set_relayer_address / add_asset / set_threshold / pause(false)
# relayer の EVM アドレス表示APIを用意し MATIC (Amoy) を入金
```

### 4.2 ステージング（Polygon Amoy）

* EVM RPC ネットワーク/JPYC を Amoy 用に投入（例: `set_rpc_target` で `polygon-amoy` 指定）
* 少額で E2E（正常/失敗系）を一通り通す

### 4.3 本番（Polygon Mainnet）

* フラグ `pause(true)` で先に停止 → 設定投入 → `pause(false)`
* EVM RPC は polygon-mainnet（本番 ID）を指すよう再設定し確認
* まずは内部アカウントのみ→限定公開→全公開の順に段階解放

---

## 5. ログ/監視/運用

* **メトリクス**: 成功率、失敗理由内訳、p50/p95 レイテンシ、1日件数
* **アラート**:

  * ガス残高 < しきい値
  * 失敗率 > 5%（N分移動平均）
  * `domain_mismatch` が連続発生
* **ダッシュボード**: ガス残量ゲージ、直近Tx、失敗トップ3理由

---

## 6. エラーコード（固定）

| code              | ユーザー表示    | 対処                                 |
| ----------------- | --------- | ---------------------------------- |
| `gas_empty`       | リレー残高不足   | 管理者が MATIC 補充。通知登録を案内              |
| `expired`         | 期限切れ      | ワンタップ再署名                           |
| `used`            | 既に使用済み    | 新 nonce で再署名                       |
| `domain_mismatch` | 署名ドメイン不一致 | name/version/chainId/JPYC を再取得→再署名 |
| `estimation_fail` | 実行見積り失敗   | 金額・宛先・ネットワーク確認。再試行                 |
| `broadcast_fail`  | 送信失敗      | ネットワーク/nonce 競合。自動リトライ             |
| `rate_limited`    | 制限超過      | 時間を置く/上限表示                         |
| `paused`          | 一時停止中     | 再開見込み表示                            |

---

## 7. テスト計画（最小でもここまで）

* **ユニット**

  * EIP-712 ドメイン生成（name/version/chainId/contract 一致）
  * 署名パース（v/r/s）
  * RLP エンコード/EIP-1559 fee 計算
* **モックRPC**

  * authorizationState: 未使用/使用済み
  * 静的実行: 成功/Revert
* **Amoy E2E**

  * 正常 3件
  * 期限切れ/二重使用/ドメイン不一致/ガス枯渇/見積失敗 各1件
* **Polygon Mainnet ドライラン**

  * 少額 2件通過、Polygonscan と一致

---

## 8. セキュリティ/運用で先に潰すポイント（落とし穴）

* **固定メタ禁止**：JPYC の `name()` / `version()` / `decimals()` は**毎回コントラクトから取得**。固定すると `invalid signature` で落ちる。
* **ENV 直読み禁止**：キャニスターは ENV を読めない。**Admin API で設定**をオンチェーン保存。
* **tECDSA 忘れ**：ローカルで `--enable-tecdsa` 必須。キー名は `test_key_1` と本番 `secp256k1` を使い分け。
* **二重実行**：再試行で多重送信を招く。**idempotency key（from+nonce）** と **execution lock** を実装。
* **ガス監視なし**：送信前に必ず残高チェック。閾値下回りは**即エラー返却**。
* **サーキットブレーカ欠如**：失敗率急騰時に自動一時停止（`pause(true)`）。
* **旧トークン移行**：`Active→Deprecated→Disabled` の段階移行。**旧オーソリは旧 verifyingContract でのみ有効**。
* **レート制限**：1分毎/日次上限。異常連打はクールダウン。
* **取消導線**：JPYC の `cancelAuthorization(from,nonce)` を“高度設定”で用意。
* **監査ログ**：すべての入力・出力・RPC応答のハッシュ/要約を記録（PII は除外）。
* **エラー文の粒度**：ユーザー向けは簡潔、内部ログは詳細（RPCレスポンス含む）。

---

## 9. ロールアウト/ロールバック

* **ロールアウト**：Amoy 完了 → 本番で `pause(true)` → 設定投入 → 内部→限定→全開放 → メトリクス監視 → 閾値微調整
* **ロールバック**：`pause(true)` 即時停止、原因切り分け。必要なら `deprecate_asset` で新規受付を止める。

---

## 10. 参考 UI 文言（固定文）

* 署名モーダルの説明：

  ```
  この操作は「JPYC送金の承認署名」です。
  ガス(MATIC)は必要ありません。送金は運営リレーが実行します。
  署名の有効期限: 15分
  ```
* 完了：

  ```
  送金が完了しました。手数料: 0（提供済み）
  トランザクション: {txHash}（Polygonscanで確認）
  ```
* ガス枯渇：

  ```
リレー残高不足のため送金できません。管理者がMATICを補充すると再開されます。
  ```

---

### 付録A：Polygon/JPYC の前提

* チェーンID：**137**（本番）/ **80002**（Amoy）
* **JPYC(Polygon プロキシ)** を使用。アップグレードで実装アドレスが変わるため必ず Proxy を利用。
* `signTypedData` は MetaMask / WalletConnect で利用可。II は不要。

---

以上。
この md をプロジェクトの `docs/JPYC_GASLESS.md` に置いて、

* まず Amoy で E2E（正常/失敗）を**全部通す**
* その後に Polygon Mainnet ドライラン → 段階解放、で進めろ。
