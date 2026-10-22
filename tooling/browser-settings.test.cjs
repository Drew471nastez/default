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

test('shared style changes update existing grid/search cards and price alignment without navigation or scroll reset', async () => {
  const browser=await openBrowser();
  try {
    const page=await browser.newPage();
    const product={id:'p1',title:'Example',url:'/products/example',available:true,selected_or_first_available_variant:{price:1000,compare_at_price:2000}};
    const before=settings({product_card_radius:4,product_card_padding:8,product_card_gap:10,product_card_alignment:'start',product_card_price_size:14});
    const after=settings({product_card_radius:28,product_card_padding:20,product_card_gap:24,product_card_alignment:'center',product_card_price_size:22,product_card_border_width:2});
    const price=await render('blocks/price.storelib',{settings:before,closest:{product},template:{name:'collection'},block:{id:'price',settings:{width:'fit-content',alignment:'left',type_preset:'h6',show_sale_price_first:true}}});
    const title=await render('blocks/product-title.storelib',{settings:before,closest:{product},block:{id:'title',settings:{width:'fit-content',type_preset:'h5',alignment:'left'}}});
    const children=title+price;
    const card=await render('snippets/product-card.storelib',{settings:before,product,block:{id:'shared-card',settings:{}},children});
    const custom=await render('snippets/product-card.storelib',{settings:before,product,block:{id:'custom-card',settings:{card_style_source:'custom',border:'solid',border_width:1,border_radius:3,product_card_gap:5}},children});
    const resource=await render('snippets/resource-card.storelib',{settings:before,resource_type:'product',resource:product});
    const css=html=>[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');
    const initialCSS=css(await render('snippets/theme-styles-variables.storelib',{settings:before}));
    const updatedCSS=css(await render('snippets/theme-styles-variables.storelib',{settings:after}));
    for (const width of [375,768,1440]) {
      await page.setViewportSize({width,height:800});
      await page.setContent(`<style>${source('shopify/assets/base.css')}</style><style id="shared-settings">${initialCSS}</style><div class="page-wrapper"><div style="height:900px;flex:none"></div><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px">${card}${custom}${resource}</div><div style="height:1500px;flex:none"></div></div>`);
      let navigations=0;const onNavigate=()=>navigations++;page.on('framenavigated',onNavigate);
      await page.evaluate(()=>{
        window.existingCard=document.querySelector('#product-card-shared-card');
        window.existingPrice=window.existingCard.querySelector('product-price');
        window.fixtureScroller=innerWidth>=990?document.querySelector('.page-wrapper'):document.scrollingElement;
        window.fixtureScroller.scrollTo({top:700,behavior:'instant'});
      });
      await page.evaluate(css=>document.querySelector('#shared-settings').textContent=css,updatedCSS);
      const result=await page.evaluate(()=>{
        const card=document.querySelector('#product-card-shared-card');
        const content=card.querySelector('.product-card__content');
        const price=card.querySelector('product-price');
        const container=price.querySelector('[ref="priceContainer"]');
        const spans=[...container.querySelectorAll('.price-item__group')].map(el=>el.getBoundingClientRect());
        const bounds=container.getBoundingClientRect();
        return {
          sameCard:card===window.existingCard,samePrice:price===window.existingPrice,scroll:window.fixtureScroller.scrollTop,
          radius:getComputedStyle(content).borderRadius,padding:getComputedStyle(content).paddingTop,gap:getComputedStyle(content).rowGap,
          titleAlign:getComputedStyle(card.querySelector('.product-title-block')).textAlign,priceAlign:getComputedStyle(container).textAlign,
          priceFont:getComputedStyle(price.querySelector('.price')).fontSize,
          centered:Math.abs((Math.min(...spans.map(r=>r.left))+Math.max(...spans.map(r=>r.right)))/2-(bounds.left+bounds.right)/2)<2,
          fullPriceWidth:Math.abs(price.getBoundingClientRect().width-content.clientWidth+parseFloat(getComputedStyle(content).paddingLeft)+parseFloat(getComputedStyle(content).paddingRight))<2,
          searchRadius:getComputedStyle(document.querySelector('.resource-card--theme')).borderRadius,
          customRadius:getComputedStyle(document.querySelector('#product-card-custom-card .product-card__content')).borderRadius,
        };
      });
      assert(result.sameCard&&result.samePrice,'style changes must not replace card or price nodes');
      assert.equal(navigations,0);assert.equal(result.scroll,700);
      assert.equal(result.radius,'28px');assert.equal(result.searchRadius,'28px');assert.equal(result.customRadius,'3px');
      assert.equal(result.padding,'20px');assert.equal(result.gap,'24px');assert.equal(result.priceFont,'22px');
      assert.equal(result.titleAlign,'center');assert.equal(result.priceAlign,'center');assert(result.centered&&result.fullPriceWidth);
      page.off('framenavigated',onNavigate);
    }
    // This test supplies a stylesheet update explicitly. It does not emulate
    // Storelib's sidebar transport or assert that the hosted editor sends one.
  } finally { await browser.close(); }
});

async function renderHeaderLogo(overrides, sectionOverrides = {}) {
  const values=settings(overrides);
  const liquid=engine({settings:values});
  // Image URLs/tags are supplied by Storelib in production. Keep that adapter
  // limited to image markup; all logo Liquid, dimensions and CSS are real.
  liquid.registerFilter('image_url',image=>image.url);
  liquid.registerFilter('image_tag',(url,...attributes)=>{
    const attrs=Object.fromEntries(attributes);
    return `<img src="${url}" class="${attrs.class}" alt="Logo" style="${attrs.style||''}">`;
  });
  const html=await liquid.parseAndRender(require('./theme-test-runtime.cjs').body(source('blocks/_header-logo.storelib')),{
    shop:{name:'Store'},block:{settings:{}},section:{settings:sectionOverrides},template:{name:'index'},routes:{root_url:'/'},
  });
  return {html,variables:await render('snippets/theme-styles-variables.storelib',{settings:values})};
}

test('changing header position never stacks links or shifts the hero while a fresh shadow stylesheet loads', async () => {
  const browser=await openBrowser();
  try {
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    let stylesheetGate=Promise.resolve();
    await page.route('https://theme.test/overflow-list.css?*',async route=>{
      const gate=stylesheetGate;await gate;
      await route.fulfill({contentType:'text/css',body:source('shopify/assets/overflow-list.css')});
    });
    const css=file=>source(file).match(/{% stylesheet %}([\s\S]*?){% endstylesheet %}/)[1];
    const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"></svg>');
    const logo=await renderHeaderLogo({logo:{url:svg,aspect_ratio:4}});
    await page.setContent(`<style>${source('shopify/assets/base.css')}${css('sections/theme-header.storelib')}${css('blocks/_header-menu.storelib')}</style>${logo.variables}<style>header-actions{display:block;width:44px;height:44px;flex:none}overflow-list{display:block}</style><body class="page-width-narrow"><header-component class="header" id="header-component" data-menu-style="menu"><div class="header__row section section--page-width"><div id="columns" class="header__columns spacing-style"></div></div></header-component><main id="hero">Hero content below the header</main></body>`);
    const hydration=source('shopify/assets/component.js').match(/export class DeclarativeShadowElement extends HTMLElement {[\s\S]*?\n}/)[0];
    const notifier=source('shopify/assets/utilities.js').match(/export class ResizeNotifier extends ResizeObserver {[\s\S]*?\n}/)[0];
    await page.addScriptTag({type:'module',content:'window.Theme={utilities:{}};\n'+hydration+'\n'+notifier+'\n'+source('shopify/assets/overflow-list.js').replace(/^import .*;\n/gm,'')});
    let version=0;
    const liquid=engine();
    liquid.registerFilter('asset_url',file=>`https://theme.test/${file}?v=${version}`);
    liquid.registerFilter('stylesheet_tag',url=>`<link rel="stylesheet" href="${url}">`);
    const children=Array.from({length:6},(_,i)=>`<li style="flex:none;width:90px;height:44px"><a href="#${i}">Link ${i}</a></li>`).join('');
    let expectedHeroTop;
    for (const width of [1024,1440]) {
      await page.setViewportSize({width,height:900});
      expectedHeroTop=undefined;
      for (const position of ['left','center','right','left']) {
        version++;
        let releaseStyles;stylesheetGate=new Promise(resolve=>releaseStyles=resolve);
        const list=await liquid.parseAndRender("{% render 'overflow-list', children: children, class: 'overflow-menu' %}",{children});
        const menu=`<header-menu class="header-menu"><div class="header-menu__inner"><nav>${list}</nav></div></header-menu>`;
        const row=await liquid.parseAndRender("{% render 'header-row', row: 'top', order: 'logo,menu,actions', settings: positions, logo: logo, menu: menu, actions: actions %}",{
          positions:{logo_position:position,menu_position:'left'},logo:logo.html,menu,actions:'<header-actions></header-actions>',
        });
        const requested=page.waitForRequest(request=>request.url().includes(`overflow-list.css?v=${version}`));
        await page.locator('#columns').evaluate((el,html)=>el.innerHTML=html,row);
        await requested;
        const geometry=()=>page.evaluate(()=>({header:document.querySelector('#header-component').getBoundingClientRect().height,heroTop:document.querySelector('#hero').getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth}));
        const before=await geometry();
        assert(before.header<=100,`${position}: menu must be horizontal before its stylesheet arrives`);
        assert(!before.overflow);
        expectedHeroTop ??=before.heroTop;
        assert.equal(before.heroTop,expectedHeroTop,'position changes must not make the header grow');
        releaseStyles();
        await page.waitForFunction(()=>document.querySelector('overflow-list').style.getPropertyValue('--overflow-count')!=='');
        assert.deepEqual(await geometry(),before,'loading shadow CSS must not bump the header or hero');
      }
    }
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

test('editor view-transition script removes stale blockers without activating storefront transitions', async () => {
  const browser=await openBrowser();
  try {
    const page=await browser.newPage();
    await page.setContent('<html class="shopify-design-mode"><head><link id="view-transition-render-blocker" rel="expect" href="#content"></head><body><main id="content">Content</main></body></html>');
    await page.addScriptTag({content:source('shopify/assets/view-transitions.js')});
    assert.equal(await page.locator('#view-transition-render-blocker').count(),0);
    assert(await page.locator('head').evaluate(el=>el.textContent.includes('navigation: none')));
  } finally { await browser.close(); }
});

test('uploaded header logos reserve space before decoding and do not move links when sticky/hover variants swap', async () => {
  const browser=await openBrowser();
  try {
    const page=await browser.newPage();
    const headerCSS=source('sections/theme-header.storelib').match(/{% stylesheet %}([\s\S]*?){% endstylesheet %}/)[1];
    const menuCSS=source('blocks/_header-menu.storelib').match(/{% stylesheet %}([\s\S]*?){% endstylesheet %}/)[1];
    for (const width of [375,768,1024,1440]) for (const direction of ['ltr','rtl']) {
      await page.setViewportSize({width,height:900});
      let releaseImages;
      const pendingImages=new Promise(resolve=>releaseImages=resolve);
      await page.route('https://theme.test/*.svg',async route=>{
        await pendingImages;
        await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><rect width="800" height="200" fill="black"/></svg>'});
      });
      const logo=await renderHeaderLogo({logo:{url:'https://theme.test/normal.svg',aspect_ratio:4},logo_inverse:{url:'https://theme.test/alternate.svg',aspect_ratio:8}}, {enable_transparent_header_home:true,home_inverse_logo:true});
      await page.setContent(`<html dir="${direction}"><head><style>${source('shopify/assets/base.css')}${headerCSS}${menuCSS}</style>${logo.variables}<style>header-actions{display:block;width:44px;height:44px;flex:none}.header__drawer{width:44px;height:44px}.header-menu__inner{white-space:nowrap}</style></head><body class="page-width-narrow"><header-component class="header" id="header-component" transparent="not-sticky" data-menu-style="${width<1024?'drawer':'menu'}"><div class="header__row section section--page-width"><div class="header__columns spacing-style"><div class="header__column header__column--left"><div class="header__drawer header__icon--menu"></div>${logo.html}<header-menu class="header-menu"><nav class="header-menu__inner"><a class="menu-list__link" href="#">Shop</a> <a class="menu-list__link" href="#">About</a></nav></header-menu></div><div class="header__column header__column--right"><header-actions></header-actions></div></div></div></header-component></body></html>`,{waitUntil:'domcontentloaded'});
      const dimensions=()=>page.evaluate(()=>{
        const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
        return {logo:rect('.header-logo'),menu:rect('header-menu'),header:rect('#header-component'),overflow:document.documentElement.scrollWidth>innerWidth};
      });
      const initial=await dimensions();
      assert(initial.logo.width>0 && initial.logo.height>0,'reserve dimensions before the upload finishes loading');
      assert(!initial.overflow,`${width}px ${direction}: uploaded logo overflow`);
      releaseImages();
      await page.waitForFunction(()=>[...document.querySelectorAll('.header-logo img')].every(img=>img.complete));
      assert.deepEqual(await dimensions(),initial,'image decoding must not move navigation');
      for (const sticky of ['active','inactive','active']) {
        await page.locator('#header-component').evaluate((el,sticky)=>el.dataset.stickyState=sticky,sticky);
        assert.deepEqual(await dimensions(),initial,'switching logo variants must keep the header footprint');
        const visible=await page.locator('.header-logo > span').evaluateAll(nodes=>nodes.filter(node=>getComputedStyle(node).display!=='none').length);
        assert.equal(visible,1,'only one logo variant may be displayed');
      }
      if(width>=1024) {
        await page.locator('.menu-list__link').first().hover();
        assert.deepEqual(await dimensions(),initial,'hovering the menu must not expand the logo');
        assert.equal(await page.locator('[data-testid="header-logo-inverse"]').evaluate(el=>getComputedStyle(el).display),'none');
      }
      await page.unroute('https://theme.test/*.svg');
    }
  } finally { await browser.close(); }
});

test('replacing a logo repeatedly keeps real overflow navigation on one row and recovers links when space returns', async () => {
  const browser=await openBrowser();
  try {
    const page=await browser.newPage({viewport:{width:1024,height:900}});
    await page.route('https://theme.test/logo.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="100"><rect width="2000" height="100" fill="black"/></svg>'}));
    const css=file=>source(file).match(/{% stylesheet %}([\s\S]*?){% endstylesheet %}/)[1];
    const logo=await renderHeaderLogo({logo:{url:'https://theme.test/logo.svg',aspect_ratio:2}});
    const links=Array.from({length:6},(_,i)=>`<li style="flex:none;width:100px;height:44px;list-style:none"><a href="#${i}">Link ${i}</a></li>`).join('');
    // Use the real shadow list, ResizeNotifier and hydration base class. These
    // classes have no service dependency; no overflow behavior is stubbed here.
    const shadow=`<style>${source('shopify/assets/overflow-list.css')}</style><ul part="list"><slot></slot><slot name="more" part="more" hidden><li style="width:60px;height:44px">More</li></slot><li part="placeholder" hidden></li></ul><div part="overflow"><ul part="overflow-list"><slot name="overflow"></slot></ul></div>`;
    await page.setContent(`<style>${source('shopify/assets/base.css')}${css('sections/theme-header.storelib')}${css('blocks/_header-menu.storelib')}</style>${logo.variables}<style>header-actions{display:block;width:44px;height:44px;flex:none}overflow-list{display:block}</style><body class="page-width-narrow"><header-component class="header" id="header-component" data-menu-style="menu"><div class="header__row section section--page-width"><div class="header__columns spacing-style"><div class="header__column header__column--left">${logo.html}<header-menu class="header-menu"><div class="header-menu__inner"><nav><overflow-list class="overflow-menu"><template shadowrootmode="open">${shadow}</template>${links}</overflow-list></nav></div></header-menu></div><div class="header__column header__column--right"><header-actions></header-actions></div></div></div></header-component></body>`);
    const hydration=source('shopify/assets/component.js').match(/export class DeclarativeShadowElement extends HTMLElement {[\s\S]*?\n}/)[0];
    const notifier=source('shopify/assets/utilities.js').match(/export class ResizeNotifier extends ResizeObserver {[\s\S]*?\n}/)[0];
    await page.addScriptTag({type:'module',content:'window.Theme={utilities:{}};\n'+hydration+'\n'+notifier+'\n'+source('shopify/assets/overflow-list.js').replace(/^import .*;\n/gm,'')});
    await page.waitForFunction(()=>document.querySelector('overflow-list').style.getPropertyValue('--overflow-count')!=='');
    let narrowCount;
    for (const ratio of [20,1,20,1]) {
      const next=await renderHeaderLogo({logo:{url:'https://theme.test/logo.svg',width:ratio*100,height:100}});
      const oldWidth=await page.locator('header-menu').evaluate(el=>el.getBoundingClientRect().width);
      await page.locator('.header-logo').evaluate((el,html)=>el.outerHTML=html,next.html);
      await page.waitForFunction(oldWidth=>Math.abs(document.querySelector('header-menu').getBoundingClientRect().width-oldWidth)>1,oldWidth);
      // Allow the component's own RAF + resize observer to finish reflowing.
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,0)))));
      const result=await page.evaluate(()=>{
        const list=document.querySelector('overflow-list');
        const r=document.querySelector('.header-logo').getBoundingClientRect();
        const menu=document.querySelector('header-menu').getBoundingClientRect();
        const action=document.querySelector('header-actions').getBoundingClientRect();
        return {count:+list.style.getPropertyValue('--overflow-count'),height:list.shadowRoot.querySelector('[part="list"]').getBoundingClientRect().height,logoRight:r.right,menuLeft:menu.left,menuRight:menu.right,actionLeft:action.left,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      assert(!result.overflow);
      assert(result.logoRight<=result.menuLeft+1,'logo must not overlap links');
      assert(result.menuRight<=result.actionLeft+1,'menu must not overlap header actions');
      assert.equal(result.height,44,'links must remain on one row');
      if(ratio===20) { assert(result.count>0);narrowCount=result.count; }
      else assert(result.count<narrowCount,'links must return when a smaller logo restores space');
    }
  } finally { await browser.close(); }
});

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
      await page.addScriptTag({content:source('shopify/assets/theme-editor.js').replace("import { updateAllHeaderCustomProperties } from '@theme/utilities';",'const updateAllHeaderCustomProperties=()=>window.headerUpdates++;').replace("import { getScrollContainer } from '@theme/scroll-container';",'const getScrollContainer=()=>document.scrollingElement;')});
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

