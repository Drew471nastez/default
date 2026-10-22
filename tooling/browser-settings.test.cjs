const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const {source, render, settings} = require('./theme-test-runtime.cjs');
const {engine} = require('./theme-test-runtime.cjs');

function defaultsFor(file, overrides = {}) {
  const data=JSON.parse(source(file).match(/<schema>\s*([\s\S]*?)\s*<\/schema>/)[1]);
  return {...Object.fromEntries(((data.shopify || data).settings || []).filter(s => s.id && s.default !== undefined).map(s => [s.id,s.default])), ...overrides};
}

async function openBrowser() {
  return chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)});
}

test('secondary images decode before a smooth crossfade, cancel safely and respect reduced motion', async () => {
  const browser=await openBrowser();
  try {
    const page=await browser.newPage();
    const css=source('snippets/card-gallery.storelib').match(/{% stylesheet %}([\s\S]*?){% endstylesheet %}/)[1];
    await page.setContent(`<style>${css} .card-gallery{width:200px;height:200px} slideshow-slide{display:block} img{width:100%;height:100%;object-fit:cover}</style><div id="card"><div class="card-gallery"><slideshow-slide><img></slideshow-slide><slideshow-slide hidden><img></slideshow-slide></div></div>`);
    await page.addScriptTag({content:source('shopify/assets/card-image-preview.js').replaceAll('export ','')+'\nwindow.previewCardImage=previewCardImage; window.resetCardImage=resetCardImage; window.disposeCardImagePreview=disposeCardImagePreview;'});
    await page.evaluate(async () => {
      const card=document.querySelector('#card');
      card.refs={slideshow:{current:0,slides:[...card.querySelectorAll('slideshow-slide')]}};
      for (const [index,img] of [...card.querySelectorAll('img')].entries()) {
        img.src='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${index?'blue':'red'}"/></svg>`);
        await img.decode();
      }
      await window.previewCardImage(card);
    });
    await page.waitForFunction(()=>{const opacity=+getComputedStyle(document.querySelector('.card-gallery__hover-image')).opacity;return opacity>0 && opacity<1;});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.card-gallery__hover-image')).opacity==='1');
    assert.equal(await page.evaluate(()=>document.querySelector('#card').refs.slideshow.current),0,'preview must not advance the selected carousel image');
    await page.evaluate(()=>window.resetCardImage(document.querySelector('#card')));
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.card-gallery__hover-image')).opacity==='0');
    await page.evaluate(async () => {
      const card=document.querySelector('#card');
      window.disposeCardImagePreview(card);
      const decode=HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode=()=>new Promise(resolve=>window.finishDecode=resolve);
      window.previewCardImage(card);
      window.resetCardImage(card);
      window.finishDecode();
      HTMLImageElement.prototype.decode=decode;
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    });
    assert.equal(await page.locator('.card-gallery__hover-image').getAttribute('data-visible'),null,'late image decoding must not restart a cancelled hover');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>window.previewCardImage(document.querySelector('#card')));
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.card-gallery__hover-image')).opacity==='1');
    assert.equal(await page.locator('.card-gallery__hover-image').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
    await page.evaluate(()=>window.disposeCardImagePreview(document.querySelector('#card')));
    assert.equal(await page.locator('.card-gallery__hover-image').count(),0);
  } finally { await browser.close(); }
});

test('header measurement includes unchanged rows and follows section replacement', async () => {
  const browser=await openBrowser();
  try {
    const page=await browser.newPage();
    await page.setContent('<div id="header-group"><div><header-component id="header-component" style="display:block;height:60px"></header-component></div><div id="announcement" style="height:24px"></div></div>');
    const calculate=source('shopify/assets/utilities.js').match(/export function calculateHeaderGroupHeight\([\s\S]*?\n}/)[0].replace('export ','');
    const observers=source('shopify/assets/header.js').slice(source('shopify/assets/header.js').indexOf('onDocumentLoaded(() => {'));
    await page.addScriptTag({content:calculate+'\nconst onDocumentLoaded=callback=>callback();\n'+observers});
    const height=()=>page.evaluate(()=>document.body.style.getPropertyValue('--header-group-height'));
    await page.waitForFunction(()=>document.body.style.getPropertyValue('--header-group-height')==='84px');
    await page.locator('#announcement').evaluate(el=>el.style.height='40px');
    await page.waitForFunction(()=>document.body.style.getPropertyValue('--header-group-height')==='100px');
    assert.equal(await height(),'100px');
    await page.locator('#header-component').evaluate(el=>el.outerHTML='<header-component id="header-component" style="display:block;height:80px"></header-component>');
    await page.waitForFunction(()=>document.body.style.getPropertyValue('--header-group-height')==='120px');
  } finally { await browser.close(); }
});

