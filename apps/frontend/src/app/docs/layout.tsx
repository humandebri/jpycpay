import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">JPYC Gasless Relayer</h1>
          <p className="text-sm text-neutral-500">
            仕組みと比較。リレーの理解に役立つドキュメントです。
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" asChild>
            <Link href="/">アプリに戻る</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/docs/overview">概要</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/docs/comparison">他方式との比較</Link>
          </Button>
        </div>
      </header>
      <main className="flex-1 space-y-6">{children}</main>
    </div>
  );
}
