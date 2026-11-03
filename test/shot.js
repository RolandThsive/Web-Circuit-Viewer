// Renders the test page with Playwright and saves screenshots (node test/shot.js [project-name])
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const srv = http.createServer((q, s) => {
  const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(p, (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'text/plain' }); s.end(d); } });
}).listen(8788, async () => {
  const b = await chromium.launch(), pg = await b.newPage({ viewport: { width: 1240, height: 1700 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const proj = process.argv[2] || 'Thermometer';
  await pg.goto('http://localhost:8788/test/index.html');
  await pg.evaluate(p => { document.getElementById('pcb').setAttribute('src', `PCB_Assets/TheMainBoard - ${p}/TheMainBoard.kicad_pcb`); document.getElementById('sch').setAttribute('src', `PCB_Assets/TheMainBoard - ${p}/TheMainBoard.kicad_sch`); }, proj);
  await pg.waitForTimeout(2500);
  await pg.locator('#pcb').screenshot({ path: `test/${proj}-pcb.png` });
  await pg.locator('#sch').screenshot({ path: `test/${proj}-sch.png` });
  await pg.locator('#sch').hover({ position: { x: 600, y: 400 } });
  for (let i = 0; i < 4; i++) await pg.mouse.wheel(0, -200);
  await pg.waitForTimeout(400);
  await pg.locator('#sch').screenshot({ path: `test/${proj}-sch-zoom.png` });
  await pg.locator('#pcb').hover({ position: { x: 600, y: 400 } });
  for (let i = 0; i < 5; i++) await pg.mouse.wheel(0, -200);
  await pg.waitForTimeout(400);
  await pg.locator('#pcb').screenshot({ path: `test/${proj}-pcb-zoom.png` });
  // a size change (like full screen) keeps the middle of the drawing in the middle
  await pg.evaluate(() => { const e = document.getElementById('pcb'); e._v.fit(); e.style.width = '600px'; e.style.height = '500px'; });
  await pg.waitForTimeout(500);
  await pg.locator('#pcb').screenshot({ path: `test/${proj}-pcb-resized.png` });
  await pg.evaluate(() => { const e = document.getElementById('pcb'); e.style.width = '1200px'; e.style.height = '800px'; e._v.fit(); });
  await pg.waitForTimeout(300);
  await pg.locator('#pcb .wcv-bar button', { hasText: 'Flip' }).click(); await pg.waitForTimeout(400);
  await pg.locator('#pcb').screenshot({ path: `test/${proj}-pcb-flipped.png` });
  await pg.locator('#pcb').hover({ position: { x: 600, y: 400 } });
  for (let i = 0; i < 5; i++) await pg.mouse.wheel(0, -200);
  await pg.waitForTimeout(400);
  await pg.locator('#pcb').screenshot({ path: `test/${proj}-pcb-flipped-zoom.png` });
  console.log('errors:', errs, 'font ready:', await pg.evaluate(() => !!window.WCV_FONT));
  await b.close(); srv.close();
});
