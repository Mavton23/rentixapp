import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/format';

/**
 * Renderiza Markdown. HTML embutido é ignorado (comportamento seguro por omissão do react-markdown),
 * por isso o conteúdo nunca injeta scripts na página.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        'text-[17px] leading-[1.7] text-ink',
        '[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-2xl [&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:text-xl',
        '[&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1',
        '[&_a]:text-brand [&_a]:underline [&_strong]:font-semibold',
        '[&_blockquote]:my-6 [&_blockquote]:border-l-2 [&_blockquote]:border-brand [&_blockquote]:pl-4 [&_blockquote]:text-ink-soft',
        '[&_table]:my-6 [&_table]:w-full [&_td]:border-b [&_td]:border-line [&_td]:py-2 [&_th]:border-b [&_th]:border-line-strong [&_th]:py-2 [&_th]:text-left',
        '[&_code]:rounded [&_code]:bg-paper [&_code]:px-1 [&_code]:text-[0.9em] [&_img]:my-6 [&_img]:rounded-panel',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
