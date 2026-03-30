import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';

function parsePositiveSeconds(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(30, Math.max(1, Math.trunc(n)));
}

function normalizeTimeframe(v: unknown): string {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  const s = raw.toLowerCase();
  const direct = s.match(/^(\d+)(m|h|d|w|mo)$/);
  if (direct) {
    const n = direct[1];
    const unit = direct[2];
    if (unit === 'm') return n;
    if (unit === 'h') return String(Number(n) * 60);
    if (unit === 'd') return n === '1' ? 'D' : `${n}D`;
    if (unit === 'w') return n === '1' ? 'W' : `${n}W`;
    if (unit === 'mo') return n === '1' ? 'M' : `${n}M`;
  }
  if (/^\d+$/.test(s)) return s; // minutes
  if (s === 'd' || s === '1d') return 'D';
  if (s === 'w' || s === '1w') return 'W';
  if (s === 'm' || s === '1mth' || s === '1mo') return 'M';
  if (s === '1h') return '60';
  if (s === '2h') return '120';
  if (s === '4h') return '240';
  if (s === '6h') return '360';
  if (s === '12h') return '720';
  return raw;
}

function normalizeIndicators(v: unknown): string[] {
  const raw = String(v ?? '').trim();
  if (!raw) return [];
  const alias: Record<string, string> = {
    rsi: 'RSI@tv-basicstudies',
    macd: 'MACD@tv-basicstudies',
    bollinger: 'BollingerBands@tv-basicstudies',
    bb: 'BollingerBands@tv-basicstudies',
    ema: 'MAExp@tv-basicstudies',
    sma: 'MASimple@tv-basicstudies',
    volume: 'Volume@tv-basicstudies',
    vwap: 'VWAP@tv-basicstudies',
    ichimoku: 'IchimokuCloud@tv-basicstudies',
    stoch: 'Stochastic@tv-basicstudies',
  };
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    out.push(alias[k] ?? t);
  }
  return Array.from(new Set(out));
}