test('editor reloads keep the preview scroll position on the document and desktop page-wrapper scrollers', async () => {
  const browser=await openBrowser();
  try {
    const page=await browser.newPage();
    const origin='http://preview.test';
    // Late content mimics images and sections that finish after the editor script runs.
    const html=`<!doctype html><html class="shopify-design-mode"><head><style>${source('shopify/assets/base.css')}</style>
      <script>window.Shopify={designMode:true};</script>
      <script type="importmap">{"imports":{"@theme/utilities":"/utilities.js","@theme/scroll-container":"/scroll-container.js"}}</script>
      <script src="/theme-editor.js" type="module"></script></head>
      <body><div class="page-wrapper"><div style="height:1200px;flex:none"></div><div id="late" style="height:0;flex:none"></div><div style="height:400px;flex:none"></div></div>
      <script>setTimeout(()=>document.getElementById('late').style.height='2400px',300)</script></body></html>`;
    await page.route(origin+'/**',route=>{
      const path=new URL(route.request().url()).pathname;
      const js=body=>route.fulfill({contentType:'text/javascript',body});
      if (path==='/utilities.js') return js('export function updateAllHeaderCustomProperties(){}');
      if (path==='/scroll-container.js') return js(source('shopify/assets/scroll-container.js'));
      if (path==='/theme-editor.js') return js(source('shopify/assets/theme-editor.js'));
      return route.fulfill({contentType:'text/html',body:html});
    });
    const scroller=()=>innerWidth>=990?document.querySelector('.page-wrapper'):document.scrollingElement;
    for (const width of [375,1440]) {
      await page.setViewportSize({width,height:800});
      await page.goto(origin+'/products/example');
      await page.waitForTimeout(500);
      await page.evaluate(get=>new Function('return '+get)()().scrollTo({top:2600,behavior:'instant'}),scroller.toString());
      await page.waitForTimeout(100);
      for (const reload of [()=>page.reload(),()=>page.goto(origin+'/products/example')]) {
        await reload();
        await page.waitForTimeout(800);
        const top=await page.evaluate(get=>new Function('return '+get)()().scrollTop,scroller.toString());
        assert.equal(top,2600,`width ${width}`);
      }
      await page.goto(origin+'/collections/all');
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(get=>new Function('return '+get)()().scrollTop,scroller.toString()),0,'another page starts at the top');
    }
  } finally { await browser.close(); }
});