test('editor batches section updates and tolerates blocked or malformed session storage', async () => {
  const browser=await openBrowser();
  try {
    for (const blocked of [false,true]) {
      const page=await browser.newPage();
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.setContent('<dialog class="search-modal"></dialog>');
      await page.evaluate(blocked=>{
        window.Shopify={designMode:true};window.headerUpdates=0;window.storageWrites=0;
        const records={'editor-save-state-search-modal':'{malformed'};
        Object.defineProperty(window,'sessionStorage',{value:{
          getItem(key){if(blocked)throw new Error('Blocked');return records[key]||null;},
          setItem(key,value){if(blocked)throw new Error('Blocked');records[key]=value;window.storageWrites++;},
          removeItem(key){delete records[key];},
        }});
      },blocked);
      await page.addScriptTag({content:source('shopify/assets/theme-editor.js').replace("import { updateAllHeaderCustomProperties } from '@theme/utilities';",'const updateAllHeaderCustomProperties=()=>window.headerUpdates++;')});
      await page.evaluate(()=>{
        for(let i=0;i<12;i++)document.dispatchEvent(new Event('shopify:section:load'));
        const dialog=document.querySelector('dialog');dialog.setAttribute('open','');dialog.removeAttribute('open');dialog.setAttribute('open','');
      });
      await page.waitForFunction(()=>window.headerUpdates===1);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.evaluate(()=>window.storageWrites),blocked?0:1);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('page width presets stay centered and section spacing responds on desktop and mobile', async () => {
  const browser=await openBrowser();
  try {
    const page=await browser.newPage();
    for (const scale of [50,100,150]) {
      const values=settings({content_max_width:1200,section_spacing_scale:scale});
      const variables=await render('snippets/theme-styles-variables.storelib',{settings:values});
      const spacing=await render('snippets/spacing-style.storelib',{settings:{padding_block_start:80,padding_block_end:0}});
      for (const [preset,width] of [['narrow',1200],['normal',1600],['wide',2000]]) {
        await page.setViewportSize({width:2400,height:1000});
        await page.setContent(`<style>${source('shopify/assets/base.css')}</style>${variables}<body class="page-width-${preset}"><section class="section section--page-width spacing-style" style="${spacing}"><div id="content">Example</div></section></body>`);
        const dimensions=await page.locator('#content').evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,left:r.left,right:r.right,padding:getComputedStyle(el.parentElement).paddingTop};});
        assert(Math.abs(dimensions.width-width)<1);
        assert(Math.abs(dimensions.left-(2400-dimensions.right))<1);
        assert.equal(dimensions.padding,`${80*scale/100}px`);
        await page.setViewportSize({width:375,height:800});
        const mobile=await page.locator('#content').evaluate(el=>({width:el.getBoundingClientRect().width,padding:getComputedStyle(el.parentElement).paddingTop,overflow:document.documentElement.scrollWidth>innerWidth}));
        assert.equal(mobile.width,343);
        assert(Math.abs(parseFloat(mobile.padding)-80*scale/100*.7)<.1);
        assert(!mobile.overflow);
      }
    }
  } finally { await browser.close(); }
});

