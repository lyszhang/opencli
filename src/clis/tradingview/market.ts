import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';

function clampInt(n: unknown, { min, max, fallback }: { min: number; max: number; fallback: number }): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(Math.trunc(v), max));
}

type MarketSection =
  | 'entire-world'
  | 'countries'
  | 'news'
  | 'indices'
  | 'stocks'
  | 'crypto'
  | 'futures'
  | 'forex'
  | 'government-bonds'
  | 'corporate-bonds'
  | 'etfs'
  | 'economy';

type MarketAction = 'menu' | 'browse' | 'countries';

const SECTION_MAP: Record<MarketSection, { label: string; path: string }> = {
  'entire-world': { label: 'Entire world', path: '/markets/' },
  countries: { label: 'Countries', path: '/markets/' },
  news: { label: 'News', path: '/news/' },
  indices: { label: 'Indices', path: '/markets/indices/' },
  stocks: { label: 'Stocks', path: '/markets/stocks-usa/' },
  crypto: { label: 'Crypto', path: '/markets/cryptocurrencies/' },
  futures: { label: 'Futures', path: '/markets/futures/' },
  forex: { label: 'Forex', path: '/markets/currencies/' },
  'government-bonds': { label: 'Government bonds', path: '/markets/bonds/government-bonds/' },
  'corporate-bonds': { label: 'Corporate bonds', path: '/markets/bonds/corporate-bonds/' },
  etfs: { label: 'ETFs', path: '/markets/etfs/' },
  economy: { label: 'Economy', path: '/markets/economic-calendar/' },
};

const COUNTRY_MAP: Record<string, { country: string; url: string }> = {
  us: { country: 'United States', url: 'https://www.tradingview.com/markets/usa/' },
  cn: { country: 'China', url: 'https://www.tradingview.com/markets/china/' },
  jp: { country: 'Japan', url: 'https://www.tradingview.com/markets/japan/' },
  hk: { country: 'Hong Kong', url: 'https://www.tradingview.com/markets/hong-kong/' },
  uk: { country: 'United Kingdom', url: 'https://www.tradingview.com/markets/uk/' },
  de: { country: 'Germany', url: 'https://www.tradingview.com/markets/germany/' },
  fr: { country: 'France', url: 'https://www.tradingview.com/markets/france/' },
  in: { country: 'India', url: 'https://www.tradingview.com/markets/india/' },
};

