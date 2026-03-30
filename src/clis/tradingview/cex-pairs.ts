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
  name: 'cex-pairs',
  description: 'Query TradingView CEX pairs screener',
  domain: 'www.tradingview.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Rows to return (1-100)' },
    { name: 'sort-by', default: '24h_vol|5', help: 'Sort field (default: 24h_vol|5)' },
    { name: 'sort-order', default: 'desc', choices: ['asc', 'desc'], help: 'Sort order: asc|desc' },
  ],
  columns: ['symbol', 'exchange', 'pair', 'close', 'change24hPct', 'vol24h', 'vol24hChangePct', 'rating'],
  func: async (page, args) => {
    const limit = clampInt(args.limit, { min: 1, max: 100, fallback: 20 });
    const sortBy = String(args['sort-by'] ?? '24h_vol|5').trim() || '24h_vol|5';
    const sortOrder = (String(args['sort-order'] ?? 'desc').toLowerCase() as SortOrder) || 'desc';

    await page.goto('https://www.tradingview.com/cex-screener/');
    await page.wait(2);

    const result = await page.evaluate(`(async () => {
      const limit = ${JSON.stringify(limit)};
      const sortBy = ${JSON.stringify(sortBy)};
      const sortOrder = ${JSON.stringify(sortOrder)};

      const url = 'https://scanner.tradingview.com/crypto/scan?label-product=screener-crypto-cex';
      const payload = {
        columns: [
          'ticker-view',
          'exchange.tr',
          'provider-id',
          'close',
          'type',
          'typespecs',
          'pricescale',
          'minmov',
          'fractional',
          'minmove2',
          'currency',
          '24h_close_change|5',
          '24h_vol|5',
          '24h_vol_change|5',
          'TechRating_1D',
          'TechRating_1D.tr',
        ],
        ignore_unknown_fields: false,
        options: { lang: 'en' },
        range: [0, limit],
        sort: { sortBy, sortOrder },
        symbols: {},
        markets: ['crypto'],
        filter2: { operator: 'and', operands: [{ expression: { left: 'centralization', operation: 'equal', right: 'cex' } }] },
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'text/plain;charset=UTF-8' },
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
          symbol: String(s),
          exchange: d[1] ?? null,
          provider: d[2] ?? null,
          pair: String(tv?.name || ''),
          description: String(tv?.description || ''),
          close: d[3] ?? null,
          change24hPct: d[11] ?? null,
          vol24h: d[12] ?? null,
          vol24hChangePct: d[13] ?? null,
          rating: d[14] ?? null,
          ratingText: d[15] ?? null,
        });
      }
      return { ok: true, totalCount: json?.totalCount ?? null, out };
    })()`);

    if (!result || typeof result !== 'object') {
      throw new CliError('UNKNOWN', 'TradingView CEX screener returned no result', 'Try again with --verbose to see details');
    }
    const r = result as { ok?: boolean; status?: number; body?: string; out?: unknown[] };
    if (!r.ok) {
      throw new CliError('FETCH_ERROR', `TradingView CEX scan failed${r.status ? ` (HTTP ${r.status})` : ''}`, r.body || 'Try again later');
    }
    if (!Array.isArray(r.out) || r.out.length === 0) {
      throw new CliError('NOT_FOUND', 'No CEX pairs returned', 'Try again later');
    }
    return r.out;
  },
});

