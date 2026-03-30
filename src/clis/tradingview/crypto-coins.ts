import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';

function clampInt(n: unknown, { min, max, fallback }: { min: number; max: number; fallback: number }): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(Math.trunc(v), max));
}

type SortOrder = 'asc' | 'desc';

cli({
  site: 'tradingview',
  name: 'crypto-coins',
  description: 'Query TradingView Crypto Coins screener (coin scanner)',
  domain: 'www.tradingview.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Rows to return (1-100)' },
    { name: 'sort-by', default: 'crypto_total_rank', help: 'Sort field (default: crypto_total_rank)' },
    { name: 'sort-order', default: 'asc', choices: ['asc', 'desc'], help: 'Sort order: asc|desc' },
  ],
  columns: ['rank', 'symbol', 'name', 'close', 'change24hPct', 'marketCap', 'vol24h', 'circulating', 'volToMcap'],
  func: async (page, args) => {
    const limit = clampInt(args.limit, { min: 1, max: 100, fallback: 20 });
    const sortBy = String(args['sort-by'] ?? 'crypto_total_rank').trim() || 'crypto_total_rank';
    const sortOrder = (String(args['sort-order'] ?? 'asc').toLowerCase() as SortOrder) || 'asc';

    // Establish session/cookies (also mirrors how the site does it).
    await page.goto('https://www.tradingview.com/crypto-coins-screener/');
    await page.wait(2);

    const result = await page.evaluate(`(async () => {
      const limit = ${JSON.stringify(limit)};
      const sortBy = ${JSON.stringify(sortBy)};
      const sortOrder = ${JSON.stringify(sortOrder)};

      const url = 'https://scanner.tradingview.com/coin/scan?label-product=screener-coin';
      const payload = {
        columns: [
          'ticker-view',
          'crypto_total_rank',
          'close',
          '24h_close_change|5',
          'market_cap_calc',
          '24h_vol_cmc',
          'circulating_supply',
          '24h_vol_to_market_cap',
          'crypto_common_categories.tr',
        ],
        ignore_unknown_fields: false,
        options: { lang: 'en' },
        range: [0, limit],
        sort: { sortBy, sortOrder },
        symbols: {},
        markets: ['coin'],
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'text/plain;charset=UTF-8',
        },
        body: JSON.stringify(payload),
        credentials: 'include',
      });

      const text = await res.text();
      if (!res.ok) return { ok: false, status: res.status, body: text.slice(0, 200) };
      const json = JSON.parse(text);
      const rows = Array.isArray(json?.data) ? json.data : [];

      const out = [];
      for (const row of rows) {
        const s = row?.s || '';
        const d = Array.isArray(row?.d) ? row.d : [];
        const tv = d[0] || {};
        out.push({
          rank: d[1] ?? null,
          symbol: String(tv?.name || ''),
          name: String(tv?.description || ''),
          close: d[2] ?? null,
          change24hPct: d[3] ?? null,
          marketCap: d[4] ?? null,
          vol24h: d[5] ?? null,
          circulating: d[6] ?? null,
          volToMcap: d[7] ?? null,
          categories: Array.isArray(d[8]) ? d[8] : (d[8] ? [String(d[8])] : []),
          tradingviewSymbol: String(s),
          exchange: String(tv?.exchange || ''),
        });
      }

      return { ok: true, totalCount: json?.totalCount ?? null, out };
    })()`);

    if (!result || typeof result !== 'object') {
      throw new CliError('UNKNOWN', 'TradingView crypto screener returned no result', 'Try again with --verbose to see details');
    }
    const r = result as { ok?: boolean; status?: number; body?: string; out?: unknown[] };
    if (!r.ok) {
      throw new CliError(
        'FETCH_ERROR',
        `TradingView coin scanner request failed${r.status ? ` (HTTP ${r.status})` : ''}`,
        typeof r.body === 'string' && r.body ? r.body : 'Try again later, or open TradingView in Chrome and ensure you are not blocked.',
      );
    }
    if (!Array.isArray(r.out) || r.out.length === 0) {
      throw new CliError('NOT_FOUND', 'No crypto coins returned', 'Try again later');
    }
    return r.out;
  },
});

