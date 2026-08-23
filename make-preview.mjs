// Generates the article preview image: a terminal-style composition
// showing (left) an AI assistant conversation using the diary tools
// and (right) the resulting Markdown file — "chat in, plain files out".
import { chromium } from 'playwright-core';

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const chatLines = [
  ['user', 'I finally fixed that flaky websocket test 🎉'],
  ['ai',  'Nice! Want me to log that in your work journal?'],
  ['user', 'yes — and also that I wrote E2E tests for it'],
  ['ai',  '🔧 log_work → 2026-08-23.md'],
  ['',    '<span class="dim">   "Wrote E2E test covering two-client sync"</span>'],
  ['',    '<span class="dim">   tags: #testing #websocket</span>'],
  ['ai',  'Done ✅ Anything else from today?'],
  ['user', 'what did I do about websockets this week?'],
  ['ai',  '🔍 search_diary("websocket")'],
];

const mdLines = [
  ['# 2026-08-23.md', true],
  ['', false],
  ['## 10:12 #testing #websocket', false],
  ['Fixed the flaky websocket test', false],
  ['', false],
  ['## 11:03 #testing', false],
  ['Wrote E2E test covering two-client sync', false],
  ['', false],
  ['# 2026-08-22.md', true],
  ['', false],
  ['## 09:40 #bugfix #websocket', false],
  ['Fixed race condition in broadcast queue', false],
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 1400px; height: 800px;
    background: linear-gradient(135deg, #0b1120 0%, #1e1b4b 100%);
    font-family: ui-monospace, 'JetBrains Mono', Menlo, monospace;
    display: flex; align-items: center; justify-content: center; gap: 3rem;
    padding: 3rem;
  }
  .panel {
    background: #0d1117; border: 1px solid #30363d; border-radius: 14px;
    width: 560px; overflow: hidden;
    box-shadow: 0 25px 60px rgba(0,0,0,.55);
  }
  .bar {
    display:flex; gap:8px; align-items:center;
    background:#161b22; padding:12px 16px; border-bottom:1px solid #30363d;
  }
  .dot { width:12px;height:12px;border-radius:50%; }
  .r{background:#ff5f57}.y{background:#febc2e}.g{background:#28c840}
  .bar span { color:#8b949e; font-size:13px; margin-left:8px; font-family: system-ui,sans-serif; }
  .body { padding:20px 22px; font-size:15px; line-height:1.75; color:#c9d1d9; min-height:420px;}
  .msg { margin-bottom:10px; }
  .who { display:inline-block; font-size:11px; padding:1px 8px; border-radius:99px; margin-right:8px;
         vertical-align:middle; font-family:system-ui,sans-serif; font-weight:700;}
  .user .who { background:#1f6feb33; color:#58a6ff; }
  .ai .who { background:#8957e544; color:#d2a8ff; }
  .tool { color:#7ee787; }
  .dim { color:#8b949e; }
  h1.side {
    position:absolute; top:38px; left:0; right:0; text-align:center;
    color:#e6edf3; font-family:system-ui,-apple-system,sans-serif;
    font-size:34px; letter-spacing:-.5px;
  }
  h1.side b { color:#a78bfa; }
  .arrow { color:#8b949e; font-size:42px; align-self:center; }
  .footer {
    position:absolute; bottom:26px; left:0; right:0; text-align:center;
    color:#8b949e; font-family:system-ui,sans-serif; font-size:16px;
  }
  .footer b { color:#7ee787; }
  .md-h { color:#79c0ff; font-weight:700; }
</style></head><body>
<h1 class="side">Your AI already knows what you did. <b>MCP makes it write it down.</b></h1>
<div class="panel">
  <div class="bar"><i class="dot r"></i><i class="dot y"></i><i class="dot g"></i><span>AI assistant + dev-diary MCP server</span></div>
  <div class="body">
    ${chatLines.map(([who, text]) =>
      who ? `<div class="msg ${who}"><span class="who">${who === 'user' ? 'you' : 'AI'}</span>${text}</div>`
          : `<div class="msg">${text}</div>`).join('\n    ')}
  </div>
</div>
<div class="arrow">→</div>
<div class="panel">
  <div class="bar"><i class="dot r"></i><i class="dot y"></i><i class="dot g"></i><span>diary/2026-08-23.md</span></div>
  <div class="body">
    ${mdLines.map(([t, isH]) => `<div class="${isH ? 'md-h' : ''}">${escape(t) || '&nbsp;'}</div>`).join('\n    ')}
    <div style="margin-top:24px" class="dim">$ grep -r websocket diary/ ✓</div>
    <div class="dim">$ git commit -m "journal: aug 23" ✓</div>
    <div class="dim">no database was harmed ✓</div>
  </div>
</div>
<div class="footer">built with <b>@modelcontextprotocol/server</b> · ~190 lines of TypeScript · storage: plain Markdown</div>
</body></html>`;

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({ path: 'assets/article-preview.png' });
console.log('saved assets/article-preview.png');
await browser.close();
