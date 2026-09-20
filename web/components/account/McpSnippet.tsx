'use client';

import { useEffect, useState } from 'react';
import InstallSnippets from '@/components/connect/InstallSnippets';
import { keySnippets } from '@/lib/connect/snippets';

/**
 * How to plug a coding agent into the remote MCP server with a freshly
 * minted key. The key appears only here, only once. The site origin is read
 * from the page itself so previews and the custom domain both print right.
 */
export default function McpSnippet({ apiKey }: { apiKey: string }) {
  const [origin, setOrigin] = useState<string>(process.env.NEXT_PUBLIC_SITE_URL ?? '');
  useEffect(() => {
    if (!origin && typeof window !== 'undefined') setOrigin(window.location.origin);
  }, [origin]);
  if (!origin) return null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Or skip the key entirely: <a href="/connect" className="text-ink underline underline-offset-2">/connect</a> shows the OAuth one-liner where the agent opens this site and you approve in the browser.
      </p>
      <InstallSnippets snippets={keySnippets(origin, apiKey)} compact />
    </div>
  );
}
