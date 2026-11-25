// Run with a separately installed playwright-core. Default mode blocks Google
// and all writes. Live Maps and disposable local Auth tests opt in separately.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const base = new URL(process.env.WADUP_BROWSER_URL);
const localhost = url => ['127.0.0.1','localhost'].includes(url.hostname);
if (!localhost(base) && !/^[a-z0-9-]+-whb21burtons-projects\.vercel\.app$/.test(base.hostname)) throw Error('Use a WADUP preview or loopback URL');
const mode=process.argv[2] || 'preview-shell';
if (!['preview-shell','live-map','local-auth'].includes(mode)) throw Error('Unknown browser test mode');
const staging=process.env.WADUP_TEST_SUPABASE_URL ? new URL(process.env.WADUP_TEST_SUPABASE_URL) : null;
if (mode==='local-auth' && (!localhost(base)||!staging||!localhost(staging)||process.env.WADUP_LOCAL_AUTH_ISOLATED!=='true')) throw Error('Auth tests require a disposable loopback app and Supabase stack');
if (mode==='live-map' && process.env.WADUP_MAP_TEST_APPROVED!=='true') throw Error('Live Maps tests require explicit verified budget approval');
const fixtures=mode==='live-map'||mode==='local-auth' ? JSON.parse(await readFile(process.env.WADUP_BROWSER_FIXTURES,'utf8')) : {};
const {chromium}=await import(pathToFileURL(process.env.WADUP_PLAYWRIGHT_ENTRY).href);
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-background-networking']});
const token=process.env.VERCEL_OIDC_TOKEN;

