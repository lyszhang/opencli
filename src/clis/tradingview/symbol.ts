import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';

function clampInt(n: unknown, { min, max, fallback }: { min: number; max: number; fallback: number }): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(Math.trunc(v), max));
}

cli({
  site: 'tradingview',
  name: 'symbol',
  description: 'Get TradingView symbol sections (overview/news/community/technicals/seasonals/markets/etfs)',
  domain: 'www.tradingview.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'symbol', positional: true, required: true, help: 'Symbol, e.g. BTCUSD or CRYPTO:BTCUSD' },
    { name: 'exchange', default: 'BITSTAMP', help: 'Default exchange when symbol has no prefix' },
    { name: 'section', default: 'overview', help: 'Comma-separated: overview,news,community,technicals,seasonals,markets,etfs,all' },
    { name: 'news', type: 'boolean', default: false, help: 'Include latest symbol news' },
    { name: 'news-limit', type: 'int', default: 5, help: 'News items to return (1-20)' },
    { name: 'etfs', type: 'boolean', default: false, help: 'Include related ETFs (from ETFs tab)' },
    { name: 'etfs-limit', type: 'int', default: 20, help: 'ETFs to return (1-100)' },
    { name: 'markets-limit', type: 'int', default: 50, help: 'Markets items to return (1-100)' },
    { name: 'community-limit', type: 'int', default: 20, help: 'Community ideas to return (1-100)' },
  ],
  columns: [
    'symbol',
    'exchange',
    'name',
    'close',
    'change',
    'perf1W',
    'perf1M',
    'perf1Y',
    'marketCap',
    'volume24h',
    'volToMcap',
  ],
  func: async (page, args) => {
    const raw = String(args.symbol ?? '').trim();
    if (!raw) {
      throw new CliError('VALIDATION_ERROR', 'symbol is required', 'Usage: opencli tradingview symbol BTCUSD');
    }
    const exchange = String(args.exchange ?? 'BITSTAMP').trim().toUpperCase() || 'BITSTAMP';
    const normalized = raw.includes(':') ? raw.toUpperCase() : `${exchange}:${raw.toUpperCase()}`;
    const sectionRaw = String(args.section ?? 'overview').toLowerCase();
    const sectionSet = new Set(
      sectionRaw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    );
    const allSections = sectionSet.has('all');

    const includeOverview = allSections || sectionSet.has('overview') || sectionSet.has('technicals');
    const includeTechnicals = allSections || sectionSet.has('technicals');
    const includeNews = Boolean(args.news) || allSections || sectionSet.has('news');
    const includeEtfs = Boolean(args.etfs) || allSections || sectionSet.has('etfs');
    const includeMarkets = allSections || sectionSet.has('markets');
    const includeCommunity = allSections || sectionSet.has('community');
    const includeSeasonals = allSections || sectionSet.has('seasonals');

    const newsLimit = clampInt(args['news-limit'], { min: 1, max: 20, fallback: 5 });
    const etfsLimit = clampInt(args['etfs-limit'], { min: 1, max: 100, fallback: 20 });
    const marketsLimit = clampInt(args['markets-limit'], { min: 1, max: 100, fallback: 50 });
    const communityLimit = clampInt(args['community-limit'], { min: 1, max: 100, fallback: 20 });

    await page.goto(`https://www.tradingview.com/symbols/${encodeURIComponent(raw.replace(/^.*:/, ''))}/`);
    await page.wait(2);

    const result = await page.evaluate(`(async () => {
      const symbol = ${JSON.stringify(normalized)};
      const includeNews = ${JSON.stringify(includeNews)};
      const newsLimit = ${JSON.stringify(newsLimit)};
      const includeEtfs = ${JSON.stringify(includeEtfs)};
      const etfsLimit = ${JSON.stringify(etfsLimit)};
      const includeOverview = ${JSON.stringify(includeOverview)};
      const includeTechnicals = ${JSON.stringify(includeTechnicals)};
      const includeMarkets = ${JSON.stringify(includeMarkets)};
      const includeCommunity = ${JSON.stringify(includeCommunity)};
      const includeSeasonals = ${JSON.stringify(includeSeasonals)};
      const rawInput = ${JSON.stringify(raw)};
      const marketsLimit = ${JSON.stringify(marketsLimit)};
      const communityLimit = ${JSON.stringify(communityLimit)};

      const q = (fields, label) =>
        fetch('https://scanner.tradingview.com/symbol?symbol=' + encodeURIComponent(symbol) +
              '&fields=' + encodeURIComponent(fields.join(',')) +
              '&no_404=true&label-product=' + encodeURIComponent(label), {
          credentials: 'include',
        }).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)));

      const out = { symbol };

      let baseExchange = symbol.split(':')[0] || 'BITSTAMP';
      let baseType = '';
      if (includeOverview || includeTechnicals || includeMarkets) {
        const basic = await q(['name','description','exchange','type','close','change','currency'], 'symbols-basic');
        baseExchange = basic?.exchange ?? baseExchange;
        baseType = (basic?.type ?? '').toString().toLowerCase();
        const maybeOverview = includeOverview || includeTechnicals;
        let perf = {};
        let stats = {};
        let rating = {};
        if (maybeOverview) {
          [perf, stats, rating] = await Promise.all([
            q(['Perf.W','Perf.1M','Perf.Y'], 'symbols-performance'),
            q(['market_cap_calc','market_cap_diluted_calc','total_value_traded','total_shares_outstanding','24h_vol_to_market_cap'], 'symbols-keystats'),
            q(['Recommend.All','Recommend.MA','Recommend.Other'], 'symbols-technicals'),
          ]);
        }
        if (includeOverview || includeTechnicals) {
        Object.assign(out, {
          exchange: basic?.exchange ?? '',
          name: basic?.description || basic?.name || '',
          type: basic?.type ?? '',
          close: basic?.close ?? null,
          change: basic?.change ?? null,
          currency: basic?.currency ?? '',
          perf1W: perf?.['Perf.W'] ?? null,
          perf1M: perf?.['Perf.1M'] ?? null,
          perf1Y: perf?.['Perf.Y'] ?? null,
          marketCap: stats?.market_cap_calc ?? null,
          marketCapDiluted: stats?.market_cap_diluted_calc ?? null,
          volume24h: stats?.total_value_traded ?? null,
          circulatingSupply: stats?.total_shares_outstanding ?? null,
          volToMcap: stats?.['24h_vol_to_market_cap'] ?? null,
        });
        }
        if (includeTechnicals) {
          Object.assign(out, {
            ratingAll: rating?.['Recommend.All'] ?? null,
            ratingMA: rating?.['Recommend.MA'] ?? null,
            ratingOsc: rating?.['Recommend.Other'] ?? null,
          });
        }
      }

      const fetchTabHtml = async (tab) => {
        const baseSymbol = String(rawInput || symbol).replace(/^.*:/, '').toUpperCase();
        const url = 'https://www.tradingview.com/symbols/' + encodeURIComponent(baseSymbol) + '/' + tab + '/?exchange=' + encodeURIComponent(baseExchange || 'BITSTAMP');
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) return '';
        return await resp.text();
      };

      const parseSymbolLinks = (html, limit) => {
        if (!html) return [];
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const links = Array.from(doc.querySelectorAll('a[href*="/symbols/"]'));
        const items = [];
        for (const a of links) {
          const href = a.getAttribute('href') || '';
          const m = href.match(/\\/symbols\\/([A-Z0-9]+)-([A-Z0-9.]+)\\//);
          if (!m) continue;
          const text = (a.textContent || '').replace(/\\s+/g, ' ').trim();
          if (!text || text.length < 2) continue;
          items.push({
            exchange: m[1],
            ticker: m[2],
            name: text.replace(/^\\s*([A-Z0-9.]+)\\s+/, '').trim() || text,
            url: new URL(href, location.origin).toString(),
          });
        }
        const seen = new Set();
        const out = [];
        for (const it of items) {
          const key = it.exchange + ':' + it.ticker;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(it);
          if (out.length >= limit) break;
        }
        return out;
      };

      const parseScannerRows = (json, columns, limit) => {
        const rows = Array.isArray(json?.data) ? json.data : [];
        const index = {};
        columns.forEach((c, i) => { index[c] = i; });
        const outRows = [];
        for (const row of rows) {
          const d = Array.isArray(row?.d) ? row.d : [];
          const rawSymbol = String(row?.s || '');
          const [ex, tk] = rawSymbol.includes(':') ? rawSymbol.split(':', 2) : ['', rawSymbol];
          outRows.push({
            symbol: rawSymbol,
            exchange: ex,
            ticker: tk,
            name: (d[index.name] ?? d[index.description] ?? '').toString(),
            type: d[index.type] ?? null,
            close: d[index.close] ?? null,
            change: d[index.change] ?? null,
            volume: d[index.volume] ?? d[index['total_value_traded']] ?? null,
            marketCap: d[index.market_cap_calc] ?? null,
            currency: (d[index.currency] ?? '').toString(),
            source: 'scanner',
          });
          if (outRows.length >= limit) break;
        }
        return outRows;
      };

      const postScanner = async (url, body) => {
        const resp = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'text/plain;charset=UTF-8',
            accept: 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) return null;
        return await resp.json();
      };

      const inferAssetClass = () => {
        const ex = String(baseExchange || '').toUpperCase();
        const symbolUpper = String(symbol || '').toUpperCase();
        const t = String(baseType || '').toLowerCase();
        if (t.includes('bond') || ex === 'TVC') return 'bond';
        if (t.includes('fund') || t.includes('etf')) return 'etf';
        if (t.includes('crypto') || t.includes('spot') || ex === 'CRYPTO' || ex === 'BITSTAMP' || ex === 'BINANCE' || ex === 'COINBASE') return 'crypto';
        return 'stocks';
      };

      const buildMarketsScanCandidates = () => {
        const assetClass = inferAssetClass();
        const columns = ['name', 'description', 'close', 'change', 'volume', 'currency', 'market_cap_calc', 'type', 'total_value_traded'];
        const byClass = {
          crypto: {
            urls: [
              'https://scanner.tradingview.com/coin/scan?label-product=related-symbols',
              'https://scanner.tradingview.com/crypto/scan?label-product=related-symbols',
            ],
            bodies: [
              { symbols: { tickers: [symbol], query: { types: [] } }, columns, range: [0, marketsLimit] },
              { symbols: { tickers: [symbol] }, columns, range: [0, marketsLimit] },
            ],
          },
          stocks: {
            urls: [
              'https://scanner.tradingview.com/america/scan?label-product=details',
              'https://scanner.tradingview.com/global/scan?label-product=details',
            ],
            bodies: [
              { symbols: { tickers: [symbol], query: { types: [] } }, columns, range: [0, marketsLimit] },
              { symbols: { tickers: [symbol] }, columns, range: [0, marketsLimit] },
            ],
          },
          etf: {
            urls: [
              'https://scanner.tradingview.com/america/scan?label-product=details',
              'https://scanner.tradingview.com/global/scan?label-product=details',
            ],
            bodies: [
              { symbols: { tickers: [symbol], query: { types: [] } }, columns, range: [0, marketsLimit] },
              { symbols: { tickers: [symbol] }, columns, range: [0, marketsLimit] },
            ],
          },
          bond: {
            urls: [
              'https://scanner.tradingview.com/bond/scan?label-product=details',
            ],
            bodies: [
              { symbols: { tickers: [symbol], query: { types: [] } }, columns, range: [0, marketsLimit] },
              { symbols: { tickers: [symbol] }, columns, range: [0, marketsLimit] },
            ],
          },
        };
        return { assetClass, columns, ...byClass[assetClass] };
      };

      // ── Optional: ETFs tab scraping (stable enough for MVP) ───────────────
      if (includeEtfs) {
        try {
          const html = await fetchTabHtml('etfs');
          const outItems = parseSymbolLinks(html, etfsLimit);
          out.etfs = outItems;
          out.etfsCount = outItems.length;
        } catch {
          // keep symbol output usable even if ETFs tab changes
        }
      }

      // ── Optional: Markets tab ─────────────────────────────────────────────
      if (includeMarkets) {
        try {
          const scanPlan = buildMarketsScanCandidates();

          let marketItems = [];
          for (const scanUrl of scanPlan.urls) {
            for (const body of scanPlan.bodies) {
              try {
                const json = await postScanner(scanUrl, body);
                const parsed = parseScannerRows(json, scanPlan.columns, marketsLimit);
                if (parsed.length > 0) {
                  marketItems = parsed;
                  break;
                }
              } catch {}
            }
            if (marketItems.length > 0) break;
          }

          if (marketItems.length > 0) {
            out.markets = marketItems;
            out.marketsCount = marketItems.length;
            out.marketsMeta = {
              source: 'scanner-related-symbols',
              assetClass: scanPlan.assetClass,
              note: 'Fetched from TradingView scanner API with asset-aware endpoint switching.',
            };
          } else {
            const html = await fetchTabHtml('markets');
            const outItems = parseSymbolLinks(html, marketsLimit);
            out.markets = outItems;
            out.marketsCount = outItems.length;
            out.marketsMeta = {
              source: outItems.length > 0 ? 'symbols-markets-html-fallback' : 'symbols-markets-url-fallback',
              url: 'https://www.tradingview.com/symbols/' + encodeURIComponent(String(rawInput || symbol).replace(/^.*:/, '').toUpperCase()) + '/markets/?exchange=' + encodeURIComponent(baseExchange || 'BITSTAMP'),
              note: outItems.length > 0
                ? 'API returned empty, fallback to HTML extraction.'
                : 'Markets tab is highly dynamic. Open URL for full interactive list.',
            };
          }
        } catch {}
      }

      // ── Optional: Community tab (ideas links) ────────────────────────────
      if (includeCommunity) {
        try {
          const ideasApiUrl =
            'https://www.tradingview.com/api/v1/ideas/?symbol=' +
            encodeURIComponent(symbol) +
            '&page=1';
          const ideasResp = await fetch(ideasApiUrl, { credentials: 'include' });
          if (ideasResp.ok) {
            const ideasJson = await ideasResp.json();
            const rows = Array.isArray(ideasJson?.results) ? ideasJson.results : [];
            out.community = rows.slice(0, communityLimit).map((it) => ({
              id: it?.id ?? null,
              title: it?.name || '',
              author: it?.user?.username || '',
              created: it?.created_at || null,
              symbol: it?.symbol?.name || '',
              likes: it?.likes_count ?? 0,
              comments: it?.comments_count ?? 0,
              views: it?.views_count ?? 0,
              url: it?.chart_url || '',
            }));
            out.communityCount = Number(ideasJson?.count ?? rows.length);
            out.communityMeta = {
              source: 'api-v1-ideas',
              pageSize: Number(ideasJson?.page_size ?? rows.length),
            };
          } else {
            const html = await fetchTabHtml('community');
            if (html) {
              const doc = new DOMParser().parseFromString(html, 'text/html');
              const links = Array.from(doc.querySelectorAll('a[href*="/ideas/"], a[href*="/chart/"]'));
              const ideas = [];
              const seen = new Set();
              for (const a of links) {
                const href = a.getAttribute('href') || '';
                if (!href) continue;
                const url = new URL(href, location.origin).toString();
                if (seen.has(url)) continue;
                seen.add(url);
                const title = (a.textContent || '').replace(/\\s+/g, ' ').trim();
                if (!title || title.length < 8) continue;
                ideas.push({ title, url });
                if (ideas.length >= communityLimit) break;
              }
              out.community = ideas;
              out.communityCount = ideas.length;
              out.communityMeta = {
                source: 'symbols-community-html-fallback',
                note: 'Ideas API unavailable, fallback to HTML extraction.',
              };
            }
          }
        } catch {}
      }

      // ── Optional: Seasonals tab (provide tab URL + light summary) ────────
      if (includeSeasonals) {
        const baseSymbol = String(rawInput || symbol).replace(/^.*:/, '').toUpperCase();
        out.seasonals = {
          url: 'https://www.tradingview.com/symbols/' + encodeURIComponent(baseSymbol) + '/seasonals/?exchange=' + encodeURIComponent(baseExchange || 'BITSTAMP'),
          note: 'Seasonals data is chart-heavy; use this URL for full visual breakdown.',
        };
      }

      if (!includeNews) return { ok: true, out };

      const newsUrl =
        'https://news-mediator.tradingview.com/public/news-flow/v2/news?filter=lang%3Aen&filter=symbol%3A' +
        encodeURIComponent(symbol) +
        '&client=detail&streaming=false&user_prostatus=non_pro';
      const newsResp = await fetch(newsUrl, { credentials: 'include' });
      if (!newsResp.ok) return { ok: true, out };
      const newsJson = await newsResp.json();
      const items = Array.isArray(newsJson?.items) ? newsJson.items : [];
      out.news = items.slice(0, newsLimit).map((n) => ({
        title: n?.title || '',
        provider: n?.provider?.name || '',
        published: n?.published || null,
        link: n?.link || '',
      }));
      out.newsCount = items.length;
      out.latestNews = out.news[0]?.title || '';
      return { ok: true, out };
    })()`);

    if (!result || typeof result !== 'object' || !(result as { ok?: boolean }).ok) {
      throw new CliError('FETCH_ERROR', 'Failed to load TradingView symbol data', 'Check symbol/exchange and try again');
    }

    const out = (result as { out?: unknown }).out;
    if (!out || typeof out !== 'object') {
      throw new CliError('NOT_FOUND', `Symbol not found: ${normalized}`, 'Try explicit exchange, e.g. CRYPTO:BTCUSD');
    }
    return out;
  },
});

