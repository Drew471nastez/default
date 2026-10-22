const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const {root, source, body, schema, settings, color, engine, render} = require('./theme-test-runtime.cjs');

test('settings use simple names, independent heading controls and Theme/Custom colors', () => {
  assert(schema.some(group => group.name === 'Fonts'));
  const buttons = schema.find(group => group.name === 'Buttons');
  assert(!schema.some(group => /hover.*focus/i.test(group.name)));
  assert(!schema.some(group => (group.settings||[]).some(setting => setting.type==='header' && /hover.*focus/i.test(setting.content))));
  for (const id of ['button_hover_duration','focus_ring_width']) {
    assert.equal(schema.flatMap(group=>group.settings||[]).filter(setting=>setting.id===id).length,1);
    assert(buttons.settings.findIndex(setting=>setting.id===id)<buttons.settings.findIndex(setting=>setting.type==='header'));
  }
  for (let heading=1; heading<=6; heading++) for (const control of ['font','size','weight','line_height','letter_spacing','case']) {
    assert(schema.find(group=>group.name==='Fonts').settings.some(setting=>setting.id===`type_${control}_h${heading}`));
  }
  for (const group of schema) for (const setting of group.settings || []) {
    if (setting.id?.endsWith('color_scheme') && !setting.visible_if) assert.deepEqual(setting.options.map(o=>o.value),['inherit','custom']);
  }
  const site=schema.find(group=>group.name==='Site colors');
  assert.deepEqual(site.settings.filter(s=>s.type==='color'&&!s.visible_if).map(s=>s.label),['Background','Text','Borders','Link hover','Field text']);
});

test('price contexts choose currency independently, including absent handles and related cards on product pages', async () => {
  const product={id:'p1',price_min:1200,price_max:1200,selected_or_first_available_variant:{price:1200}};
  for (const cards of [false,true]) for (const products of [false,true]) {
    const values=settings({currency_code_enabled_product_cards:cards,currency_code_enabled_product_pages:products});
    const liquid=engine({settings:values});
    // These filters intentionally expose which platform money filter was selected.
    liquid.registerFilter('money',value=>`MONEY:${value}`);
    liquid.registerFilter('money_with_currency',value=>`CURRENCY:${value}`);
    for (const [globals,expected] of [
      [{template:{name:'collection'},product_resource:product},cards],
      [{template:{name:'product'},product,product_resource:product},products],
      [{template:{name:'product'},product:{id:'other'},product_resource:product},cards],
      [{template:{name:'product'},product,product_resource:product,price_context:'card'},cards],
    ]) {
      const html=await liquid.parseAndRender(body(source('snippets/price.storelib')),globals);
      assert(html.includes(`${expected?'CURRENCY':'MONEY'}:1200`));
    }
  }
});

test('cart formatting preserves legacy product price callers, zero and per-item labels', async () => {
  const values=settings({currency_code_enabled_product_pages:true,currency_code_enabled_cart_total:true,currency_code_enabled_cart_items:false});
  const liquid=engine({settings:values});
  liquid.registerFilter('money',value=>`MONEY:${value}`);
  liquid.registerFilter('money_with_currency',value=>`CURRENCY:${value}`);
  const format=body(source('snippets/format-price.storelib'));
  assert.equal((await liquid.parseAndRender(format,{price:100,type:'per_item'})).trim(),'<bdi>CURRENCY:100</bdi>content.quantity_per_item');
  assert.equal((await liquid.parseAndRender(format,{value:0,context:'cart_total'})).trim(),'CURRENCY:0');
  assert.equal((await liquid.parseAndRender(format,{value:100,context:'cart_item'})).trim(),'MONEY:100');
});

test('custom card/account colors, border color, focus outline and hover speed reach real CSS', async () => {
  const values=settings({site_border_color:'#123456',focus_ring_width:3,button_hover_duration:0,product_card_color_scheme:'custom',product_card_background:'#abcdef',product_card_text:'#000000',account_color_scheme:'custom',account_background:'#fedcba',account_text:'#000000'});
  const global=await render('snippets/theme-styles-variables.storelib',{settings:values});
  assert(global.includes('--focus-outline-width: 3px'));
  assert(global.includes('--button-hover-duration: 0ms'));
  assert(global.includes('--color-background: #abcdef'));
  const account=await render('sections/customer-access.storelib',{settings:values,section:{id:'account-custom',settings:sectionSettings('sections/customer-access.storelib')},shop:{customer_accounts_enabled:false}});
  assert(account.includes('--color-background: #fedcba'));
  const palette=await render('snippets/color-palette.storelib',{settings:values});
  assert(palette.includes('--color-border: #123456'));
  assert(palette.includes('--palette-darkest-rgb: 0 0 0'));
  assert(!palette.includes('rgb()'));
});