cli({
  site: 'tradingview',
  name: 'chart',
  description: 'Open TradingView chart for a symbol (default or specified layout)',
  domain: 'www.tradingview.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'action', positional: true, default: 'open', choices: ['open'], help: 'Chart action' },
    { name: 'symbol', required: true, help: 'TradingView symbol, e.g. BINANCE:BTCUSDT' },
    { name: 'layout', help: 'Optional chart layout id, e.g. 0b9jaj5U' },
    { name: 'timeframe', help: 'Optional timeframe: 1m,5m,15m,1h,4h,1d,1w,1mo (or TradingView interval value)' },
    { name: 'indicator', help: 'Optional indicators (comma-separated). Examples: rsi,macd,ema or full IDs like RSI@tv-basicstudies' },
    { name: 'no-prenav', type: 'boolean', default: false, help: 'Skip pre-navigation to tradingview homepage before opening chart' },
    { name: 'fullscreen', type: 'boolean', default: false, help: 'Try switching chart to fullscreen mode before screenshot' },
    { name: 'screenshot', type: 'boolean', default: false, help: 'Capture chart screenshot after opening' },
    { name: 'output', help: 'Screenshot output path (default: /tmp/tradingview-chart-<ts>.png)' },
    { name: 'chart-only', type: 'boolean', default: true, help: 'Screenshot only chart canvas area (default true)' },
    { name: 'full-page', type: 'boolean', default: false, help: 'Capture full page screenshot' },
    { name: 'wait-ready', type: 'boolean', default: true, help: 'When screenshoting, wait until chart seems ready' },
    { name: 'ready-timeout', type: 'int', default: 15, help: 'Max seconds to wait for chart ready before screenshot (1-60)' },
    { name: 'wait', type: 'boolean', default: false, help: 'Wait for chart stabilization and return detected symbol/timeframe' },
    { name: 'wait-seconds', type: 'int', default: 4, help: 'Wait seconds when --wait=true (1-30)' },
  ],
  func: async (page, args) => {
    const action = String(args.action ?? 'open').trim().toLowerCase();
    if (action !== 'open') {
      throw new CliError('VALIDATION_ERROR', `Unsupported chart action: ${action}`, 'Use: opencli tradingview chart open --symbol BINANCE:BTCUSDT');
    }

    const symbol = String(args.symbol ?? '').trim().toUpperCase();
    if (!symbol || !symbol.includes(':')) {
      throw new CliError(
        'VALIDATION_ERROR',
        'symbol is required and must include exchange prefix, e.g. BINANCE:BTCUSDT',
        'Usage: opencli tradingview chart open --symbol BINANCE:BTCUSDT',
      );
    }

    const layout = String(args.layout ?? '').trim();
    const timeframe = normalizeTimeframe(args.timeframe);
    const indicators = normalizeIndicators(args.indicator);
    const noPrenav = Boolean(args['no-prenav']);
    const fullscreen = Boolean(args.fullscreen);
    const screenshot = Boolean(args.screenshot);
    const outputPath = String(args.output ?? '').trim();
    const chartOnly = Boolean(args['chart-only']);
    const fullPage = Boolean(args['full-page']);
    const waitReady = Boolean(args['wait-ready']);
    const readyTimeoutSeconds = parsePositiveSeconds(args['ready-timeout'], 15);
    const wait = Boolean(args.wait);
    const waitSeconds = parsePositiveSeconds(args['wait-seconds'], 4);

    const base = layout
      ? `https://www.tradingview.com/chart/${encodeURIComponent(layout)}/`
      : 'https://www.tradingview.com/chart/';
    const qs = new URLSearchParams();
    qs.set('symbol', symbol);
    if (timeframe) qs.set('interval', timeframe);
    if (indicators.length > 0) {
      // TradingView supports chart URLs with studies payload.
      // Use JSON array string to preserve multi-indicator ordering.
      qs.set('studies', JSON.stringify(indicators));
    }
    const url = `${base}?${qs.toString()}`;

    if (!noPrenav) {
      await page.goto('https://www.tradingview.com/');
      await page.wait(1);
    }

    await page.goto(url);
    if (wait) {
      await page.wait(waitSeconds);
    } else {
      await page.wait(1);
    }

    const out = await page.evaluate(`(() => {
      const u = new URL(location.href);
      const pathMatch = u.pathname.match(/\\/chart\\/([^/]+)\\//);
      const layoutId = pathMatch ? pathMatch[1] : '';
      const fromQuery = u.searchParams.get('symbol') || '';
      const fromHashSymbol = (() => {
        const h = String(location.hash || '');
        const m = h.match(/(?:^|[?&#])symbol=([^&#]+)/i);
        return m ? decodeURIComponent(m[1]) : '';
      })();
      const fromQueryTf = u.searchParams.get('interval') || '';
      const fromQueryStudies = (() => {
        const s = u.searchParams.get('studies') || '';
        if (!s) return [];
        try {
          const parsed = JSON.parse(s);
          return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
        } catch {
          return [];
        }
      })();
      const fromHashTf = (() => {
        const h = String(location.hash || '');
        const m = h.match(/(?:^|[?&#])interval=([^&#]+)/i);
        return m ? decodeURIComponent(m[1]) : '';
      })();
      return {
        ok: true,
        url: location.href,
        chartPath: u.pathname,
        layoutId,
        symbol: fromQuery || fromHashSymbol || '',
        timeframe: fromQueryTf || fromHashTf || '',
        indicators: fromQueryStudies,
        title: document.title || '',
      };
    })()`);

    if (!out || typeof out !== 'object') {
      throw new CliError('UNKNOWN', 'Failed to open TradingView chart', 'Please retry with --wait');
    }

    let screenshotPath: string | null = null;
    let readyState: Record<string, unknown> | null = null;
    if (screenshot) {
      if (fullscreen) {
        const fsResult = await page.evaluate(`(() => {
          const clickIf = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            try { el.click(); return true; } catch { return false; }
          };
          const selectors = [
            'button[data-name="fullscreen"]',
            'button[data-name="header-fullscreen-button"]',
            'button[aria-label*="Full screen"]',
            'button[aria-label*="Fullscreen"]',
            'button[title*="Full screen"]',
            'button[title*="Fullscreen"]',
          ];
          for (const sel of selectors) {
            const hit = document.querySelector(sel);
            if (clickIf(hit)) return { ok: true, via: sel };
          }
          const allButtons = Array.from(document.querySelectorAll('button'));
          for (const b of allButtons) {
            const t = ((b.getAttribute('title') || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
            if (/(full\\s*screen|fullscreen)/i.test(t)) {
              if (clickIf(b)) return { ok: true, via: 'title/aria fuzzy' };
            }
          }
          return { ok: false, via: 'not-found' };
        })()`) as Record<string, unknown>;
        await page.wait(1);
        if (!readyState) readyState = {};
        readyState.fullscreen = fsResult;
      }

      if (waitReady) {
        const waitState = await page.evaluate(`(async () => {
          const timeoutMs = ${JSON.stringify(readyTimeoutSeconds * 1000)};
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const isVisible = (el) => {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            return rect.width >= 300 && rect.height >= 150;
          };
          const startedAt = Date.now();
          let attempts = 0;
          while (Date.now() - startedAt < timeoutMs) {
            attempts += 1;
            const text = (document.body?.innerText || '').slice(0, 6000).toLowerCase();
            const hasLoadingText = /(loading|加载中|正在加载|please wait)/i.test(text);
            const canvases = Array.from(document.querySelectorAll('canvas'));
            const visibleCanvasCount = canvases.filter(isVisible).length;
            if (visibleCanvasCount > 0 && !hasLoadingText) {
              return {
                ready: true,
                reason: 'visible-canvas-and-no-loading-text',
                visibleCanvasCount,
                attempts,
                elapsedMs: Date.now() - startedAt,
              };
            }
            await sleep(250);
          }
          const finalCanvases = Array.from(document.querySelectorAll('canvas')).filter(isVisible).length;
          return {
            ready: false,
            reason: 'timeout',
            visibleCanvasCount: finalCanvases,
            attempts,
            elapsedMs: Date.now() - startedAt,
          };
        })()`) as Record<string, unknown>;
        readyState = { ...(readyState || {}), ...waitState };
      }
      screenshotPath = outputPath || `/tmp/tradingview-chart-${Date.now()}.png`;
      const tryChartOnly = chartOnly && !fullPage;
      let chartOnlySaved = false;
      let chartOnlyMeta: Record<string, unknown> | null = null;
      if (tryChartOnly) {
        try {
          const clipInfo = await page.evaluate(`(() => {
            const pickChartContainer = () => {
              const chartContainer = document.querySelector('div[data-qa-id="chart-container"]');
              if (chartContainer instanceof HTMLElement) {
                const r = chartContainer.getBoundingClientRect();
                if (r.width >= 100 && r.height >= 100) {
                  return {
                    kind: 'chart-container',
                    rect: r,
                    meta: {
                      dataQaId: chartContainer.getAttribute('data-qa-id') || '',
                      cssWidth: r.width,
                      cssHeight: r.height,
                    },
                  };
                }
              }
              return null;
            };

            const pickPane = () => {
              const pane = document.querySelector('div[data-qa-id="pane"]');
              if (pane instanceof HTMLElement) {
                const r = pane.getBoundingClientRect();
                if (r.width >= 50 && r.height >= 50) {
                  return {
                    kind: 'pane',
                    rect: r,
                    meta: {
                      dataQaId: pane.getAttribute('data-qa-id') || '',
                      cssWidth: r.width,
                      cssHeight: r.height,
                    },
                  };
                }
              }
              return null;
            };

            const pickCanvas = () => {
              const preferred = document.querySelector('canvas[data-qa-id="pane-top-canvas"]');
              if (preferred instanceof HTMLCanvasElement) {
                const r = preferred.getBoundingClientRect();
                if (r.width >= 50 && r.height >= 50) {
                  return {
                    kind: 'canvas',
                    rect: r,
                    meta: {
                      dataQaId: preferred.getAttribute('data-qa-id') || '',
                      width: preferred.width,
                      height: preferred.height,
                      cssWidth: r.width,
                      cssHeight: r.height,
                    },
                  };
                }
              }
              const canvases = Array.from(document.querySelectorAll('canvas'));
              let best = null;
              let bestArea = 0;
              for (const c of canvases) {
                if (!(c instanceof HTMLCanvasElement)) continue;
                const r = c.getBoundingClientRect();
                const area = Math.max(0, r.width) * Math.max(0, r.height);
                if (area > bestArea) {
                  bestArea = area;
                  best = c;
                }
              }
              if (!(best instanceof HTMLCanvasElement)) return null;
              const r = best.getBoundingClientRect();
              return {
                kind: 'canvas',
                rect: r,
                meta: {
                  dataQaId: best.getAttribute('data-qa-id') || '',
                  width: best.width,
                  height: best.height,
                  cssWidth: r.width,
                  cssHeight: r.height,
                },
              };
            };

            const picked = pickChartContainer() || pickPane() || pickCanvas();
            if (!picked) return { ok: false, reason: 'no-pane-or-canvas' };
            const rect = picked.rect;
            if (rect.width < 50 || rect.height < 50) return { ok: false, reason: 'target-too-small' };
            return {
              ok: true,
              clip: {
                x: Math.max(0, rect.left),
                y: Math.max(0, rect.top),
                width: Math.max(1, rect.width),
                height: Math.max(1, rect.height),
              },
              meta: { target: picked.kind, ...(picked.meta || {}) },
            };
          })()`) as { ok?: boolean; clip?: { x: number; y: number; width: number; height: number }; meta?: Record<string, unknown> };
          if (clipInfo?.ok && clipInfo.clip) {
            await page.screenshot({
              path: screenshotPath,
              format: 'png',
              clip: clipInfo.clip,
            });
            chartOnlySaved = true;
            chartOnlyMeta = clipInfo.meta ?? null;
          }
        } catch {
          // fallback to viewport screenshot below
        }
      }
      if (!chartOnlySaved) {
        await page.screenshot({
          path: screenshotPath,
          fullPage,
          format: 'png',
        });
      }
      if (!readyState) readyState = {};
      readyState.screenshotMode = chartOnlySaved ? 'chart-clip' : (fullPage ? 'full-page' : 'viewport-fallback');
      if (chartOnlyMeta) readyState.chartCanvas = chartOnlyMeta;
    }

    return {
      action: 'open',
      requested: {
        symbol,
        layout: layout || null,
        timeframe: timeframe || null,
        requestedIndicators: indicators,
        noPrenav,
        fullscreen,
        screenshot,
        output: screenshotPath,
        chartOnly,
        fullPage,
        waitReady: screenshot ? waitReady : false,
        readyTimeoutSeconds: screenshot ? readyTimeoutSeconds : 0,
        wait,
        waitSeconds: wait ? waitSeconds : 0,
      },
      opened: out,
      screenshotMeta: screenshot ? { readyState } : null,
    };
  },
});

