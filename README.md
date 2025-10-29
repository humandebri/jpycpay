# ICP Gasless JPYC Relayer (Skeleton)

このリポジトリは、Polygon JPYC のガスレス送金 (EIP-3009) を ICP キャニスター上で実装するための最小骨格です。  
`docs/JPYC_GASLESS.md` に全体設計と運用指針をまとめています。

## 構成

- `dfx.json` — relayer キャニスターの dfx 設定
- `canisters/relayer` — Rust 実装
  - `Cargo.toml` — 依存関係とビルド設定
  - `relayer.did` — Candid IF 定義
  - `src/lib.rs` — ステート管理・管理 API・EVM RPC 呼び出しラッパ
- `docs/JPYC_GASLESS.md` — 詳細ドキュメント

## 使い方

```bash
cargo build --target wasm32-unknown-unknown --release --package relayer
dfx deploy relayer
# 例: 管理設定投入
# dfx canister call relayer set_rpc_endpoint '("https://polygon-rpc.com")'
# dfx canister call relayer set_chain_id '(137)'
# dfx canister call relayer set_ecdsa_derivation_path '(vec { blob "\\00..." })'
# dfx canister call relayer set_relayer_address '("0x...")'
# dfx canister call relayer add_asset '(principal "<JPYC principal>", "0x..", 0)'
# dfx canister call relayer pause '(false)'
```

> 初回ビルド時にはレジストリへのアクセスが必要です。ネットワーク制限がある環境では、事前にキャッシュを用意するか、依存クレートを vendoring してください。

## 次のステップ

1. tECDSA キー管理とアドレス算出フロー（`set_ecdsa_derivation_path` / `set_relayer_address`）の自動化と監査ログ出力を整備する。
2. レート制限や RPC モックを使ったユニット/統合テストを追加し、ネットワーク有効な環境で CI を構築する。
3. フロントエンド（wagmi/viem）を別リポジトリまたは `apps/frontend` として用意し、EIP-3009 署名フローを接続する。
4. Amoy / Polygon Mainnet 環境向けのデプロイスクリプトと監視メトリクス連携を整備する。
