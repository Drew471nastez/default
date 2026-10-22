const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const {root, source, body, schema, settings, color, engine, render} = require('./theme-test-runtime.cjs');

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
    assert(/color_scheme: (section\.settings|section_settings)\.theme_color_scheme|render 'section'|render 'product-information-content'/.test(body(raw)), file);
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

test('default scheme keeps custom colors; an unset section background emits no override', async () => {
  const inherited = await render('snippets/contrast-override.storelib', {color_scheme:'inherit', section_id:'test'});
  assert(!inherited.includes('<style>'));
  const custom = await render('snippets/contrast-override.storelib', {color_scheme:'inherit', background_color:color('#aabbcc'),text_color:color('#112233'),section_id:'test'});
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