cli({
  site: 'tradingview',
  name: 'market',
  description: 'TradingView Markets menu operations (sections and quick links)',
  domain: 'www.tradingview.com',
  strategy: Strategy.COOKIE,
  args: [
    {
      name: 'action',
      positional: true,
      default: 'menu',
      choices: ['menu', 'browse', 'countries'],
      help: 'Action: menu|browse|countries',
    },
    {
      name: 'section',
      default: 'entire-world',
      choices: Object.keys(SECTION_MAP),
      help: 'Markets section: entire-world,countries,news,indices,stocks,crypto,futures,forex,government-bonds,corporate-bonds,etfs,economy',
    },
    { name: 'group', help: 'For action=browse: one or many groups (comma-separated), e.g. gainers,losers,most-traded' },
    { name: 'country', help: 'For action=countries: country code, e.g. us|cn|jp' },
    { name: 'list', type: 'boolean', default: false, help: 'List supported market sections' },
    { name: 'open', type: 'boolean', default: false, help: 'Open selected section and extract quick links' },
    { name: 'limit', type: 'int', default: 20, help: 'Quick links to return when --open=true (1-100)' },
  ],
  func: async (page, args) => {
    const action = String(args.action ?? 'menu').trim() as MarketAction;
    const list = Boolean(args.list);
    const open = Boolean(args.open);
    const limit = clampInt(args.limit, { min: 1, max: 100, fallback: 20 });
    const section = String(args.section ?? 'entire-world').trim() as MarketSection;
    const groupRaw = String(args.group ?? '').trim().toLowerCase();
    const country = String(args.country ?? '').trim().toLowerCase();
    const selected = SECTION_MAP[section];
    if (!selected) {
      throw new CliError('VALIDATION_ERROR', `Unsupported markets section: ${section}`, 'Use --list to see supported sections');
    }

    if (list) {
      return Object.entries(SECTION_MAP).map(([key, cfg]) => ({
        section: key,
        label: cfg.label,
        url: `https://www.tradingview.com${cfg.path}`,
      }));
    }

    if (action === 'countries') {
      const c = COUNTRY_MAP[country];
      if (!c) {
        throw new CliError(
          'VALIDATION_ERROR',
          `Unsupported country code: ${country || '(empty)'}`,
          `Supported: ${Object.keys(COUNTRY_MAP).join(', ')}`,
        );
      }
      await page.goto(c.url);
      await page.wait(2);
      const pageTitle = await page.evaluate(`(() => document.title || '')()`);
      return {
        action,
        countryCode: country,
        country: c.country,
        url: c.url,
        pageTitle: String(pageTitle || ''),
      };
    }

    const out: Record<string, unknown> = {
      action,
      section,
      label: selected.label,
      url: `https://www.tradingview.com${selected.path}`,
    };

    const needOpen = open || action === 'browse';
    if (!needOpen) return out;

    await page.goto(`https://www.tradingview.com${selected.path}`);
    await page.wait(2);

    const parsed = await page.evaluate(`(() => {
      const simplify = (s) => String(s ?? '').replace(/\\s+/g, ' ').trim();
      const links = Array.from(document.querySelectorAll('a[href^="/markets/"], a[href^="/news/"]'));
      const out = [];
      const seen = new Set();
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        const text = simplify(a.textContent);
        if (!href || !text || text.length < 2) continue;
        const url = new URL(href, location.origin).toString();
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ title: text, url });
      }
      const title = simplify(document.title);
      return { title, links: out };
    })()`);

    const allLinks = Array.isArray((parsed as { links?: unknown[] })?.links)
      ? (parsed as { links: Array<{ title?: string; url?: string }> }).links
      : [];

    if (action === 'browse') {
      const groupTokens = groupRaw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (groupTokens.length === 0) {
        throw new CliError('VALIDATION_ERROR', 'group is required for action=browse', 'Use --group gainers|losers|active|ideas|news');
      }

      const expandAliases = (token: string): string[] => {
        const alias: Record<string, string[]> = {
          gainers: ['gainers', 'top gainers'],
          losers: ['losers', 'top losers'],
          active: ['active', 'highest volume', 'most traded'],
          ideas: ['ideas'],
          news: ['news', 'top stories'],
        };
        return alias[token] ?? [token];
      };
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const matches: Array<{
        group: string;
        matched: boolean;
        target?: { title: string; url: string; pageTitle: string };
        data?: {
          headings: string[];
          metrics: Array<{ label: string; value: string }>;
          rows: Array<{ rank: number; columns: string[] }>;
          relatedLinks: Array<{ title: string; url: string }>;
        };
        hints?: Array<{ title: string; url: string }>;
      }> = [];

      for (const token of groupTokens) {
        const kws = expandAliases(token).map(normalize);
        const picked = allLinks.find((it) => {
          const title = normalize(String(it?.title ?? ''));
          const url = normalize(String(it?.url ?? ''));
          return kws.some(k => title.includes(k) || url.includes(k.replace(/\s+/g, '-')) || url.includes(k));
        });
        if (!picked?.url) {
          matches.push({
            group: token,
            matched: false,
            hints: allLinks
              .slice(0, 15)
              .map(it => ({ title: String(it?.title ?? ''), url: String(it?.url ?? '') })),
          });
          continue;
        }
        await page.goto(String(picked.url));
        await page.wait(2);
        const targetTitle = await page.evaluate(`(() => document.title || '')()`);
        const targetData = await page.evaluate(`(() => {
          const simplify = (s) => String(s ?? '').replace(/\\s+/g, ' ').trim();
          const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
            .map(el => simplify(el.textContent))
            .filter(Boolean)
            .slice(0, 8);

          // Key cards / metrics (label + value adjacent text)
          const metrics = [];
          const metricNodes = Array.from(document.querySelectorAll('div, span, p'));
          for (const el of metricNodes) {
            const txt = simplify(el.textContent);
            if (!txt || txt.length < 2 || txt.length > 80) continue;
            if (!/(market cap|dominance|volume|change|high|low|open|close|rank|supply|tvl)/i.test(txt)) continue;
            const sib = el.nextElementSibling ? simplify(el.nextElementSibling.textContent) : '';
            if (sib && sib.length <= 80) metrics.push({ label: txt, value: sib });
            if (metrics.length >= 20) break;
          }

          // Generic row extraction for tables/lists
          const rows = [];
          const trNodes = Array.from(document.querySelectorAll('table tr'));
          for (const tr of trNodes) {
            const cols = Array.from(tr.querySelectorAll('th,td'))
              .map(c => simplify(c.textContent))
              .filter(Boolean);
            if (cols.length < 2) continue;
            rows.push({ rank: rows.length + 1, columns: cols.slice(0, 10) });
            if (rows.length >= 20) break;
          }
          if (rows.length === 0) {
            const linkRows = Array.from(document.querySelectorAll('a[href^="/symbols/"], a[href*="/markets/cryptocurrencies/"]'));
            for (const a of linkRows) {
              const t = simplify(a.textContent);
              const href = a.getAttribute('href') || '';
              if (!t || t.length < 2 || !href) continue;
              rows.push({ rank: rows.length + 1, columns: [t, new URL(href, location.origin).toString()] });
              if (rows.length >= 20) break;
            }
          }

          const relatedLinks = Array.from(document.querySelectorAll('a[href^="/markets/"], a[href^="/news/"], a[href^="/symbols/"]'))
            .map(a => {
              const title = simplify(a.textContent);
              const href = a.getAttribute('href') || '';
              if (!title || !href) return null;
              return { title, url: new URL(href, location.origin).toString() };
            })
            .filter(Boolean)
            .slice(0, 20);

          return { headings, metrics, rows, relatedLinks };
        })()`);
        matches.push({
          group: token,
          matched: true,
          target: {
            title: String(picked.title ?? ''),
            url: String(picked.url),
            pageTitle: String(targetTitle || ''),
          },
          data: {
            headings: Array.isArray((targetData as { headings?: unknown[] })?.headings)
              ? ((targetData as { headings: unknown[] }).headings.map(v => String(v))).slice(0, limit)
              : [],
            metrics: Array.isArray((targetData as { metrics?: unknown[] })?.metrics)
              ? ((targetData as { metrics: Array<{ label?: unknown; value?: unknown }> }).metrics
                .map(m => ({ label: String(m?.label ?? ''), value: String(m?.value ?? '') }))).slice(0, limit)
              : [],
            rows: Array.isArray((targetData as { rows?: unknown[] })?.rows)
              ? ((targetData as { rows: Array<{ rank?: unknown; columns?: unknown[] }> }).rows
                .map(r => ({
                  rank: Number(r?.rank ?? 0),
                  columns: Array.isArray(r?.columns) ? r.columns.map(v => String(v)) : [],
                }))).slice(0, limit)
              : [],
            relatedLinks: Array.isArray((targetData as { relatedLinks?: unknown[] })?.relatedLinks)
              ? ((targetData as { relatedLinks: Array<{ title?: unknown; url?: unknown }> }).relatedLinks
                .map(l => ({ title: String(l?.title ?? ''), url: String(l?.url ?? '') }))).slice(0, limit)
              : [],
          },
        });
      }

      return {
        ...out,
        groups: groupTokens,
        results: matches,
        matchedCount: matches.filter(m => m.matched).length,
        requestedCount: matches.length,
      };
    }

    out.pageTitle = (parsed as { title?: unknown })?.title ?? '';
    out.quickLinks = allLinks.slice(0, limit);
    out.quickLinksCount = allLinks.length;

    return out;
  },
});

