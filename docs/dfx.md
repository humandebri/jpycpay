🚀 Deploy Canisters without Wallet (df 0.24.3 以降)
1️⃣ 前提

dfx 0.24.3 以降

あなたの identity に cycles があること （確認は dfx cycles balance --network ic）

dfx.json に canister 定義が記載済み（例：relayer）

2️⃣ Canister 作成
# 新規 canister を identity 直轄で作成 (1 ICP を cycles に変換、fiduciary サブネットへ配置)
dfx ledger --network ic create-canister "$(dfx identity get-principal)" --amount 1 --subnet-type fiduciary


出力例:

Transfer sent at block height 29371823
Using transfer at block height 29371823
Canister created with id: "evkq6-tyaaa-aaaar-qbxza-cai"


🧠 ここで作成された canister は あなたの identity が controller になる。
wallet canister は不要。

3️⃣ Cycles を 追加補給（任意）
# 例：追加 1 ICP を cycles に変換して補充
dfx ledger --network ic top-up evkq6-tyaaa-aaaar-qbxza-cai --amount 1

4️⃣ デプロイ （初回 install）
dfx canister --network ic install evkq6-tyaaa-aaaar-qbxza-cai --no-wallet \
  --mode install \
  --wasm target/wasm32-unknown-unknown/release/relayer.wasm


⚠️ --specified-id は 本番 IC ネットワーク では無視される場合がある。
その場合は 「create-canister 時に得た ID 」を dfx.json に 書いておく ほうが 安定。

dfx.json 例：

{
  "canisters": {
    "relayer": {
      "main": "src/relayer/main.rs",
      "type": "rust",
      "wasm": "target/wasm32-unknown-unknown/release/relayer.wasm.gz",
      "candid": "relayer.did"
    }
  },
  "networks": { "ic": { "providers": ["https://ic0.app"], "type": "persistent" } }
}

5️⃣ 再デプロイ（アップグレード）
dfx canister --network ic install evkq6-tyaaa-aaaar-qbxza-cai --no-wallet \
  --mode upgrade \
  --wasm target/wasm32-unknown-unknown/release/relayer.wasm


🔁 upgrade は 状態保持。
完全初期化 したい場合は --mode reinstall を 使う。

6️⃣ 確認
dfx canister --network ic status evkq6-tyaaa-aaaar-qbxza-cai


出力例:

Status: Running
Controllers: <your principal>
Balance: 4_000_000_000_000 Cycles
Module hash: 0x...

7️⃣ トラブル対処メモ
症状	原因	対処
is out of cycles	canister 残高 不足	dfx ledger --network ic top-up <id> --amount 1
The wallet canister … already exists	旧 wallet 参照	dfx identity get-wallet --network ic で確認後 未使用 なら 無視
Cannot find canister id	dfx.json 未登録	.dfx/ic/canister_ids.json に ID を 記載 or 再 create
8️⃣ 参考コマンド 一覧
目的	コマンド
ICP 残高 確認	dfx ledger --network ic balance
Cycles 残高 確認	dfx cycles balance --network ic
Canister 作成	dfx ledger --network ic create-canister "$(dfx identity get-principal)" --amount 1 --subnet-type fiduciary
Cycles 補給	dfx ledger --network ic top-up <CANISTER_ID> --amount 1
デプロイ	dfx canister --network ic install <CANISTER_ID> --no-wallet --wasm target/wasm32-unknown-unknown/release/relayer.wasm
状態 確認	dfx canister --network ic status <CANISTER_ID>
