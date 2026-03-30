import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';

function clampInt(n: unknown, { min, max, fallback }: { min: number; max: number; fallback: number }): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(Math.trunc(v), max));
}

cli({
  site: 'tradingview',
  name: 'watchlist',
  description: 'Get the current TradingView watchlist table from homepage',
  domain: 'www.tradingview.com',
  strategy: Strategy.COOKIE,
  args: [{ name: 'limit', type: 'int', default: 20, help: 'Max rows to return (1-100)' }],
  columns: ['symbol', 'last', 'chg', 'chgPct'],
  func: async (page, args) => {
    const limit = clampInt(args.limit, { min: 1, max: 100, fallback: 20 });

    await page.goto('https://www.tradingview.com/');
    await page.wait(3);

    const rows = await page.evaluate(`(async () => {
      const simplify = (s) => String(s ?? '').replace(/\\s+/g, ' ').trim();
      const firstSymbol = (text) => {
        const t = simplify(text);
        const matches = t.match(/[A-Z0-9!\\.]{2,30}/g) || [];
        // Prefer longer plausible tickers, but avoid 1-letter logo artifacts.
        const sorted = matches
          .map(s => s.replace(/[^A-Z0-9!\\.]/g, ''))
          .filter(s => s.length >= 3 && s.length <= 20)
          .sort((a, b) => b.length - a.length);
        return sorted[0] || '';
      };

      // The homepage watchlist is a client-rendered table with hashed classnames.
      // We select by stable class *fragments* observed across builds: symbolName-, last-, change-, changeInPercents-.
      const candidates = Array.from(document.querySelectorAll('div[class*=\"symbol-\"]'));
      const items = [];
      for (const el of candidates) {
        const symEl = el.querySelector('[class*=\"symbolName-\"]');
        const lastEl = el.querySelector('[class*=\"last-\"]');
        const chgEl = el.querySelector('[class*=\"change-\"]');
        const pctEl = el.querySelector('[class*=\"changeInPercents-\"]');
        if (!symEl || !lastEl || !chgEl || !pctEl) continue;

        // TradingView often includes a dedicated span for ticker text.
        const symTextEl = symEl.querySelector('[class*=\"symbolNameText-\"]');
        const symbol = simplify(symTextEl?.textContent) || firstSymbol(symEl.textContent);
        if (!symbol) continue;
        items.push({
          symbol,
          last: simplify(lastEl.textContent),
          chg: simplify(chgEl.textContent),
          chgPct: simplify(pctEl.textContent),
        });
      }

      // Deduplicate (same symbol may appear twice due to hidden columns / overlays)
      const seen = new Set();
      const out = [];
      for (const it of items) {
        const key = it.symbol + '|' + it.last + '|' + it.chg + '|' + it.chgPct;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
      }
      return out;
    })()`);

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new CliError(
        'NOT_FOUND',
        'No watchlist rows found on TradingView homepage.',
        'Try opening https://www.tradingview.com/ in Chrome once, or ensure the watchlist panel is visible.',
      );
    }

    return rows.slice(0, limit);
  },
});

