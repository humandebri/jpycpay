import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Card className="border-neutral-200 bg-white">
    <CardHeader>
      <CardTitle className="text-lg text-neutral-900">{title}</CardTitle>
    </CardHeader>
    <CardContent className="space-y-4 text-sm text-neutral-600">
      {children}
    </CardContent>
  </Card>
);

const List = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <ul className={cn("list-disc space-y-2 pl-5 text-sm text-neutral-600", className)}>
    {children}
  </ul>
);

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <Section title="仕組みの全体像">
        <p>
          JPYC Gasless Relayer は EIP-3009 (TransferWithAuthorization) を利用し、ユーザーが JPYC
          トークンを直接送金する代わりに「送金許可証（Authorization）」を署名してリレーに渡す構成です。
        </p>
        <List>
          <li>EIP-712 形式で TransferWithAuthorization を署名（有効期限付き）</li>
          <li>署名済みデータを Next.js フロント → API Route → ICP relayer canister に送信</li>
          <li>Relayer は EVM RPC canister 経由で余剰ガス確認・静的実行・Tx 署名・ブロードキャスト</li>
          <li>ブロードキャスト後の Tx ハッシュをログに記録し、ステータス API から参照可能</li>
        </List>
      </Section>

      <Section title="コンポーネント">
        <List>
          <li>ユーザーフロント: Next.js + wagmi + viem でウォレット接続・署名 UI を提供</li>
          <li>ICP relayer: Rust canister、`submit_authorization` 内で検証・EIP-1559 tx 作成・tECDSA 署名</li>
          <li>EVM RPC canister: `7hfb6-...` を利用し JSON-RPC を複数プロバイダから集約</li>
          <li>ログ監視: `logs`/`info` API で relayer の状態をダッシュボード化</li>
        </List>
      </Section>

      <Section title="ガスレスの流れ">
        <List>
          <li>ユーザーはガス代を負担せず MetaMask 等で署名のみ</li>
          <li>Relayer が MATIC を保持し、`refresh_gas_balance` で残高監視。閾値 (`set_threshold`) を下回ると警告</li>
          <li>EIP-3009 の `validBefore` を利用し無期限悪用を防止。nonce 利用で二重使用も防止</li>
          <li>トークン転送は relayer が EIP-1559 署名 → `eth_sendRawTransaction`</li>
        </List>
      </Section>

      <Section title="セキュリティ・ガバナンス">
        <List>
          <li>管理者のみ `set_rpc_endpoint` / `set_chain_id` 等の更新を許可 (`ensure_admin`)</li>
          <li>Relayer 側で rate limit, daily cap を実装し過剰送信を抑制</li>
          <li>ログに失敗理由が記録され、誤署名や期限切れをトラブルシュート可能</li>
          <li>Relayer の秘密鍵は存在せず ICP の tECDSA により署名</li>
        </List>
      </Section>
    </div>
  );
}
