import { CopyPill } from '@/components/Pill';
import { PRIMARY_RELAY } from '@/lib/relays';

const REPO = 'https://github.com/jashanpratapsingh/vendx-htn.git';

function Block({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="plate">{label}</span>
        <CopyPill value={text} label="copy" />
      </div>
      <pre className="paper readout overflow-x-auto whitespace-pre-wrap break-all px-4 py-3 text-[12px] leading-relaxed text-ink">{text}</pre>
    </div>
  );
}

/**
 * How to plug a Claude Code agent into VENDX with a freshly minted key. The
 * key appears only here, only once.
 */
export default function McpSnippet({ apiKey }: { apiKey: string }) {
  const relay = process.env.NEXT_PUBLIC_RELAY_URL ?? PRIMARY_RELAY.url;
  const clone = [
    `git clone ${REPO} && cd vendx-htn`,
    'npm install && npm run build -w @vendx/protocol && npm run build -w @vendx/agent-buyer',
  ].join('\n');
  const mcp = `claude mcp add -s user -e VENDX_API_KEY=${apiKey} -e RELAY_URL=${relay} vendx -- node "$PWD/agent-buyer/dist/mcp.js"`;
  const cli = `RELAY_URL=${relay} VENDX_API_KEY=${apiKey} node agent-buyer/dist/index.js`;
  return (
    <div className="flex flex-col gap-5">
      <Block label="1 · clone and build (once)" text={clone} />
      <Block label="2 · register the MCP server with Claude Code (run from the clone)" text={mcp} />
      <p className="text-[13px] leading-relaxed text-ink-muted">
        Then, in any Claude Code session: <span className="readout text-ink">vendx_wallet</span> shows the buyer wallet and
        how to fund it with devnet USDC, <span className="readout text-ink">vendx_list_devices</span> lists what is for sale,
        <span className="readout text-ink"> vendx_buy_reading</span> pays and returns the telemetry, and
        <span className="readout text-ink"> vendx_my_purchases</span> lists what this agent bought. Every purchase appears on this page.
      </p>
      <Block label="alternative · one purchase from the CLI" text={cli} />
    </div>
  );
}