test('preset weights load their font face and editor cards do not replay entry animation', async () => {
  const global=await render('snippets/theme-styles-variables.storelib',{settings:settings({type_weight_h1:'500',type_font_h1:'heading',type_heading_font:{family:'Fixture Heading',fallback_families:'sans-serif',weight:400,style:'normal'}})});
  assert(global.includes('loaded Fixture Heading 500'));
  assert.equal((global.match(/loaded Fixture Heading 500/g)||[]).length,1);
  const card=await render('snippets/resource-card.storelib',{request:{design_mode:true},resource_type:'product',resource:{id:'p1',title:'Example',url:'/products/example',selected_or_first_available_variant:{price:100}}});
  assert(card.includes('body .resource-card { opacity: 1; animation: none; }'));
});

function sectionSettings(file, overrides = {}) {
  const data = JSON.parse(source(file).match(/<schema>\s*([\s\S]*?)\s*<\/schema>/)[1]);
  return {...Object.fromEntries(((data.shopify || data).settings || []).filter(s => s.id && s.default !== undefined).map(s => [s.id, s.default])), ...overrides};
}

test('block libraries use explicit supported types and preserve configured and preset children', () => {
  const schemas=new Map();
  for (const folder of ['sections','blocks']) for (const file of fs.readdirSync(path.join(root,folder)).filter(f=>f.endsWith('.storelib'))) {
    const parsed=JSON.parse(source(`${folder}/${file}`).match(/<schema>([\s\S]*?)<\/schema>/)[1]);
    const doc=parsed.shopify||parsed;schemas.set(`${folder}/${file}`,doc);
    assert(!(doc.blocks||[]).some(block=>block.type==='@theme'),`${folder}/${file}: unrestricted theme library`);
    for (const child of doc.blocks||[]) {
      if(child.type.startsWith('@')||child.settings)continue;
      assert(fs.existsSync(path.join(root,'blocks',child.type+'.storelib')),`${file}: unknown supported block ${child.type}`);
    }
  }
  function validate(owner,node) {
    const doc=schemas.get(owner);if(!doc)return;
    const allowed=new Set((doc.blocks||[]).map(block=>block.type));
    for (const child of Object.values(node.blocks||{})) {
      if(!child.type)continue;
      if(!child.static)assert(allowed.has(child.type),`${owner}: existing ${child.type} is no longer supported`);
      validate(`blocks/${child.type}.storelib`,child);
    }
  }
  for (const [file,doc] of schemas) for (const preset of doc.presets||[])validate(file,preset);
  for (const folder of ['templates','sections']) for (const file of fs.readdirSync(path.join(root,folder)).filter(f=>f.endsWith('.json'))) {
    for (const section of Object.values(JSON.parse(source(`${folder}/${file}`)).sections||{})) validate(`sections/${section.type}.storelib`,section);
  }
  const hero=schemas.get('sections/hero.storelib').blocks.map(block=>block.type);
  assert(hero.includes('text')&&hero.includes('button')&&!hero.includes('buy-buttons'));
  assert.equal(schemas.get('sections/predictive-search.storelib').blocks.length,0);
});

test('site colors cannot expand the retired Color 1/Color 2 widget and retain saved palette data', () => {
  const colors=schema.find(group=>group.name==='Site colors');
  assert(!colors.settings.some(setting=>setting.type==='color_palette'));
  assert.equal(colors.settings.find(setting=>setting.id==='color_palette').type,'paragraph');
  const saved=JSON.parse(source('config/settings.json')).shopify.color_palette;
  assert(saved && saved.background && saved.foreground,'legacy values must not be discarded');
});

test('editor renders no page-transition opt-in or first-paint blocker; storefront settings still work', async () => {
  const values=settings({page_transition_enabled:true,transition_to_main_product:true});
  const editor=await render('snippets/view-transition-opt-in.storelib',{settings:values,request:{design_mode:true}});
  assert(!editor.includes('navigation: auto'));
  assert(!editor.includes('rel="expect"'));
  const storefront=await render('snippets/view-transition-opt-in.storelib',{settings:values,request:{design_mode:false}});
  assert(storefront.includes('navigation: auto')&&storefront.includes('rel="expect"'));
  const disabled=await render('snippets/view-transition-opt-in.storelib',{settings:settings({page_transition_enabled:false,transition_to_main_product:false}),request:{design_mode:false}});
  assert(!disabled.includes('rel="expect"'));
});

