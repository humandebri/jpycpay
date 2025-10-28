# JPYC ガスレスリレー運用メモ (Agent Notes)

このドキュメントは、エージェント視点で実施した作業内容と、今後運用する際の手順をまとめています。主に以下の観点を網羅します。

1. ローカル開発環境の構築・設定
2. Relayer canister のデプロイ・設定手順
3. JPYC 署名フローのテストに必要な情報
4. Polygon Amoy / Mainnet 向け移行手順
5. 本番ネットワーク (IC) でのウォレット準備とデプロイ

---

## 1. ローカル環境構築

### 1-1. DFX バージョン

- `dfx.json` の `dfx` フィールドは `0.24.3` に更新済み。
- `dfxvm install 0.24.3` で CLI を合わせておく。

### 1-2. `.env.local`

フロントエンド用 `.env.local` (Polygon Amoy 設定):

```
NEXT_PUBLIC_CHAIN_ID=80002
NEXT_PUBLIC_RPC_URL=https://polygon-amoy.g.alchemy.com/v2/REPLACE_WITH_KEY
NEXT_PUBLIC_EXPLORER_BASE=https://amoy.polygonscan.com
NEXT_PUBLIC_JPYC_ADDRESS=0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29
NEXT_PUBLIC_AUTH_VALIDITY_SECONDS=900
```

### 1-3. Relayer ローカルテスト

```
dfx start --clean --background
dfx deploy relayer
```

デプロイ後の設定コマンド:

```bash
dfx canister call relayer set_rpc_target '(principal "br5f7-7uaaa-aaaaa-qaaca-cai", "polygon-amoy")'
dfx canister call relayer set_chain_id '(80002)'
dfx canister call relayer set_ecdsa_derivation_path '(vec { blob "\00\00\00\00" })'
dfx canister call relayer set_relayer_address '("0xe1e5951f7d37c0124e9b7018a94ca637192f3576")'
dfx canister call relayer add_asset '(principal "be2us-64aaa-aaaaa-qaabq-cai", "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29", 0)'
```

> `be2us-64aaa-aaaaa-qaabq-cai` はローカルに用意した簡易 JPYC ラッパー canister。


## 2. Relayer canister 概要

- `canisters/relayer/src/lib.rs` は EVM RPC 仕様に従い、`RpcService::Chain(chain_id)` + JSON-RPC 形式で各 RPC (`eth_call`, `eth_estimateGas`, `eth_getBalance`, `eth_sendRawTransaction` 等) を呼び出す。
- `submit_authorization` 内の流れ:
  1. `authorizationState` チェック
  2. `eth_call` で静的実行
  3. `eth_estimateGas`
  4. Base fee / priority fee 取得 (`eth_getBlockByNumber`, `eth_maxPriorityFeePerGas`)
  5. `eth_getBalance` でガス残高検証
  6. EIP-1559 typed tx (0x02) の RLP と tECDSA 署名
  7. `eth_sendRawTransaction`
  8. ログ更新 (`PaymentStatus::Broadcasted`)
- `refresh_gas_balance` を追加 (await で `eth_getBalance` を再取得)。ただし**ローカルレプリカでは本番 RPC canister に接続不可**のため、本番ネットで実行するかモック RPC を用意する必要がある。


## 3. JPYC ラッパー (テスト用)

ローカルで principal を得るため、最小 Mo to canister を追加:

```
dfx canister create jpyc_wrapper
dfx deploy jpyc_wrapper
dfx canister id jpyc_wrapper  # => be2us-64aaa-aaaaa-qaabq-cai
```

この principal を `add_asset` に登録。実際の Amoy / Mainnet では Polygon ネイティブ JPYC (Proxy: `0xE7C3…`) をそのまま利用するので、principal 部分は運用用の canister (あるいは dummy principal) を登録しておく。


## 4. Polygon Amoy での E2E テスト

### 4-1. 実施事項

1. Derivation path と master public key からリレーの EVM アドレスを算出  
   - `@dfinity/ic-pub-key` CLI + `ethers.js` で `0xe1e5…` を導出済み。  
   - `derivationPath = hex:00000000,principal:bkyz2-fmaaa-aaaaa-qaaaq-cai`
2. Amoy の RPC を `.env.local` に設定し、フロントエンドで EIP-3009 署名 → relayer API へ POST。
3. `submit_authorization` の成功 / 失敗ケース（期限切れ、二重使用、ドメイン不一致 etc.）を確認。

### 4-2. ガス残高の反映

- `info` で `gas_wei` を確認。ローカルでは 0 のままだが、Amoy で `dfx canister --network ic call relayer refresh_gas_balance` を実行すれば反映される。
- WARN: ローカル環境から本番 ID (`br5f7-…`) を呼ぶと `DestinationInvalid` になる。テストネット / 本番ネットにデプロイした relayer でのみ有効。


## 5. Polygon Mainnet 移行手順（予定）

1. 設定内容を本番向けに置き換える:
   - `set_rpc_target '(principal "br5f7-7uaaa-aaaaa-qaaca-cai", "polygon-mainnet")'`
   - `set_chain_id '(137)'`
   - `set_relayer_address` は導出した Mainnet アドレスへ
2. `threshold_wei` や rate-limit 値の最終調整。
3. `pause(true)` → 設定アップデート → 少額ドライラン → `pause(false)` の順に公開範囲を拡大する。


## 6. IC 本番デプロイ (ウォレット準備)

1. `dfx identity use <production-id>`
2. ウォレット canister 作成:
   ```bash
   dfx ledger --network ic create-canister $(dfx identity get-principal) --amount <ICP>
   ```
   → 例: `rlhjx-iyaaa-aaaaf-qcnyq-cai`
3. ウォレット WASM をインストール:
   ```bash
   dfx identity deploy-wallet --network ic rlhjx-iyaaa-aaaaf-qcnyq-cai
   ```
4. ウォレット紐付け:
   ```bash
   dfx identity set-wallet --network ic --wallet rlhjx-iyaaa-aaaaf-qcnyq-cai
   ```
5. 残高確認: `dfx wallet --network ic balance`
6. `dfx canister --network ic create relayer`
7. `dfx deploy --network ic relayer`
8. Amoy / Mainnet 向け設定を本番で実行 (`set_*` 系コマンドはいずれも `--network ic` を付ける)。
9. `refresh_gas_balance` で MATIC 残高を取り込み。


## 7. 既知の注意点

- ローカルレプリカ → 本番 RPC へのアクセスは不可。`DestinationInvalid` エラーになるため、モック RPC を用意するか、本番/Amoy にデプロイしてから `refresh_gas_balance` を実行する。
- `dfx identity use production` の状態で `dfx wallet --network ic create` は存在しないコマンド。v0.24 系では `create-canister` + `deploy-wallet` の手順でウォレットを用意する。
- `dfx canister call` で `--network ic` を付ける場合、対象 canister と同一ネットワークにデプロイされている必要がある。ローカルの relayer に対して `--network ic` を付けると `Cannot find canister id` になる。


## 8. 次のステップ

1. Polygon Amoy での E2E 成功/失敗ケース評価を実施 (フロント → relayer → EVM RPC)。
2. 本番用ウォレットに cycles を補充し、`relayer` canister を Amoy / Mainnet にデプロイ。
3. `info` / `logs` の実測値をモニタリングし、閾値や rate-limit の調整、失敗時リトライ戦略を固める。
4. Mainnet リリース: 内部 → 限定 → 全体公開の順で段階的に `pause(false)` にする。

---

必要に応じてこのメモにアップデートを追加してください。特に本番移行時のフローとウォレット運用は、明確な手順を維持することが重要です。