async function openPage(viewport, state) {
  const page=await browser.newPage({viewport,serviceWorkers:'block'});
  await page.route('**/*',route=>{
    const request=route.request();
    const url=new URL(request.url());
    if (url.origin===base.origin) {
      if (request.method()!=='GET' && request.method()!=='HEAD' && mode!=='local-auth' &&
          !(mode==='live-map'&&url.pathname==='/api/google-map-session'&&request.method()==='POST')) return route.abort();
      if (/\/api\/(?:cron|places|geocode)\//.test(url.pathname)||url.pathname==='/api/geocode') return route.abort();
      return route.continue({headers:{...request.headers(),...(!localhost(base)&&token?{'x-vercel-trusted-oidc-idp-token':token}:{})}});
    }
    if (staging&&url.origin===staging.origin&&(['GET','HEAD'].includes(request.method())||mode==='local-auth')) return route.continue();
    if (mode==='live-map'&&['maps.googleapis.com','maps.gstatic.com'].includes(url.hostname)&&!url.pathname.includes('geocode')) return route.continue();
    return route.abort();
  });
  if (state) await page.addInitScript(value=>sessionStorage.setItem('wadup_map_state',JSON.stringify(value)),state);
  const faults=[];
  page.on('pageerror',error=>faults.push(error.message));
  const response=await page.goto(new URL('/?perf=1',base).href,{waitUntil:'domcontentloaded'});
  assert.equal(response.status(),200);
  assert.match(await page.title(),/WadUp/i,'Check preview authentication');
  return {page,faults};
}

async function shell(viewport) {
  const {page,faults}=await openPage(viewport,{lat:35.0456,lng:-85.3096,zoom:13});
  const controls=page.locator(viewport.width>600?'.sidebar-categories':'.chips').first();
  for (const text of ['Events','Bars & Nightlife','Restaurants','Outdoors','Coffee','Shopping','Activities']) {
    assert.equal(await controls.getByRole('button',{name:new RegExp(text)}).first().isVisible(),true);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(faults,[]);
  await page.close();
}

async function mapScenario(viewport, city) {
  const {page,faults}=await openPage(viewport,{lat:city.lat,lng:city.lng,zoom:city.zoom||17,date:city.date,chip:'events'});
  const diagnostics=[];
  page.on('console',async msg=>{
    if(msg.text().includes('[WADUP performance]')&&msg.args()[1]) diagnostics.push(await msg.args()[1].jsonValue());
  });
  const marker=page.locator('.wu-pin-wrapper').filter({has:page.locator('.wu-pill-tm')}).filter({hasText:city.event}).first();
  await marker.waitFor({state:'visible'});
  const neighbor=city.overlappingEvent ? page.locator('.wu-pin-wrapper').filter({has:page.locator('.wu-pill-tm')}).filter({hasText:city.overlappingEvent}).first() : null;
  if (neighbor) {
    await neighbor.waitFor({state:'visible'});
    const translations=await Promise.all([marker,neighbor].map(pin=>pin.evaluate(el=>el.style.translate)));
    if ((city.zoom||17)<17) assert.ok(translations.every(value=>!value||value==='none'));
    else assert.notEqual(translations[0],translations[1],'Overlapping neighborhood pins should stagger together');
  }
  await marker.hover();
  assert.equal(await marker.locator('.wu-tm-attached-emoji').count(),1);
  if (city.emoji) assert.equal(await marker.locator('.wu-tm-attached-emoji').textContent(),city.emoji);
  assert.match(await marker.locator('.wu-pin').evaluate(el=>el.style.transform),/1\.12/);
  await marker.click();
  assert.equal(await marker.evaluate(el=>Number(el.style.zIndex)),2147483000);
  if (neighbor) assert.ok(await neighbor.evaluate(el=>Number(el.style.zIndex))<2147483000);
  const popup=page.locator('.gm-iw').filter({hasText:city.event}).last();
  await popup.waitFor({state:'visible'});
  for(const time of city.showtimes)assert.ok((await popup.textContent()).includes(time));
  if (city.otherDayNumber) {
    const date = page.locator((viewport.width>600?'.sidebar-days':'.hud')+' .day-btn:visible')
      .filter({has:page.locator('.day-num').getByText(String(city.otherDayNumber),{exact:true})}).first();
    await date.click();
    await page.waitForFunction(() => !document.querySelector('.tm-showtimes')?.getClientRects().length);
  }
  await page.mouse.move(viewport.width*0.7,viewport.height*0.58);
  for (const delta of [-250,120,-200,300]) await page.mouse.wheel(0,delta);
  await page.mouse.down();
  await page.mouse.move(viewport.width*0.55,viewport.height*0.46,{steps:8});
  await page.mouse.up();
  await page.waitForTimeout(950);
  assert.ok(diagnostics.length,'No map idle diagnostics were captured');
  if (city.maxP95FrameMs) assert.ok(diagnostics.at(-1).p95FrameMs<=city.maxP95FrameMs);
  assert.deepEqual(faults,[]);
  console.log(city.name,viewport.width,diagnostics.at(-1));
  await page.close();
  if (city.rankNames?.length) {
    const {page:restaurants}=await openPage(viewport,{lat:city.lat,lng:city.lng,zoom:17,date:city.date,chip:'restaurant'});
    const colors=['rgb(255, 215, 0)','rgb(192, 192, 192)','rgb(205, 127, 50)'];
    for (const [index,name] of city.rankNames.entries()) {
      const ranked=restaurants.locator('#map .wu-pill').filter({hasText:name}).first();
      await ranked.waitFor({state:'visible'});
      assert.match(await ranked.textContent(),new RegExp(`#${index+1}\b`));
      assert.equal(await ranked.evaluate(el=>getComputedStyle(el).backgroundColor),colors[index]);
    }
    await restaurants.close();
  }
}

async function localAuth() {
  const viewport={width:1440,height:900};
  const {page,faults}=await openPage(viewport,{lat:35.0456,lng:-85.3096,zoom:13});
  const username=`fixture_${randomUUID().slice(0,8)}`;
  const email=`${username}@example.test`;
  const password=`Test!${randomUUID()}`;
  await page.getByRole('button',{name:'Account',exact:true}).click();
  await page.getByRole('button',{name:'Create Account',exact:true}).click();
  const form=page.locator('.auth-form');
  await form.locator('input[type=text]').first().fill(username);
  await form.locator('input[type=email]').fill(email);
  await form.locator('input[type=password]').nth(0).fill(password);
  await form.locator('input[type=password]').nth(1).fill(password);
  await form.locator('input[type=tel]').fill('4235550100');
  await form.getByPlaceholder('This becomes your local city').fill('Chattanooga');
  await form.getByRole('button',{name:'Create Account',exact:true}).click();
  await page.getByRole('button',{name:'Log Out',exact:true}).click();
  await form.locator('input[type=email]').fill(email);
  await form.locator('input[type=password]').fill(password);
  await form.getByRole('button',{name:'Log In',exact:true}).click();
  await page.getByRole('button',{name:'Log Out',exact:true}).waitFor();
  assert.match(fixtures.venueId,/^[a-z0-9-]+$/i);
  await page.goto(new URL(`/venue/${fixtures.venueId}`,base).href);
  await page.getByRole('heading',{name:fixtures.venueName,exact:true}).waitFor();
  await page.getByRole('button',{name:'Write a Review',exact:true}).click();
  const review=`Fixture review ${username}`;
  await page.getByPlaceholder('What was it like?').fill(review);
  const posted=page.waitForResponse(r=>r.url().endsWith('/api/reviews/submit')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Submit Rating',exact:true}).click();
  assert.equal((await posted).ok(),true);
  await page.reload();
  await page.getByText(review,{exact:true}).waitFor();
  assert.deepEqual(faults,[]);
  await page.close();
}

try {
  const sizes=[{width:1440,height:900},{width:390,height:844}];
  if(mode==='local-auth') await localAuth();
  else for (const viewport of sizes) {
    if(mode==='preview-shell') await shell(viewport);
    else for(const city of fixtures.cities) await mapScenario(viewport,city);
  }
  console.log(`${mode} browser checks passed`);
} finally { await browser.close(); }