function validateSettings(list, location) {
  const ids = new Set();
  for (const setting of list || []) {
    if (setting.id) {
      assert(!ids.has(setting.id), `${location}: duplicate ${setting.id}`);
      ids.add(setting.id);
    }
    if (setting.type === 'select' && setting.default !== undefined) {
      assert(setting.options.some(option => option.value === setting.default), `${location}: invalid default ${setting.id}`);
    }
    if (setting.type === 'range') {
      assert(setting.default >= setting.min && setting.default <= setting.max, `${location}: invalid range ${setting.id}`);
      const step = setting.step ?? 1;
      assert(Math.abs((setting.default-setting.min)/step - Math.round((setting.default-setting.min)/step)) < 1e-6, `${location}: invalid step ${setting.id}`);
    }
  }
}
function css(output) {
  return [...output.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
}

test('all section/block schemas and global controls have unique IDs and valid defaults', () => {
  const globalIds = new Set();
  for (const group of schema) {
    validateSettings(group.settings, group.name);
    for (const setting of group.settings || []) if (setting.id) {
      assert(!globalIds.has(setting.id), `duplicate global setting ${setting.id}`);
      globalIds.add(setting.id);
    }
  }
  for (const folder of ['sections', 'blocks']) for (const file of fs.readdirSync(path.join(root, folder))) {
    if (!file.endsWith('.storelib')) continue;
    const match = source(`${folder}/${file}`).match(/<schema>\s*([\s\S]*?)\s*<\/schema>/);
    assert(match, `${file} needs a schema`);
    const data = JSON.parse(match[1]);
    validateSettings((data.shopify || data).settings, file);
  }
});

test('every page and section group references existing sections in a valid order', () => {
  const files = fs.readdirSync(path.join(root,'templates')).map(f => `templates/${f}`)
    .concat(['sections/header-group.json','sections/footer-group.json']);
  for (const file of files) {
    const page = JSON.parse(source(file));
    for (const id of page.order || []) assert(page.sections[id], `${file}: missing section ${id}`);
    for (const section of Object.values(page.sections || {})) {
      assert(fs.existsSync(path.join(root, 'sections', section.type + '.storelib')), `${file}: missing type ${section.type}`);
    }
  }
});

test('section scheme controls reach a renderer and retain the default/custom choice', () => {
  let count = 0;
  for (const file of fs.readdirSync(path.join(root,'sections'))) {
    if (!file.endsWith('.storelib')) continue;
    const raw = source(`sections/${file}`);
    const data = JSON.parse(raw.match(/<schema>\s*([\s\S]*?)\s*<\/schema>/)[1]);
    const controls = (data.shopify || data).settings || [];
    if (!controls.some(s => s.id === 'theme_color_scheme')) continue;
    count++;
    assert(controls.find(s => s.id === 'theme_color_scheme').default === 'inherit');
    assert(/color_scheme: (section\.settings|section_settings)\.theme_color_scheme|render 'section'|render 'product-information-content'|color_scheme: account_scheme/.test(body(raw)), file);
  }
  assert(count >= 30, `expected broad coverage, found ${count}`);
});

for (const name of ['surface', 'inverse', 'accent']) test(`${name} scheme renders background, text, buttons and form tokens together`, async () => {
  const values = settings();
  const out = await render('snippets/contrast-override.storelib', {color_scheme:name, section_id:'test', settings: values});
  const styles = css(out);
  postcss.parse(styles);
  assert(styles.includes(`--color-background: ${values[`scheme_${name}_background`]}`));
  assert(styles.includes(`--color-foreground: ${values[`scheme_${name}_text`]}`));
  assert(styles.includes(`--color-primary-button-text: ${values[`scheme_${name}_background`]}`));
  assert(styles.includes(`--color-input-text: ${values[`scheme_${name}_text`]}`));
});

test('inherited block colors emit no override; Custom keeps explicit colors', async () => {
  const inherited = await render('snippets/contrast-override.storelib', {color_scheme:'inherit', section_id:'test'});
  assert(!inherited.includes('<style>'));
  const custom = await render('snippets/contrast-override.storelib', {color_scheme:'custom', background_color:color('#aabbcc'),text_color:color('#112233'),section_id:'test'});
  assert(custom.includes('--color-background: #aabbcc'));
  assert(custom.includes('--color-foreground: #112233'));
});

test('a shared scheme overrides old local colors and media skip-contrast without blank CSS', async () => {
  const out = await render('snippets/contrast-override.storelib', {color_scheme:'inverse',background_color:color('#abcdef'),text_color:color('#123456'),skip_contrast:true,section_id:'test'});
  assert(out.includes('--color-background: #171717'));
  assert(out.includes('--color-foreground: #ffffff'));
  assert(!out.includes('#abcdef'));
});

test('paragraph inherits the actual body-font weight and each heading supports an override', async () => {
  const values = settings({type_body_font:{family:'Arial',fallback_families:'sans-serif',weight:600,style:'normal'},type_weight_h2:'700'});
  const out = await render('snippets/theme-styles-variables.storelib', {settings: values});
  assert(out.includes('--font-body--weight: 600'));
  assert(out.includes('--font-paragraph--weight: var(--font-body--weight)'));
  assert(out.includes('--font-h2--weight: 700'));
  assert(out.includes('loaded Arial 700'));
});

test('shared product cards read global appearance; Custom preserves the block values', async () => {
  const context = {settings:settings({product_card_radius:18,product_card_gap:22}),block:{id:'card-one',settings:{card_style_source:'theme',border_radius:3,product_card_gap:9}},product:{id:'p1',title:'Example',url:'/products/example',available:true},children:'<p>Product content</p>'};
  const global = await render('snippets/product-card.storelib',context);
  assert(global.includes('product-card--theme'));
  assert(global.includes('--border-radius: var(--theme-product-card-radius, 0px)'));
  assert(global.includes('--product-card-gap: var(--theme-product-card-gap, 16px)'));
  const shared=await render('snippets/theme-styles-variables.storelib',{settings:context.settings});
  assert(shared.includes('--theme-product-card-radius: 18px'));
  assert(shared.includes('--theme-product-card-gap: 22px'));
  assert(global.includes('Product content'));
  const local = await render('snippets/product-card.storelib',{...context,block:{...context.block,settings:{...context.block.settings,card_style_source:'custom'}}});
  assert(!/class="[^"]*product-card--theme/.test(local));
  assert(local.includes('--border-radius: 3px'));
  assert(!local.includes('--border-radius: 18px'));
});

