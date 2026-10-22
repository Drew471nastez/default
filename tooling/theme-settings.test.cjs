const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const {root, source, body, schema, settings, color, engine, render} = require('./theme-test-runtime.cjs');

function sectionSettings(file, overrides = {}) {
  const data = JSON.parse(source(file).match(/<schema>\s*([\s\S]*?)\s*<\/schema>/)[1]);
  return {...Object.fromEntries(((data.shopify || data).settings || []).filter(s => s.id && s.default !== undefined).map(s => [s.id, s.default])), ...overrides};
}

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
  assert(global.includes('--border-radius: 18px'));
  assert(global.includes('--product-card-gap: 22px'));
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
  assert(search.includes('--padding-block-start: 18px'));
  assert(search.includes('--border-radius: 12px'));
  assert(search.includes('--card-price-size: 19px'));
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
