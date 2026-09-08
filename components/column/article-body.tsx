import Link from 'next/link';
import type { ColumnInline, ColumnNode } from '@/lib/column/markdown';

/**
 * コラム本文の描画。
 * 生成モデルの出力を HTML として実行しないため、解析済みノードだけを React 要素にする。
 * スタイルはこのコンポーネント内の Tailwind ユーティリティに閉じており、
 * 既存ページの h1/p/a/table などへグローバルに影響しない。
 */

function Inlines({ nodes }: { nodes: ColumnInline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === 'strong') return <strong key={i} className="font-semibold text-ink">{n.value}</strong>;
        if (n.type === 'link') {
          return n.external ? (
            <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="text-brown underline underline-offset-4 hover:text-brown-dark">
              {n.value}
            </a>
          ) : (
            <Link key={i} href={n.href} className="text-brown underline underline-offset-4 hover:text-brown-dark">
              {n.value}
            </Link>
          );
        }
        return <span key={i}>{n.value}</span>;
      })}
    </>
  );
}

export function ColumnArticleBody({ nodes }: { nodes: ColumnNode[] }) {
  return (
    <div className="mt-8 space-y-5 text-[0.95rem] leading-[2] text-ink-soft">
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'heading':
            return node.level === 2 ? (
              <h2 key={i} id={node.id} className="scroll-mt-24 border-l-2 border-gold pt-6 pl-3 font-serif text-xl leading-snug text-ink sm:text-2xl">
                {node.text}
              </h2>
            ) : (
              <h3 key={i} id={node.id} className="scroll-mt-24 pt-3 font-serif text-base leading-snug text-ink sm:text-lg">
                {node.text}
              </h3>
            );
          case 'paragraph':
            return (
              <p key={i}>
                <Inlines nodes={node.children} />
              </p>
            );
          case 'list':
            return node.ordered ? (
              <ol key={i} className="list-decimal space-y-2 pl-6 marker:text-gold">
                {node.items.map((item, j) => (
                  <li key={j}>
                    <Inlines nodes={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i} className="list-disc space-y-2 pl-6 marker:text-gold">
                {node.items.map((item, j) => (
                  <li key={j}>
                    <Inlines nodes={item} />
                  </li>
                ))}
              </ul>
            );
          case 'quote':
            return (
              <blockquote key={i} className="border-l-2 border-line pl-4 text-ink-soft/90 italic">
                <Inlines nodes={node.children} />
              </blockquote>
            );
          case 'table':
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full min-w-[32rem] border-collapse text-sm">
                  <thead>
                    <tr>
                      {node.head.map((h, j) => (
                        <th key={j} className="border border-line bg-sand px-3 py-2 text-left font-semibold text-ink">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {node.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td key={k} className="border border-line px-3 py-2 align-top leading-relaxed">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'hr':
            return <hr key={i} className="border-line" />;
        }
      })}
    </div>
  );
}