test('global image ratio and fit have an explicit local opt-out', async () => {
  const raw = body(source('snippets/card-gallery.storelib'));
  const setup = raw.slice(raw.indexOf('{% liquid'), raw.indexOf('<div\n  ref="cardGallery"'));
  const template = setup + '{{ ratio }}|{{ media_fit }}';
  const context = {settings:settings({product_card_image_ratio:'square',product_card_image_fit:'contain'}),block:{settings:{image_ratio:'portrait'}},section:{settings:{}},closest:{product:null}};
  assert((await engine().parseAndRender(template,context)).trim().endsWith('1|contain'));
  context.block.settings.use_theme_image_style = false;
  assert((await engine().parseAndRender(template,context)).trim().endsWith('4 / 5|cover'));
});

test('cookie appearance is opt-out, width/radius are connected, and consent behavior is untouched', async () => {
  const enabled = await render('snippets/cookie-banner-styles.storelib',{settings:settings({cookie_banner_width:600,cookie_banner_radius:16})});
  assert(enabled.includes('600px'));
  assert(enabled.includes('border-radius: 16px'));
  assert(enabled.includes('min-height: 44px'));
  assert(!enabled.includes('<script'));
  postcss.parse(css(enabled));
  const disabled = await render('snippets/cookie-banner-styles.storelib',{settings:settings({cookie_banner_theme_style:false})});
  assert(!disabled.includes('<style>'));
});

test('mobile quick add can be enabled independently and stays off for sold-out products', async () => {
  const context = {settings:settings({quick_add:false,mobile_quick_add:true}),block:{id:'mobile-card',settings:{}},product:{id:'p1',available:true}};
  const available = await render('snippets/product-card.storelib',context);
  assert(available.includes('--quick-add-display: none'));
  assert(available.includes('--quick-add-mobile-display: flex'));
  const soldOut = await render('snippets/product-card.storelib',{...context,product:{id:'p1',available:false}});
  assert(soldOut.includes('--quick-add-mobile-display: none'));
});

