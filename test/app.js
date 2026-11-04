// Tests the Web Circuit Viewer page: serves the repo locally, routes the blog-site example files to the local copies
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const ct = f => ({ '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' })[path.extname(f)] || 'text/plain';
const srv = http.createServer((q, s) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { 'content-type': ct(p) }); s.end(d); } }); }).listen(8790, async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }), pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.route('https://rolandthsive.github.io/**', (route, req) => { const p = decodeURIComponent(new URL(req.url()).pathname).replace('/Assets/PCB_Assets/', '/test/PCB_Assets/'); const f = path.join(root, p); if (fs.existsSync(f)) route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'access-control-allow-origin': '*' } }); else route.fulfill({ status: 404, body: '' }); });
  await pg.goto('http://localhost:8790/WebUI/index.html'); await pg.waitForTimeout(800);
  await pg.screenshot({ path: 'test/app-empty.png' });
  await pg.locator('#examples button').first().click(); await pg.waitForTimeout(2500);
  await pg.screenshot({ path: 'test/app-pcb.png' });
  const st1 = await pg.evaluate(() => ({ badge: document.getElementById('file-badge').textContent, kinds: [...document.querySelectorAll('#kind-switch button')].map(b => b.textContent + (b.disabled ? ' (off)' : '') + (b.classList.contains('on') ? ' [on]' : '')), parts: document.getElementById('part-count').textContent, posterName: document.getElementById('poster-name').value }));
  console.log(JSON.stringify(st1));
  // search a part and jump to it
  await pg.fill('#part-search', 'U2'); await pg.waitForTimeout(200); await pg.locator('#parts li').first().click(); await pg.waitForTimeout(400);
  await pg.screenshot({ path: 'test/app-focus.png' });
  // flip via the viewer's own button, then the schematic tab
  await pg.locator('#viewer .wcv-bar button', { hasText: 'Flip' }).click(); await pg.waitForTimeout(300);
  await pg.locator('#kind-switch button[data-kind="sch"]').click(); await pg.waitForTimeout(1500);
  await pg.screenshot({ path: 'test/app-sch.png' });
  // poster preview + download (webp), then a transparent png of the pcb
  await pg.locator('#btn-preview').click(); await pg.waitForTimeout(800);
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.locator('#btn-poster').click()]);
  const f1 = await dl.path(); console.log('poster:', dl.suggestedFilename(), fs.statSync(f1).size, 'bytes');
  await pg.screenshot({ path: 'test/app-poster.png' });
  fs.copyFileSync(f1, 'test/poster-sch.webp');
  await pg.locator('#kind-switch button[data-kind="pcb"]').click(); await pg.waitForTimeout(1200);
  await pg.locator('#fmt-seg button[data-fmt="image/png"]').click(); await pg.locator('#transparent').check({ force: true });
  const [dl2] = await Promise.all([pg.waitForEvent('download'), pg.locator('#btn-poster').click()]);
  const f2 = await dl2.path(); console.log('poster:', dl2.suggestedFilename(), fs.statSync(f2).size, 'bytes'); fs.copyFileSync(f2, 'test/poster-pcb.png');
  // phone layout
  await pg.setViewportSize({ width: 390, height: 844 }); await pg.waitForTimeout(500); await pg.screenshot({ path: 'test/app-phone.png', fullPage: true });
  console.log('errors:', errs);
  await b.close(); srv.close();
});
