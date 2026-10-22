const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const {source, render, settings} = require('./theme-test-runtime.cjs');

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