test('policy pages retain their content while using shared typography and scheme controls', async () => {
  for (const file of ['privacy-policy','refund-policy','terms-of-service']) {
    const page = JSON.parse(source(`templates/${file}.json`));
    const section = Object.values(page.sections)[0];
    const out = await render('sections/rich_text.storelib',{section:{id:file,settings:{heading_size:'h2',...section.settings}}});
    assert(out.includes(section.settings.body));
    assert(out.includes(`<h1 class="h2">${section.settings.heading}</h1>`));
  }
});

test('all directly referenced section and block controls are actually declared', () => {
  for (const folder of ['sections','blocks']) for (const file of fs.readdirSync(path.join(root,folder))) {
    if (!file.endsWith('.storelib')) continue;
    const raw=source(`${folder}/${file}`);
    const data=JSON.parse(raw.match(/<schema>\s*([\s\S]*?)\s*<\/schema>/)[1]);
    const ids=new Set(((data.shopify || data).settings || []).map(s => s.id));
    const object=folder==='sections'?'section':'block';
    const references=[...body(raw).matchAll(new RegExp('(?<![\\w.])'+object+'\\.settings\\.([\\w-]+)','g'))].map(m => m[1]);
    for (const id of references) assert(ids.has(id),`${file}: undeclared ${id}`);
  }
});

test('a real section follows the theme default and can opt into Custom colors', async () => {
  const file='sections/custom-liquid.storelib';
  const values=settings({default_section_color_scheme:'inverse'});
  const out=await render(file,{settings:values,section:{id:'custom-section',settings:sectionSettings(file,{theme_color_scheme:'inherit',custom_liquid:'<p>Section content</p>'})}});
  assert(out.includes('--color-background: #171717'));
  assert(out.includes('Section content'));
  const custom=await render(file,{settings:values,section:{id:'custom-section',settings:sectionSettings(file,{theme_color_scheme:'custom',background_color:color('#ddeeff'),text_color:color('#112233')})}});
  assert(custom.includes('--color-background: #ddeeff'));
  assert(custom.includes('--color-foreground: #112233'));
});

test('nested groups follow the parent or resolve their own shared/custom scheme', async () => {
  const values=settings();
  const context={block:{id:'group',settings:{theme_color_scheme:'inherit',background_color:color('#ddeeff')}},children:'<p>Nested content</p>'};
  const template="{% render 'group', settings: block.settings, block_id: block.id, children: children %}";
  const inherited=await engine({settings:values}).parseAndRender(template,context);
  assert(inherited.includes('color-custom-group'));
  assert(!inherited.includes('--color-background:'));
  context.block.settings.theme_color_scheme='inverse';
  const fixed=await engine({settings:values}).parseAndRender(template,context);
  assert(fixed.includes('--color-background: #171717'));
  assert(fixed.includes('Nested content'));
  context.block.settings.theme_color_scheme='custom';
  const custom=await engine({settings:values}).parseAndRender(template,context);
  assert(custom.includes('--color-background: #ddeeff'));
});

test('low-contrast text is repaired on page and section surfaces, with an explicit opt-out', async () => {
  const values=settings({page_background_color:'#ffffff',page_text_color:'#ffffff',ensure_text_contrast:true});
  const page=await render('snippets/color-palette.storelib',{settings:values});
  assert(page.includes('--color-foreground: #000000'));
  const section=await render('snippets/contrast-override.storelib',{settings:values,color_scheme:'base',section_id:'contrast'});
  assert(section.includes('--color-foreground: #000000'));
  const exact=await render('snippets/contrast-override.storelib',{settings:settings({page_background_color:'#ffffff',page_text_color:'#ffffff',ensure_text_contrast:false}),color_scheme:'base',section_id:'contrast'});
  assert(exact.includes('--color-foreground: #ffffff'));
});

test('spacing accepts editor underscore keys, preserves zero, and supports Shopify hyphen keys', async () => {
  const underscored=await render('snippets/spacing-style.storelib',{settings:{padding_block_start:0,padding_block_end:16}});
  assert(underscored.includes('--padding-block-start: 0px'));
  assert(underscored.includes('--padding-block-end: 16px'));
  const hyphenated=await render('snippets/spacing-padding.storelib',{settings:{'padding-block-start':12,padding_block_start:40}});
  assert(hyphenated.includes('--padding-block-start: 12px'));
});