test('theme controls reach computed styles at mobile, tablet and desktop sizes', async () => {
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({headless:true, executablePath});
  try {
    const values = settings({product_card_radius:18,product_card_padding:12,product_card_gap:22,product_card_alignment:'center',product_card_title_lines:2,product_card_title_preset:'h5',product_card_color_scheme:'inverse',product_card_price_size:17,type_weight_h5:'700',type_font_button_primary:'heading',type_heading_font:{family:'Arial',fallback_families:'sans-serif',weight:600,style:'normal'},cookie_banner_width:600,cookie_banner_radius:16});
    const global = await render('snippets/theme-styles-variables.storelib',{settings:values});
    const title = await render('blocks/product-title.storelib',{settings:values,closest:{product:{title:'A deliberately long product title to verify truncation and shared typography on small screens',url:'/products/example'}},block:{id:'title',settings:{type_preset:'h4',width:'100%',max_width:'none'}}});
    const card = await render('snippets/product-card.storelib',{settings:values,block:{id:'card',settings:{}},product:{id:'p1',available:true,title:'Example',url:'/products/example'},children:title+'<product-price><span class="price">25.00</span></product-price>'});
    const cookie = await render('snippets/cookie-banner-styles.storelib',{settings:values});
    const page = await browser.newPage();
    for (const width of [375,768,1440]) {
      await page.setViewportSize({width,height:900});
      // This fixture supplies the platform banner DOM, not a consent implementation.
      await page.setContent('<!doctype html><html><head><style>'+source('shopify/assets/base.css')+'</style>'+global+cookie+'<style>body{--color-background:#fff;--color-foreground:#171717;--color-border:#ddd;--color-primary-button-text:#fff;--color-primary-button-background:#171717;--color-primary-button-border:#171717}#shopify-pc__banner{position:fixed}.fixture{display:grid;grid-template-columns:minmax(0,320px);padding:16px}</style></head><body><div class="fixture">'+card+'</div><div id="shopify-pc__banner"><h2>Privacy preferences</h2><p>Control optional cookies.</p><button class="shopify-pc__banner__btn-accept">Accept</button><button class="shopify-pc__banner__btn-decline">Decline</button></div></body></html>');
      const result = await page.evaluate(() => {
        const get = selector => getComputedStyle(document.querySelector(selector));
        const card = get('.product-card__content');
        const title = get('.product-title-block > *');
        const banner = document.querySelector('#shopify-pc__banner');
        const button = document.querySelector('#shopify-pc__banner button');
        return {radius:card.borderRadius,gap:card.rowGap,padding:card.paddingTop,bg:card.backgroundColor,weight:title.fontWeight,lines:title.webkitLineClamp,titleAlign:title.textAlign,priceSize:get('product-price .price').fontSize,buttonWeight:get('#shopify-pc__banner button').fontWeight,bannerWidth:banner.getBoundingClientRect().width,bannerRight:banner.getBoundingClientRect().right,buttonHeight:button.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      assert.equal(result.radius,'18px',`${width}px: radius`);
      assert.equal(result.gap,'22px',`${width}px: gap`);
      assert.equal(result.padding,'12px',`${width}px: padding`);
      assert.equal(result.weight,'700',`${width}px: weight`);
      assert.equal(result.lines,'2',`${width}px: title lines`);
      assert.equal(result.titleAlign,'center',`${width}px: alignment`);
      assert.equal(result.bg,'rgb(23, 23, 23)',`${width}px: scheme`);
      assert.equal(result.priceSize,'17px',`${width}px: price size`);
      assert.equal(result.buttonWeight,'600',`${width}px: button weight`);
      assert(result.bannerWidth <= width-32,`${width}px: banner width`);
      assert(result.bannerRight <= width,`${width}px: banner edge`);
      assert(result.buttonHeight >= 44,`${width}px: button target`);
      assert(!result.overflow,`${width}px: horizontal overflow`);
    }
  } finally {
    await browser.close();
  }
});

test('section inheritance reaches groups, search cards and form fields in both text directions', async () => {
  const browser=await openBrowser();
  try {
    const values=settings({default_section_color_scheme:'inverse',product_card_color_scheme:'inherit',type_preset:'h5',type_weight_h5:'700',product_card_padding:18,product_card_price_size:19,content_max_width:1200});
    const global=await render('snippets/theme-styles-variables.storelib',{settings:values});
    const palette=await render('snippets/color-palette.storelib',{settings:values});
    const group=await engine({settings:values}).parseAndRender("{% render 'group', settings: group_settings, block_id: 'nested', children: children %}",{group_settings:{theme_color_scheme:'inherit'},children:'<p>Nested group content</p>'});
    const resource=await render('snippets/resource-card.storelib',{settings:values,resource_type:'product',resource:{id:'p1',title:'A search product',url:'/products/example',available:true,price:1000,selected_or_first_available_variant:{price:1000}}});
    const bubble=await render('snippets/cart-bubble.storelib',{settings:values,cart:{item_count:2}});
    const content=group+resource+bubble+'<label for="fixture-email">Email</label><input id="fixture-email" type="email">';
    const section=await render('sections/custom-liquid.storelib',{settings:values,section:{id:'section-test',settings:defaultsFor('sections/custom-liquid.storelib',{theme_color_scheme:'inherit',custom_liquid:content})}});
    const page=await browser.newPage();
    for (const width of [375,768,1440]) for (const dir of ['ltr','rtl']) {
      await page.setViewportSize({width,height:900});
      await page.setContent(`<!doctype html><html dir="${dir}"><head><style>${source('shopify/assets/base.css')}</style>${global}${palette}</head><body class="page-width-narrow">${section}</body></html>`);
      const result=await page.evaluate(() => {
        const read=s=>getComputedStyle(document.querySelector(s));
        return {sectionBackground:read('.section').backgroundColor,groupBackground:read('.group-block').getPropertyValue('--color-background').trim(),cardPadding:read('.resource-card').paddingTop,priceSize:read('.resource-card .price').fontSize,fieldWeight:read('input').fontWeight,fieldColor:read('input').color,bubbleBackground:read('.cart-bubble__background').backgroundColor,bubbleText:read('.cart-bubble').color,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      assert.equal(result.sectionBackground,'rgb(23, 23, 23)');
      assert.equal(result.groupBackground,'#171717');
      assert.equal(result.cardPadding,'18px');
      assert.equal(result.priceSize,'19px');
      assert.equal(result.fieldWeight,'700');
      assert.equal(result.fieldColor,'rgb(255, 255, 255)');
      assert.equal(result.bubbleBackground,'rgb(255, 255, 255)');
      assert.equal(result.bubbleText,'rgb(23, 23, 23)');
      assert(!result.overflow,`${width}px ${dir}: horizontal overflow`);
    }
  } finally {await browser.close();}
});

test('account screens stay usable on small screens and hand off to the platform account route', async () => {
  const browser=await openBrowser();
  try {
    const page=await browser.newPage();
    let screen='';
    await page.route('https://theme.test/**',route => route.fulfill({contentType:'text/html',body:new URL(route.request().url()).pathname==='/account'?'<h1>Platform account route</h1>':screen}));
    const values=settings();
    const global=await render('snippets/theme-styles-variables.storelib',{settings:values});
    const palette=await render('snippets/color-palette.storelib',{settings:values});
    for (const width of [375,768,1440]) for (const mode of ['login','signup','account']) {
      await page.setViewportSize({width,height:900});
      const section=await render('sections/customer-access.storelib',{settings:values,shop:{customer_accounts_enabled:true},routes:{account_url:'/account'},section:{id:mode,settings:defaultsFor('sections/customer-access.storelib',{mode})}});
      screen=`<!doctype html><html><head><style>${source('shopify/assets/base.css')}</style>${global}${palette}</head><body class="page-width-narrow">${section}</body></html>`;
      await page.goto(`https://theme.test/${mode==='account'?'customer-account':mode}`);
      assert.equal(await page.locator('h1').count(),1);
      assert(!(await page.evaluate(() => document.documentElement.scrollWidth>innerWidth)));
      const action=page.locator('.customer-access__content > .button');
      assert((await action.boundingBox()).height>=44);
      await page.keyboard.press('Tab');
      assert(await action.evaluate(element => element===document.activeElement));
      await action.click();
      await page.waitForURL('https://theme.test/account');
    }
    // The route above is deliberately mocked; this verifies navigation, not authentication.
  } finally {await browser.close();}
});
