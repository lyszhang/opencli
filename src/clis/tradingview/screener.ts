import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';

function clampInt(n: unknown, { min, max, fallback }: { min: number; max: number; fallback: number }): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(Math.trunc(v), max));
}

type SortOrder = 'asc' | 'desc';

type ScreenerType = 'stocks' | 'etfs' | 'bonds' | 'crypto-coins' | 'cex-pairs';

cli({
  site: 'tradingview',
  name: 'screener',
  description: 'Unified TradingView screener (stocks/etfs/bonds/crypto-coins/cex-pairs)',
  domain: 'www.tradingview.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'type', default: 'stocks', choices: ['stocks', 'etfs', 'bonds', 'crypto-coins', 'cex-pairs'], help: 'Screener type' },
    { name: 'market', default: 'america', help: 'For stocks/etfs: scanner market (e.g. america, global). Endpoint: scanner.tradingview.com/<market>/scan' },
    { name: 'limit', type: 'int', default: 20, help: 'Rows to return (1-100)' },
    { name: 'sort-by', help: 'Sort field (type-specific default if omitted)' },
    { name: 'sort-order', choices: ['asc', 'desc'], help: 'Sort order (type-specific default if omitted)' },
  ],
  func: async (page, args) => {
    const limit = clampInt(args.limit, { min: 1, max: 100, fallback: 20 });
    const type = (String(args.type ?? 'stocks').trim() as ScreenerType) || 'stocks';
    const market = String(args.market ?? 'america').trim() || 'america';
    const sortByRaw = String(args['sort-by'] ?? '').trim();
    const sortOrderRaw = String(args['sort-order'] ?? '').trim().toLowerCase();
    const sortOrderArg = (sortOrderRaw === 'asc' || sortOrderRaw === 'desc') ? (sortOrderRaw as SortOrder) : undefined;

    // Establish session / cookies and align with the selected screener page.
    const landingUrl = (() => {
      switch (type) {
        case 'stocks': return 'https://www.tradingview.com/screener/';
        case 'etfs': return 'https://www.tradingview.com/etf-screener/';
        case 'bonds': return 'https://www.tradingview.com/bond-screener/';
        case 'crypto-coins': return 'https://www.tradingview.com/crypto-coins-screener/';
        case 'cex-pairs': return 'https://www.tradingview.com/cex-screener/';
      }
    })();
    await page.goto(landingUrl);
    await page.wait(2);

    const result = await page.evaluate(`(async () => {
      const limit = ${JSON.stringify(limit)};
      const type = ${JSON.stringify(type)};
      const market = ${JSON.stringify(market)};

      const sortByArg = ${JSON.stringify(sortByRaw || null)};
      const sortOrderArg = ${JSON.stringify(sortOrderArg || null)};

      const defaults = (() => {
        switch (type) {
          case 'stocks': return { sortBy: 'market_cap_basic', sortOrder: 'desc' };
          case 'etfs': return { sortBy: 'aum', sortOrder: 'desc' };
          case 'bonds': return { sortBy: 'bond_snp_rating_lt', sortOrder: 'desc' };
          case 'crypto-coins': return { sortBy: 'crypto_total_rank', sortOrder: 'asc' };
          case 'cex-pairs': return { sortBy: '24h_vol|5', sortOrder: 'desc' };
        }
      })();

      const sortBy = (sortByArg && String(sortByArg).trim()) ? String(sortByArg).trim() : defaults.sortBy;
      const sortOrder = (sortOrderArg === 'asc' || sortOrderArg === 'desc') ? sortOrderArg : defaults.sortOrder;

      const request = (() => {
        if (type === 'stocks') {
          return {
            url: 'https://scanner.tradingview.com/' + encodeURIComponent(market) + '/scan?label-product=screener-stock',
            payload: {
              columns: ['ticker-view', 'close', 'change', 'volume', 'market_cap_basic'],
              filter: [{ left: 'is_primary', operation: 'equal', right: true }],
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
                        { operation: { operator: 'and', operands: [{ expression: { left: 'type', operation: 'equal', right: 'stock' } }, { expression: { left: 'typespecs', operation: 'has', right: ['common'] } }] } },
                        { operation: { operator: 'and', operands: [{ expression: { left: 'type', operation: 'equal', right: 'stock' } }, { expression: { left: 'typespecs', operation: 'has', right: ['preferred'] } }] } },
                        { operation: { operator: 'and', operands: [{ expression: { left: 'type', operation: 'equal', right: 'dr' } }] } },
                        { operation: { operator: 'and', operands: [{ expression: { left: 'type', operation: 'equal', right: 'fund' } }, { expression: { left: 'typespecs', operation: 'has_none_of', right: ['etf'] } }] } },
                      ],
                    },
                  },
                  { expression: { left: 'typespecs', operation: 'has_none_of', right: ['pre-ipo'] } },
                ],
              },
            },
          };
        }

        if (type === 'etfs') {
          return {
            url: 'https://scanner.tradingview.com/' + encodeURIComponent(market) + '/scan?label-product=screener-etf',
            payload: {
              columns: [
                'ticker-view',
                'close',
                'currency',
                'change',
                'aum',
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
            },
          };
        }

        if (type === 'bonds') {
          return {
            url: 'https://scanner.tradingview.com/bond/scan?label-product=screener-bond',
            payload: {
              columns: [
                'ticker-view',
                'exchange.tr',
                'isin-displayed',
                'yield_to_worst',
                'close_pct',
                'close_net',
                'current_coupon',
                'maturity_date',
                'bond_snp_rating_lt.tr',
                'bond_fitch_rating_lt.tr',
              ],
              ignore_unknown_fields: false,
              options: { lang: 'en' },
              range: [0, limit],
              sort: { sortBy, sortOrder },
              symbols: {},
              markets: ['bond'],
            },
          };
        }

        if (type === 'crypto-coins') {
          return {
            url: 'https://scanner.tradingview.com/coin/scan?label-product=screener-coin',
            payload: {
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
            },
          };
        }

        // cex-pairs
        return {
          url: 'https://scanner.tradingview.com/crypto/scan?label-product=screener-crypto-cex',
          payload: {
            columns: [
              'ticker-view',
              'exchange.tr',
              'provider-id',
              'close',
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
          },
        };
      })();

      const res = await fetch(request.url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'text/plain;charset=UTF-8',
        },
        body: JSON.stringify(request.payload),
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
        if (type === 'stocks') {
          out.push({
            symbol: String(s),
            name: String(tv?.description || tv?.name || ''),
            exchange: String(tv?.exchange || ''),
            close: d[1] ?? null,
            change: d[2] ?? null,
            volume: d[3] ?? null,
            marketCap: d[4] ?? null,
          });
        } else if (type === 'etfs') {
          out.push({
            symbol: String(s),
            name: String(tv?.description || tv?.name || ''),
            exchange: String(tv?.exchange || ''),
            close: d[1] ?? null,
            change: d[3] ?? null,
            aum: d[4] ?? null,
            expenseRatio: d[5] ?? null,
            assetClass: d[6] ?? null,
            focus: d[7] ?? null,
          });
        } else if (type === 'bonds') {
          out.push({
            symbol: String(s),
            name: String(tv?.description || tv?.name || ''),
            exchange: d[1] ?? null,
            isin: d[2] ?? null,
            yieldToWorst: d[3] ?? null,
            closePct: d[4] ?? null,
            closeNet: d[5] ?? null,
            coupon: d[6] ?? null,
            maturity: d[7] ?? null,
            snp: d[8] ?? null,
            fitch: d[9] ?? null,
          });
        } else if (type === 'crypto-coins') {
          out.push({
            symbol: String(tv?.name || ''),
            name: String(tv?.description || ''),
            exchange: String(tv?.exchange || ''),
            rank: d[1] ?? null,
            close: d[2] ?? null,
            change24hPct: d[3] ?? null,
            marketCap: d[4] ?? null,
            vol24h: d[5] ?? null,
            circulating: d[6] ?? null,
            volToMcap: d[7] ?? null,
            categories: Array.isArray(d[8]) ? d[8] : (d[8] ? [String(d[8])] : []),
            tradingviewSymbol: String(s),
          });
        } else {
          out.push({
            symbol: String(s),
            exchange: d[1] ?? null,
            provider: d[2] ?? null,
            pair: String(tv?.name || ''),
            description: String(tv?.description || ''),
            close: d[3] ?? null,
            currency: d[4] ?? null,
            change24hPct: d[5] ?? null,
            vol24h: d[6] ?? null,
            vol24hChangePct: d[7] ?? null,
            rating: d[8] ?? null,
            ratingText: d[9] ?? null,
          });
        }
      }
      return { ok: true, totalCount: json?.totalCount ?? null, out };
    })()`);

    if (!result || typeof result !== 'object') {
      throw new CliError('UNKNOWN', 'TradingView screener returned no result', 'Try again with --verbose to see details');
    }

    const r = result as { ok?: boolean; status?: number; body?: string; out?: unknown[]; totalCount?: unknown };
    if (!r.ok) {
      throw new CliError(
        'FETCH_ERROR',
        `TradingView scanner request failed${r.status ? ` (HTTP ${r.status})` : ''}`,
        typeof r.body === 'string' && r.body ? r.body : 'Try again later, or open TradingView in Chrome and ensure you are not blocked.',
      );
    }

    if (!Array.isArray(r.out) || r.out.length === 0) {
      throw new CliError('NOT_FOUND', 'No screener rows returned', 'Try a different --market or loosen filters');
    }

    return r.out;
  },
});