test('responsive heading sizes use the adjacent smaller preset when deriving their minimum', async () => {
  const values=settings({type_size_h1:'56',type_size_h2:'48',type_size_h3:'32',type_size_h4:'24',type_size_h5:'18',type_size_h6:'16',type_size_paragraph:'14'});
  const out=await render('snippets/theme-styles-variables.storelib',{settings:values});
  assert(out.includes('--font-size--h1: clamp(3rem, 5.6vw, 3.5rem)'));
  assert(out.includes('--font-size--h2: clamp(2.25rem, 4.8vw, 3rem)'));
});

test('search product cards use the same appearance variables as grid product cards', async () => {
  const values=settings({product_card_padding:18,product_card_radius:12,product_card_price_size:19});
  const resource={id:'p1',title:'Search product',url:'/products/example',available:true,price:1000,selected_or_first_available_variant:{price:1000}};
  const search=await render('snippets/resource-card.storelib',{settings:values,resource_type:'product',resource});
  assert(search.includes('resource-card--theme'));
  assert(search.includes('--padding-block-start: var(--theme-product-card-padding, 0px)'));
  assert(search.includes('--border-radius: var(--theme-product-card-radius, 0px)'));
  assert(search.includes('--card-price-size: var(--theme-product-card-price-size, 14px)'));
  const shared=await render('snippets/theme-styles-variables.storelib',{settings:values});
  assert(shared.includes('--theme-product-card-padding: 18px'));
  assert(shared.includes('--theme-product-card-radius: 12px'));
  assert(shared.includes('--theme-product-card-price-size: 19px'));
  const collection=await render('snippets/resource-card.storelib',{settings:values,resource_type:'collection',resource});
  assert(!/class="[^"]*resource-card--theme/.test(collection));
});

for (const mode of ['login','signup','account']) test(`${mode} account screen uses the built-in account service and correct cross-navigation`, async () => {
  const file='sections/customer-access.storelib';
  const out=await render(file,{shop:{customer_accounts_enabled:true},routes:{account_url:'/account'},customer:null,section:{id:mode,settings:sectionSettings(file,{mode})}});
  assert(out.includes('href="/account"'));
  assert(out.includes(mode==='signup'?'href="/login"':'href="/signup"'));
  assert(!out.includes('type="password"'));
  assert(!out.includes('<form'));
});

