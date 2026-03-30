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
  name: 'bonds',
  description: 'Query TradingView Bonds screener',
  domain: 'www.tradingview.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Rows to return (1-100)' },
    { name: 'sort-by', default: 'bond_snp_rating_lt', help: 'Sort field (default: bond_snp_rating_lt)' },
    { name: 'sort-order', default: 'desc', choices: ['asc', 'desc'], help: 'Sort order: asc|desc' },
  ],
  columns: ['symbol', 'name', 'exchange', 'isin', 'yieldToWorst', 'closePct', 'closeNet', 'coupon', 'maturity', 'snp', 'fitch'],
  func: async (page, args) => {
    const limit = clampInt(args.limit, { min: 1, max: 100, fallback: 20 });
    const sortBy = String(args['sort-by'] ?? 'bond_snp_rating_lt').trim() || 'bond_snp_rating_lt';
    const sortOrder = (String(args['sort-order'] ?? 'desc').toLowerCase() as SortOrder) || 'desc';

    await page.goto('https://www.tradingview.com/bond-screener/');
    await page.wait(2);

    const result = await page.evaluate(`(async () => {
      const limit = ${JSON.stringify(limit)};
      const sortBy = ${JSON.stringify(sortBy)};
      const sortOrder = ${JSON.stringify(sortOrder)};

      const url = 'https://scanner.tradingview.com/bond/scan?label-product=screener-bond';
      const payload = {
        columns: [
          'ticker-view',
          'exchange.tr',
          'source-logoid',
          'isin-displayed',
          'yield_to_worst',
          'close_pct',
          'close_net',
          'type',
          'typespecs',
          'fundamental_currency_code',
          'current_coupon',
          'maturity_date',
          'redemption_type.tr',
          'bond_issuer_type.tr',
          'bond_snp_rating_lt.tr',
          'bond_fitch_rating_lt.tr',
        ],
        ignore_unknown_fields: false,
        options: { lang: 'en' },
        range: [0, limit],
        sort: { sortBy, sortOrder },
        symbols: {},
        markets: ['bond'],
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
          exchange: d[1] ?? null,
          isin: d[3] ?? null,
          yieldToWorst: d[4] ?? null,
          closePct: d[5] ?? null,
          closeNet: d[6] ?? null,
          coupon: d[10] ?? null,
          maturity: d[11] ?? null,
          redemption: d[12] ?? null,
          issuerType: d[13] ?? null,
          snp: d[14] ?? null,
          fitch: d[15] ?? null,
        });
      }
      return { ok: true, totalCount: json?.totalCount ?? null, out };
    })()`);

    if (!result || typeof result !== 'object') {
      throw new CliError('UNKNOWN', 'TradingView bond screener returned no result', 'Try again with --verbose to see details');
    }
    const r = result as { ok?: boolean; status?: number; body?: string; out?: unknown[] };
    if (!r.ok) {
      throw new CliError('FETCH_ERROR', `TradingView bond scan failed${r.status ? ` (HTTP ${r.status})` : ''}`, r.body || 'Try again later');
    }
    if (!Array.isArray(r.out) || r.out.length === 0) {
      throw new CliError('NOT_FOUND', 'No bond rows returned', 'Try again later');
    }
    return r.out;
  },
});

