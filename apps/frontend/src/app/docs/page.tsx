import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DocsIndex() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center gap-8 px-6 py-24 text-center">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold text-neutral-900">JPYC Gasless Relayer Docs</h1>
        <p className="text-sm text-neutral-600">
          仕組みの概要と、他のガスレス方式との比較をまとめています。知りたい内容に応じてサブページへ移動してください。
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Button asChild size="lg">
          <Link href="/docs/overview">仕組みの概要を見る</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/docs/comparison">他方式との比較を見る</Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href="/">アプリへ戻る</Link>
        </Button>
      </div>
    </div>
  );
}
