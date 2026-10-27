const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('/Users/yangchen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = '/Users/yangchen/Code/myGithub/ReadAny';
const fixtures = '/tmp/readany-foldable-browser';
const output = path.join(root, 'plans/artifacts/foldable-ai-split');
fs.mkdirSync(output, { recursive: true });
const readerPath = path.join(root, 'packages/app-expo/assets/reader/reader.html');
let activeStage = 'startup';
const report = { started: new Date().toISOString(), readerSha256: crypto.createHash('sha256').update(fs.readFileSync(readerPath)).digest('hex'), scenarios: [], groups: [], errors: [], consoleErrors: [], externalRequests: [], commands: [] };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const allowed = ['horizontal.epub', 'vertical.epub', 'fixed.epub', 'synthetic-ai-split.pdf'];
  const file = url.pathname === '/reader.html' ? readerPath : allowed.includes(url.pathname.slice(1)) ? path.join(fixtures, url.pathname.slice(1)) : null;
  if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.epub') ? 'application/epub+zip' : file.endsWith('.pdf') ? 'application/pdf' : 'text/html; charset=utf-8');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => { const detail={stage:activeStage,message:error.message,stack:error.stack};report.errors.push(detail);console.error('PAGEERROR',JSON.stringify(detail)); });
  page.on('console', m => { if (m.type() === 'error') report.consoleErrors.push(m.text()); });
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !url.startsWith(origin + '/')) { report.externalRequests.push(url); await route.abort(); }
    else await route.continue();
  });
  await context.addInitScript(() => {
    window.__messages = [];
    window.ReactNativeWebView = { postMessage: message => window.__messages.push(JSON.parse(message)) };
  });
  const command = async msg => {
    activeStage = `${msg.type}:${msg.fileName || JSON.stringify(msg.settings || {})}`;
    report.commands.push({ type: msg.type, settings: msg.settings, fileName: msg.fileName });
    await page.evaluate(msg => window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg) })), msg);
  };
  const settle = async () => page.evaluate(async () => {
    for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
    await new Promise(resolve => setTimeout(resolve, 450));
  });
  const snapshot = () => page.evaluate(() => {
    const view = document.querySelector('foliate-view');
    const renderer = view.renderer;
    const rect = r => ({x:r.x,y:r.y,width:r.width,height:r.height});
    return {
      viewport: { width: innerWidth, height: innerHeight }, readerBounds: rect(renderer.getBoundingClientRect()), fixed: view.isFixedLayout,
      maxColumns: renderer.getAttribute('max-column-count'), maxInline: renderer.getAttribute('max-inline-size'), flow: renderer.getAttribute('flow'), spread: renderer.getAttribute('spread'), zoom: renderer.getAttribute('zoom'), page: renderer.page, pages: renderer.pages, cfi: view.lastLocation?.cfi,
      frames: renderer.getContents().map(({doc,index}) => {
        const win = doc.defaultView, p = doc.querySelector('p'), text = doc.querySelector('.textLayer span'), canvas = doc.querySelector('canvas'), frame = win.frameElement;
        return { index, width: doc.documentElement.clientWidth, height:doc.documentElement.clientHeight, writingMode: win.getComputedStyle(doc.documentElement).writingMode, fontSize: p && win.getComputedStyle(p).fontSize, rootFontSize:win.getComputedStyle(doc.documentElement).fontSize, columnWidth: win.getComputedStyle(doc.documentElement).columnWidth, columnGap: win.getComputedStyle(doc.documentElement).columnGap, frameBounds:rect(frame.getBoundingClientRect()), frameTransform:win.parent.getComputedStyle(frame).transform, text: doc.body.innerText.slice(0,160), canvas: canvas && {width:canvas.width,height:canvas.height,cssWidth:canvas.style.width,cssHeight:canvas.style.height}, textLayer: text && {text:text.textContent,fontSize:win.getComputedStyle(text).fontSize,transform:win.getComputedStyle(text).transform,rect:rect(text.getBoundingClientRect())} };
      }), loadedCount: window.__messages.filter(m=>m.type==='loaded').length, sameView: window.__originalView === view, sameRenderer: window.__originalRenderer === renderer, failures: window.__messages.filter(m=>m.type==='error')
    };
  });
  const anchorGeometry = cfi => page.evaluate(cfi => {
    const view = document.querySelector('foliate-view');
    try {
      const resolved = view.resolveCFI(cfi), content = view.renderer.getContents().find(item=>item.index===resolved.index);
      if (!content) return { visible:false,reason:'section not rendered',index:resolved.index };
      const range = resolved.anchor(content.doc); range.collapse(true);
      if(range.startContainer.nodeType!==3) {
        const node=range.startContainer.childNodes[range.startOffset]||range.startContainer;
        const walker=content.doc.createTreeWalker(node,NodeFilter.SHOW_TEXT);
        const text=node.nodeType===3?node:walker.nextNode();
        if(text) range.setStart(text,0);
      }
      if(range.startContainer.nodeType===3) range.setEnd(range.startContainer,Math.min(range.startOffset+1,range.startContainer.length));
      const r = range.getBoundingClientRect(), f = content.doc.defaultView.frameElement.getBoundingClientRect(), b = view.renderer.getBoundingClientRect();
      // 可重排 iframe 不缩放；先转为顶层坐标，再与 renderer 求交。
      const x=f.x+r.x,y=f.y+r.y;
      return { text:range.toString(),context:range.startContainer.textContent.slice(Math.max(0,range.startOffset-20),range.startOffset+80),x,y,width:r.width,height:r.height,renderer:{x:b.x,y:b.y,width:b.width,height:b.height},visible:r.width>0&&r.height>0&&x+r.width>b.left&&x<b.right&&y+r.height>b.top&&y<b.bottom };
    } catch(error) { return {visible:false,error:String(error)}; }
  }, cfi);
  const record = async (name, {columns,font,anchor,fixed,flow}={}) => {
    await settle();
    const state = await snapshot();
    if(anchor) state.originalAnchor = await anchorGeometry(anchor);
    report.scenarios.push({name,...state});
    await page.screenshot({path:path.join(output,`${name}.png`)});
    console.log(name,JSON.stringify({width:state.readerBounds.width,columns:state.maxColumns,font:state.frames.map(f=>f.fontSize),anchor:state.originalAnchor?.visible,fixed:state.fixed,flow:state.flow,spread:state.spread,zoom:state.zoom}));
    if(columns!==undefined) assert.equal(state.maxColumns,String(columns),name+' columns');
    if(font!==undefined) for(const frame of state.frames) assert.equal(frame.fontSize,`${font}px`,name+' font unchanged');
    if(anchor) assert.ok(state.originalAnchor.visible,name+' original text visible: '+JSON.stringify(state.originalAnchor));
    if(fixed!==undefined) assert.equal(state.fixed,fixed,name+' fixed');
    if(flow!==undefined) assert.equal(state.flow,flow,name+' flow');
    assert.equal(state.failures.length,0,name+' bridge errors');
    assert.equal(state.loadedCount,1,name+' no book reload');
    assert.equal(state.sameView,true,name+' view retained');
    assert.equal(state.sameRenderer,true,name+' renderer retained');
    return state;
  };
  const width = async (w,kind='container',height=800) => {
    activeStage = `resize:${kind}:${w}x${height}`;
    if(kind==='viewport') { await page.evaluate(()=>document.getElementById('reader-container').style.removeProperty('width')); await page.setViewportSize({width:w,height}); }
    else { await page.evaluate(w=>{document.getElementById('reader-container').style.width=w+'px';},w); }
    await settle();
  };
  const open = async (file,settings={}) => {
    await page.setViewportSize({width:1280,height:800});
    await page.goto(`${origin}/reader.html`);
    await page.waitForFunction(()=>window.__messages.some(m=>m.type==='ready'));
    await command({type:'setThemeColors',colors:{background:'#faf8f2',foreground:'#282521',primary:'#9c6e31',muted:'#7c786f'},themeMode:'light'});
    await command({type:'openBook',uri:`${origin}/${file}`,fileName:file,mimeType:file.endsWith('.pdf')?'application/pdf':'application/epub+zip',settings:{fontSize:18,lineHeight:1.7,pageMargin:16,paginatedLayout:'double',viewMode:'paginated',...settings}});
    await page.waitForFunction(()=>window.__messages.some(m=>m.type==='relocate')||window.__messages.some(m=>m.type==='error'));
    await settle();
    await page.evaluate(()=>{window.__originalView=document.querySelector('foliate-view');window.__originalRenderer=window.__originalView?.renderer;});
    const failures=await page.evaluate(()=>window.__messages.filter(m=>m.type==='error'));assert.equal(failures.length,0,JSON.stringify(failures));
  };
  const locate = async () => {await command({type:'goToFraction',fraction:0.31});await settle();return (await snapshot()).cfi;};
  const group = async (name,run) => {
    if(process.env.READANY_BROWSER_GROUPS && !process.env.READANY_BROWSER_GROUPS.split(',').includes(name)) return;
    activeStage=name;
    try { await run();report.groups.push({name,passed:true}); }
    catch(error) {report.groups.push({name,passed:false,failure:error.stack});console.error(name,error.stack);await page.screenshot({path:path.join(output,`${name}-failure.png`)}).catch(()=>{});}
    fs.writeFileSync(path.join(output,'reader-browser-report.json'),JSON.stringify(report,null,2));
  };
  try {
    await group('paginated-container',async()=>{
      await open('horizontal.epub'); const anchor=await locate();
      for(const w of [1280,320,400,560,1280,320,560,400,1280]) { await width(w);await record(`paginated-container-${report.scenarios.length}-${w}`,{columns:w>=704?2:1,font:18,anchor,fixed:false}); }
      await command({type:'applySettings',settings:{paginatedLayout:'single'}});
      await record('forced-single-1280',{columns:1,font:18,anchor});
      for(const w of [320,400,560,1280]) {await width(w);await record(`single-container-${w}`,{columns:1,font:18,anchor});}
      await command({type:'applySettings',settings:{fontSize:32,paginatedLayout:'double'}});
      await record('large-font-double-1280',{columns:2,font:32,anchor});
      for(const w of [560,400,320,960,1280]) {await width(w);await record(`large-font-container-${w}`,{columns:w>=1280?2:1,font:32,anchor});}
    });
    await group('paginated-viewport',async()=>{
      await open('horizontal.epub');const anchor=await locate();
      for(const [w,h] of [[1280,800],[320,800],[400,800],[560,800],[840,390],[1280,800]]) {await width(w,'viewport',h);await record(`viewport-${w}x${h}`,{columns:w>=704?2:1,font:18,anchor});}
    });
    await group('navigation-and-search',async()=>{
      await open('horizontal.epub');let before=await snapshot();
      await command({type:'goNext'});await settle();let next=await snapshot();assert.notEqual(next.cfi,before.cfi);
      await command({type:'goPrev'});await settle();assert.equal((await snapshot()).page,before.page);
      await command({type:'goToHref',href:'chapter2.xhtml'});await settle();assert.match(await page.evaluate(()=>document.querySelector('foliate-view').lastLocation.tocItem?.label),/2/);
      await command({type:'goToCFI',cfi:before.cfi});await settle();assert.ok((await anchorGeometry(before.cfi)).visible);
      await command({type:'search',query:'海边',requestId:'ai-split-1'});
      await page.waitForFunction(()=>window.__messages.some(m=>m.type==='searchComplete'&&m.requestId==='ai-split-1'));
      const result=await page.evaluate(()=>window.__messages.findLast(m=>m.type==='searchComplete'&&m.requestId==='ai-split-1'));
      assert.ok(result.count>3);await command({type:'navigateSearch',index:2,requestId:'ai-split-1'});await settle();
      report.search={count:result.count,target:result.results[2]};
      for(const w of [1280,320,400,560,1280]) {await width(w);await record(`search-container-${w}`,{columns:w>=704?2:1,font:18,anchor:result.results[2].cfi});}
    });
    await group('scroll-container',async()=>{
      await open('horizontal.epub',{viewMode:'scroll'});const anchor=await locate();
      for(const w of [1280,320,400,560,1280]) {await width(w);const state=await record(`scroll-container-${w}`,{columns:1,font:18,flow:'scrolled',anchor});assert.equal(state.maxInline,'9999px');}
      await command({type:'goNext'});await settle();await record('scroll-next',{columns:1,font:18,flow:'scrolled'});
    });
    await group('vertical-source',async()=>{
      await open('vertical.epub');const anchor=await locate();
      for(const w of [1280,320,400,560,1280]) {await width(w);const state=await record(`vertical-source-${w}`,{columns:w>=704?2:1,font:18,anchor});assert.equal(state.frames[0].writingMode,'horizontal-tb');}
    });
    for(const file of ['fixed.epub','synthetic-ai-split.pdf']) await group(file.endsWith('.pdf')?'pdf-fixed':'epub-fixed',async()=>{
      await open(file);await command({type:'goNext'});await settle();
      const initial=await snapshot(); const indices=initial.frames.map(f=>f.index);
      const prefix=file.endsWith('.pdf')?'pdf-fixed':'epub-fixed';
      for(const w of [1280,320,400,560,1280]) {
        await width(w); const state=await record(`${prefix}-${w}`,{fixed:true});
        assert.equal(state.maxColumns,null);assert.equal(state.spread,'auto');assert.equal(state.zoom,'fit-page');assert.deepEqual(state.frames.map(f=>f.index),indices);
        if(file.endsWith('.pdf')) assert.ok(state.frames.filter(f=>f.text).every(f=>f.canvas&&f.textLayer),'PDF canvas and text layer');
      }
      if(file.endsWith('.pdf')) {
        const pre=await snapshot();await command({type:'applySettings',settings:{fontSize:48,lineHeight:3,paragraphSpacing:30,viewMode:'scroll'}});await settle();const post=await snapshot();
        assert.deepEqual(post.frames.map(f=>f.textLayer),pre.frames.map(f=>f.textLayer),'PDF ignores reflow settings');
        await record('pdf-reflow-settings-ignored',{fixed:true});
      }
      await command({type:'applySettings',settings:{paginatedLayout:'single'}});await settle();
      for(const w of [1280,320,400,560,1280]) {await width(w);const state=await record(`${prefix}-single-${w}`,{fixed:true});assert.equal(state.spread,'none');assert.equal(state.zoom,'fit-width');}
    });
    report.passed=report.groups.every(g=>g.passed)&&report.errors.length===0&&report.externalRequests.length===0;
    report.finished=new Date().toISOString();
    fs.writeFileSync(path.join(output,'reader-browser-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:report.passed,groups:report.groups,errors:report.errors,externalRequests:report.externalRequests},null,2));
    if(!report.passed)process.exitCode=1;
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
