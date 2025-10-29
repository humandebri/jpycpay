import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

const Table = ({ children }: { children: React.ReactNode }) => (
  <div className="overflow-hidden rounded-2xl border border-neutral-200">
    <table className="w-full table-fixed border-collapse text-sm text-neutral-600">
      {children}
    </table>
  </div>
);

export default function ComparisonPage() {
  return (
    <div className="space-y-6">
      <Section title="主な比較対象">
        <p>
          ここでは他のアカウントアブストラクション (AA) 系のガスレス送金と比較し、ICP Relayer の特徴を整理します。
        </p>
        <Table>
          <thead className="bg-neutral-100 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="w-1/4 p-3">項目</th>
              <th className="w-1/4 p-3">ICP Relayer</th>
              <th className="w-1/4 p-3">ERC-4337 Bundler</th>
              <th className="w-1/4 p-3">中央集権的 Relayer</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-neutral-200">
              <td className="p-3 font-medium text-neutral-700">ウォレット要件</td>
              <td className="p-3">通常の EOA で OK (EIP-3009 の署名のみ)</td>
              <td className="p-3">スマートウォレット or Paymaster 対応が必要</td>
              <td className="p-3">サービスが指定した API を使用</td>
            </tr>
            <tr className="border-t border-neutral-200">
              <td className="p-3 font-medium text-neutral-700">ガス代負担</td>
              <td className="p-3">Relayer (ICP) が MATIC を保持し消費</td>
              <td className="p-3">Paymaster or Sponsor</td>
              <td className="p-3">運営側がガスを肩代わり</td>
            </tr>
            <tr className="border-t border-neutral-200">
              <td className="p-3 font-medium text-neutral-700">主な利点</td>
              <td className="p-3">
                <ul className="list-disc space-y-1 pl-4">
                  <li>現行ウォレットでそのまま利用可能</li>
                  <li>ガスレスでもオンチェーン署名履歴が残る</li>
                  <li>ICP 側の管理機能 (rate limit, logs) が豊富</li>
                </ul>
              </td>
              <td className="p-3">
                <ul className="list-disc space-y-1 pl-4">
                  <li>AA エコシステムとの親和性が高い</li>
                  <li>スマートウォレット機能を活用可能</li>
                </ul>
              </td>
              <td className="p-3">
                <ul className="list-disc space-y-1 pl-4">
                  <li>実装がシンプル</li>
                  <li>管理画面で簡単に制御可能</li>
                </ul>
              </td>
            </tr>
            <tr className="border-t border-neutral-200">
              <td className="p-3 font-medium text-neutral-700">懸念事項</td>
              <td className="p-3">
                <ul className="list-disc space-y-1 pl-4">
                  <li>Relayer のガス残高管理が必要</li>
                  <li>Authorization の有効期限設定を怠るとリスク</li>
                </ul>
              </td>
              <td className="p-3">
                <ul className="list-disc space-y-1 pl-4">
                  <li>AA 対応ウォレットがまだ限定的</li>
                  <li>Bundler/Paymaster の運用コスト</li>
                </ul>
              </td>
              <td className="p-3">
                <ul className="list-disc space-y-1 pl-4">
                  <li>中央集権的な信頼に依存</li>
                  <li>監査ログや権限管理が不透明なケースも</li>
                </ul>
              </td>
            </tr>
          </tbody>
        </Table>
      </Section>

      <Section title="ユースケース適合性">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Badge variant="success">ICP Relayer が適するケース</Badge>
            <ul className="list-disc space-y-1 pl-4">
              <li>既存 EOA ユーザーを対象にガスレス提供したい</li>
              <li>KYC 済みユーザーの送金をロギングし管理したい</li>
              <li>ICP 側で権限管理・レート制限・監査を行いたい</li>
            </ul>
          </div>
          <div className="space-y-2">
            <Badge variant="secondary">ERC-4337 系が適するケース</Badge>
            <ul className="list-disc space-y-1 pl-4">
              <li>スマートウォレット機能（Social Recovery 等）も提供したい</li>
              <li>dApp 全体を AA 化したい</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section title="まとめ">
        <p>
          ICP Relayer は「既存ウォレット + ガスレス」を最小構成で実現しつつ、ICP 側のリレーが堅牢な権限管理とログを担うのが特徴です。
          ERC-4337 ベースの AA はより柔軟ですが導入コストが高く、中央集権型リレーは手軽な一方トラストが課題です。ユースケースごとに選択肢を見極めるのが重要です。
        </p>
      </Section>
    </div>
  );
}
