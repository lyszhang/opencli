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
  name: 'etfs',
  description: 'Query TradingView ETFs screener',
  domain: 'www.tradingview.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'market', default: 'america', help: 'Scanner market (default: america). Endpoint: scanner.tradingview.com/<market>/scan?label-product=screener-etf' },
    { name: 'limit', type: 'int', default: 20, help: 'Rows to return (1-100)' },
    { name: 'sort-by', default: 'aum', help: 'Sort field (default: aum)' },
    { name: 'sort-order', default: 'desc', choices: ['asc', 'desc'], help: 'Sort order: asc|desc' },
  ],
  columns: ['symbol', 'name', 'exchange', 'close', 'change', 'aum', 'expenseRatio', 'assetClass', 'focus'],
  func: async (page, args) => {
    const limit = clampInt(args.limit, { min: 1, max: 100, fallback: 20 });
    const market = String(args.market ?? 'america').trim() || 'america';
    const sortBy = String(args['sort-by'] ?? 'aum').trim() || 'aum';
    const sortOrder = (String(args['sort-order'] ?? 'desc').toLowerCase() as SortOrder) || 'desc';

    await page.goto('https://www.tradingview.com/etf-screener/');
    await page.wait(2);

    const result = await page.evaluate(`(async () => {
      const market = ${JSON.stringify(market)};
      const limit = ${JSON.stringify(limit)};
      const sortBy = ${JSON.stringify(sortBy)};
      const sortOrder = ${JSON.stringify(sortOrder)};

      const url = 'https://scanner.tradingview.com/' + encodeURIComponent(market) + '/scan?label-product=screener-etf';

      const payload = {
        columns: [
          'ticker-view',
          'close',
          'type',
          'typespecs',
          'pricescale',
          'minmov',
          'fractional',
          'minmove2',
          'currency',
          'change',
          'Value.Traded',
          'relative_volume_10d_calc',
          'aum',
          'fundamental_currency_code',
          'nav_total_return.3Y',
          'expense_ratio',
          'asset_class.tr',
          'focus.tr',
        ],
        ignore_unknown_fields: false,
        options: { lang: 'en' },
        range: [0, limit],
        sort: { sortBy, sortOrder },
        symbols: {},
        markets: [market],
        filter2: {
          operator: 'and',
          operands: [
            {
              operation: {
                operator: 'or',
                operands: [
                  { operation: { operator: 'and', operands: [{ expression: { left: 'typespecs', operation: 'has', right: ['etf'] } }] } },
                  { operation: { operator: 'and', operands: [{ expression: { left: 'type', operation: 'equal', right: 'structured' } }] } },
                ],
              },
            },
          ],
        },
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
          name: String(tv?.description || tv?.name || ''),
          exchange: String(tv?.exchange || ''),
          close: d[1] ?? null,
          change: d[9] ?? null,
          valueTraded: d[10] ?? null,
          aum: d[12] ?? null,
          navTotalReturn3Y: d[14] ?? null,
          expenseRatio: d[15] ?? null,
          assetClass: d[16] ?? null,
          focus: d[17] ?? null,
        });
      }
      return { ok: true, totalCount: json?.totalCount ?? null, out };
    })()`);

    if (!result || typeof result !== 'object') {
      throw new CliError('UNKNOWN', 'TradingView ETF screener returned no result', 'Try again with --verbose to see details');
    }
    const r = result as { ok?: boolean; status?: number; body?: string; out?: unknown[] };
    if (!r.ok) {
      throw new CliError('FETCH_ERROR', `TradingView ETF scan failed${r.status ? ` (HTTP ${r.status})` : ''}`, r.body || 'Try again later');
    }
    if (!Array.isArray(r.out) || r.out.length === 0) {
      throw new CliError('NOT_FOUND', 'No ETF rows returned', 'Try a different --market');
    }
    return r.out;
  },
});