test('signed-in accounts render escaped server-provided profile details and a management handoff', async () => {
  const file='sections/customer-access.storelib';
  const out=await render(file,{shop:{customer_accounts_enabled:true},routes:{account_url:'/account'},customer:{name:'<script>bad</script>',email:'customer@example.test'},section:{id:'profile',settings:sectionSettings(file,{mode:'account'})}});
  assert(out.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert(out.includes('customer@example.test'));
  assert(out.includes('Manage your account'));
  assert(!out.includes('New here?'));
});

test('disabled customer accounts do not show a broken authentication action', async () => {
  const file='sections/customer-access.storelib';
  const out=await render(file,{shop:{customer_accounts_enabled:false},routes:{account_url:'/account'},section:{id:'disabled',settings:sectionSettings(file)}});
  assert(out.includes('Customer accounts are unavailable'));
  assert(!out.includes('href="/account"'));
});

test('every global control has an explicit consumer or a verified dynamic token family', () => {
  const files = ['sections','blocks','snippets','layout','shopify/assets'].flatMap(folder => fs.readdirSync(path.join(root,folder)).filter(file => /\.(storelib|css|js)$/.test(file)).map(file => `${folder}/${file}`));
  const code=files.map(file => source(file).split('<schema>')[0]).join('\n');
  for (const group of schema) for (const control of group.settings || []) {
    if (!control.id) continue;
    const dynamicType=/^type_(size|font|case|line_height|letter_spacing|weight)_(paragraph|h[1-6])$/.test(control.id);
    const dynamicScheme=/^scheme_(surface|inverse|accent)_(background|text)$/.test(control.id);
    // Hidden so Form fields keeps one Corner radius; declared only to move it out of Storelib's panel.
    if (control.id==='storelib_input_radius' && control.visible_if==='{{ false }}') continue;
    assert(code.includes(`settings.${control.id}`) || code.includes(`settings['${control.id}']`) || dynamicType || dynamicScheme,`Disconnected global control: ${control.id}`);
  }
});

test('header accounts follow the configured login/dashboard pages and visibility setting', async () => {
  const context={settings:settings(),shop:{customer_accounts_enabled:true},routes:{account_url:'/account',cart_url:'/cart'},cart:{item_count:0},section:{settings:{}},display_style:'icon'};
  const guest=await render('snippets/header-actions.storelib',context);
  assert(guest.includes('href="/login"'));
  const member=await render('snippets/header-actions.storelib',{...context,customer:{id:'member'}});
  assert(member.includes('href="/customer-account"'));
  const hidden=await render('snippets/header-actions.storelib',{...context,settings:settings({account_show_header:false})});
  assert(!hidden.includes('class="storelib-account-link"'));
});

test('header underlay backgrounds resolve the same default and explicit schemes as sections', async () => {
  const values=settings({default_section_color_scheme:'inverse'});
  const inherited=await render('snippets/scheme-background.storelib',{settings:values,color_scheme:'inherit',use_theme_default:true,custom_background:color('#abcdef')});
  assert.equal(inherited.trim(),'#171717');
  const custom=await render('snippets/scheme-background.storelib',{settings:values,color_scheme:'custom',use_theme_default:true,custom_background:color('#abcdef')});
  assert.equal(custom.trim(),'#abcdef');
});

test('product descriptions use the selected parent product outside preview mode', async () => {
  const out=await render('blocks/product-description.storelib',{closest:{product:{description:'<p>Product details from the selected product.</p>'}},block:{id:'description',settings:{type_preset:'rte'}}});
  assert(out.includes('Product details from the selected product.'));
});

test('all theme documents parse with the Shopify compatibility adapter', () => {
  const parser=engine();
  let count=0;
  for (const folder of ['sections','blocks','snippets','layout']) for (const file of fs.readdirSync(path.join(root,folder))) {
    if (!file.endsWith('.storelib')) continue;
    assert.doesNotThrow(() => parser.parse(body(source(`${folder}/${file}`))),`${folder}/${file}`);
    count++;
  }
  assert(count>=280);
});

test('explicit media-section text controls take effect even when automatic media contrast is skipped', async () => {
  const out=await render('snippets/contrast-override.storelib',{color_scheme:'custom',background_color:color('#000000'),text_color:color('#ffffff'),skip_contrast:true,section_id:'hero'});
  assert(out.includes('--color-foreground: #ffffff'));
});

test('hover color lives in Buttons and Automatic, Custom and No change reach both buttons and shared schemes', async () => {
  const buttons=schema.find(group=>group.name==='Buttons').settings;
  const ids=buttons.map(setting=>setting.id);
  const firstHeader=buttons.findIndex(setting=>setting.type==='header');
  for (const id of ['storelib_button_hover_effect','storelib_button_hover_bg','storelib_button_hover_text']) {
    assert.equal(schema.flatMap(group=>group.settings||[]).filter(setting=>setting.id===id).length,1,id);
    assert(ids.indexOf(id)>=0&&ids.indexOf(id)<firstHeader,id);
  }
  assert.deepEqual(buttons.find(setting=>setting.id==='storelib_button_hover_effect').options.map(option=>option.value),['theme','custom','none']);
  assert(['theme','custom','none'].includes(JSON.parse(source('config/settings.json')).shopify.storelib_button_hover_effect),'saved value stays valid');

  const hover=(css,kind)=>Object.fromEntries(['background','text','border'].map(part=>[part,css.match(new RegExp(`--color-${kind}-button-hover-${part}:\\s*([^;]+);`))[1].trim()]));
  const base={palette_primary_button_background:'#3e3e3e',palette_primary_button_text:'#ffffff',palette_primary_button_border:'#3e3e3e',
    palette_secondary_button_background:'#ffffff',palette_secondary_button_text:'#171717',palette_secondary_button_border:'#171717',
    storelib_button_hover_bg:'#9b95c1',storelib_button_hover_text:'#fdfdfd'};
  const automatic=await render('snippets/color-palette.storelib',{settings:settings({...base,storelib_button_hover_effect:'theme'})});
  assert.notEqual(hover(automatic,'primary').background.toLowerCase(),'#9b95c1');
  const custom=await render('snippets/color-palette.storelib',{settings:settings({...base,storelib_button_hover_effect:'custom'})});
  for (const kind of ['primary','secondary']) assert.deepEqual(hover(custom,kind),{background:'#9b95c1',text:`rgb(${color('#fdfdfd').rgba})`,border:'#9b95c1'},kind);
  const none=await render('snippets/color-palette.storelib',{settings:settings({...base,storelib_button_hover_effect:'none'})});
  assert.deepEqual(hover(none,'primary'),{background:`rgb(${color('#3e3e3e').rgba})`,text:`rgb(${color('#ffffff').rgba})`,border:`rgb(${color('#3e3e3e').rgba})`});
  assert.deepEqual(hover(none,'secondary'),{background:`rgb(${color('#ffffff').rgba})`,text:`rgb(${color('#171717').rgba})`,border:`rgb(${color('#171717').rgba})`});

  const scheme=async effect=>render('snippets/contrast-override.storelib',{settings:settings({...base,storelib_button_hover_effect:effect}),color_scheme:'inverse',section_id:'s'});
  const inverseCustom=await scheme('custom');
  assert.equal(hover(inverseCustom,'primary').background,'#9b95c1');
  assert.equal(hover(inverseCustom,'secondary').text,'#fdfdfd');
  const inverseNone=await scheme('none');
  const button=kind=>inverseNone.match(new RegExp(`--color-${kind}-button-background:\\s*([^;]+);`))[1].trim();
  for (const kind of ['primary','secondary']) assert.equal(hover(inverseNone,kind).background,button(kind),kind);
});

test('store, 404 and password sections offer only blocks that belong in them', () => {
  const offered=name=>JSON.parse(source(`sections/${name}.storelib`).match(/<schema>\s*([\s\S]*?)\s*<\/schema>/)[1]).shopify.blocks.map(block=>block.type);
  for (const name of ['product-list','product-information','featured-product-information','main-404','password']) {
    const types=offered(name);
    for (const unrelated of ['@theme','contact-form','video']) assert(!types.includes(unrelated),`${name} offers ${unrelated}`);
    if (name!=='password') assert(!types.includes('email-signup'),`${name} offers email-signup`);
  }
  assert(offered('password').includes('email-signup'));
});

test('every Storelib platform setting is declared in a theme group and reaches CSS', async () => {
  const platform=JSON.parse(source('config/storelib_settings_schema.json')).panels.flatMap(panel=>panel.settings).filter(setting=>setting.type!=='header');
  const placed=Object.fromEntries(schema.flatMap(group=>(group.settings||[]).map(setting=>[setting.id,group.name])));
  const expected={storelib_button_hover_bg:'Buttons',storelib_button_hover_text:'Buttons',storelib_button_hover_border:'Buttons',storelib_button_hover_effect:'Buttons',
    storelib_link_hover:'Site colors',storelib_input_border:'Form fields',storelib_input_focus:'Form fields',storelib_input_radius:'Form fields'};
  for (const setting of platform) assert.equal(placed[setting.id],expected[setting.id],setting.id);
  const saved=JSON.parse(source('config/settings.json')).shopify;
  for (const setting of platform) assert(setting.id in saved,`${setting.id} keeps its value`);

  const css=await render('snippets/theme-styles-variables.storelib',{settings:settings({storelib_link_hover:'#aa0000',storelib_input_border:'#00aa00',storelib_input_focus:'#0000aa'})});
  assert.match(css,/--link-hover-color:\s*#aa0000/);
  assert.match(css,/\.field__input:hover\s*{\s*box-shadow:[^}]*#00aa00/);
  assert.match(css,/input:not\(\[type='checkbox'\], \[type='radio'\]\):is\(:hover, :focus\)\s*{\s*border-color:\s*#00aa00/);
  assert.match(css,/\.field__input:focus-visible\s*{\s*outline:[^}]*#0000aa/);
  const plain=await render('snippets/theme-styles-variables.storelib',{settings:settings({storelib_link_hover:'',storelib_input_border:'',storelib_input_focus:''})});
  assert.doesNotMatch(plain,/--link-hover-color|\.field__input:hover/);
  assert.match(source('shopify/assets/base.css'),/a:hover {\n  color: var\(--link-hover-color, /);

  const palette=await render('snippets/color-palette.storelib',{settings:settings({storelib_button_hover_effect:'custom',storelib_button_hover_bg:'#9b95c1',storelib_button_hover_text:'#fdfdfd',storelib_button_hover_border:'#111111'})});
  assert.match(palette,/--color-primary-button-hover-border:\s*#111111/);
  assert.match(palette,/--color-secondary-button-hover-border:\s*#111111/);
  const fallback=await render('snippets/color-palette.storelib',{settings:settings({storelib_button_hover_effect:'custom',storelib_button_hover_bg:'#9b95c1',storelib_button_hover_text:'#fdfdfd',storelib_button_hover_border:''})});
  assert.match(fallback,/--color-primary-button-hover-border:\s*#9b95c1/);
});
