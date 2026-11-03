const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const srv = http.createServer((q, s) => {
  const p = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  fs.readFile(p, (e, d) => { if (e) { s.writeHead(404); s.end(); } else { s.writeHead(200, {'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'text/plain'}); s.end(d); } });
}).listen(8788, async () => {
  const b = await chromium.launch(), pg = await b.newPage({ viewport: { width: 1240, height: 1700 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const proj = process.argv[2] || 'Thermometer';
  await pg.goto('http://localhost:8788/test/index.html');
  await pg.evaluate(p => { document.getElementById('pcb').setAttribute('src', `PCB_Assets/TheMainBoard - ${p}/TheMainBoard.kicad_pcb`); document.getElementById('sch').setAttribute('src', `PCB_Assets/TheMainBoard - ${p}/TheMainBoard.kicad_sch`); }, proj);
  await pg.waitForTimeout(2500);
  await pg.locator('#pcb').screenshot({ path: `test/${proj}-pcb.png` });
  await pg.locator('#sch').screenshot({ path: `test/${proj}-sch.png` });
  // hover a part on the pcb
  const info = await pg.evaluate(() => { const v = document.getElementById('pcb')._v; return { ok: !!v }; });
  console.log('errors:', errs, info);
  // zoomed schematic corner
  await pg.locator('#sch').hover({ position: { x: 600, y: 400 } });
  for (let i = 0; i < 4; i++) await pg.mouse.wheel(0, -200);
  await pg.waitForTimeout(400);
  await pg.locator('#sch').screenshot({ path: `test/${proj}-sch-zoom.png` });
  await pg.locator('#pcb').hover({ position: { x: 600, y: 400 } });
  for (let i = 0; i < 5; i++) await pg.mouse.wheel(0, -200);
  await pg.waitForTimeout(400);
  await pg.locator('#pcb').screenshot({ path: `test/${proj}-pcb-zoom.png` });
  await pg.locator('#pcb').click({ position: { x: 1037, y: 775 } });
  await pg.locator('#pcb').hover({ position: { x: 760, y: 600 } });
  await pg.waitForTimeout(300);
  await pg.locator('#pcb').screenshot({ path: `test/${proj}-pcb-layers.png` });
  await b.close(); srv.close();
});
