const fs = require('node:fs');
const path = require('node:path');
const { Liquid } = require('liquidjs');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function body(raw) {
  return raw.slice(raw.indexOf('\n') + 1, raw.lastIndexOf('\n</template>'))
    .replace(/{%-?\s*doc\s*-?%}[\s\S]*?{%-?\s*enddoc\s*-?%}/g, '');
}
const schema = JSON.parse(source('shopify/config/settings_schema.json'));
const defaults = Object.fromEntries(schema.flatMap(group => group.settings || [])
  .filter(setting => setting.id && setting.default !== undefined)
  .map(setting => [setting.id, setting.default]));

function color(hex) {
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16));
  return {
    alpha: 1, rgb: channels.join(' '), rgba: [...channels, 1].join(' '),
    toString: () => hex,
  };
}
function settings(overrides = {}) {
  const values = {...defaults, ...JSON.parse(source('config/settings.json')).shopify, ...overrides};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) values[key] = color(value);
  }
  for (const role of ['body', 'subheading', 'heading', 'accent']) {
    const key = `type_${role}_font`;
    if (typeof values[key] === 'string') values[key] = {family: 'Arial', fallback_families: 'sans-serif', weight: 400, style: 'normal'};
  }
  return values;
}
function engine(globals = {}) {
  const read = file => body(fs.readFileSync(file, 'utf8'));
  const liquid = new Liquid({
    root: path.join(root, 'snippets'), extname: '.storelib', globals,
    fs: {
      exists: async file => fs.existsSync(file), existsSync: fs.existsSync,
      readFile: async file => read(file), readFileSync: read,
      resolve: (dir, file, ext) => path.resolve(dir, file.endsWith(ext) ? file : file + ext),
      dirname: path.dirname, sep: path.sep,
    },
  });
  for (const name of ['style', 'stylesheet', 'doc']) {
    liquid.registerTag(name, {
      parse(token, tokens) {
        this.templates = [];
        const stream = this.liquid.parser.parseStream(tokens)
          .on(`tag:end${name}`, () => stream.stop())
          .on('template', template => this.templates.push(template));
        stream.start();
      },
      *render(context, emitter) {
        if (name === 'doc') return;
        emitter.write('<style>');
        yield this.liquid.renderer.renderTemplates(this.templates, context, emitter);
        emitter.write('</style>');
      },
    });
  }
  liquid.registerFilter('color_brightness', value => value?.rgb?.split(' ').map(Number).reduce((a,b) => a+b,0)/3 || 0);
  liquid.registerFilter('color_contrast', () => 7);
  liquid.registerFilter('font_modify', (font, property, value) => font ? {...font, [property]: value === 'bold' ? 700 : value} : null);
  liquid.registerFilter('font_face', font => font ? `/* loaded ${font.family} ${font.weight} */` : '');
  liquid.registerFilter('standard_event_data', () => '{}');
  liquid.registerFilter('md5', value => require('node:crypto').createHash('md5').update(String(value)).digest('hex'));
  liquid.registerFilter('t', value => value);
  return liquid;
}
async function render(file, context = {}) {
  const values = {settings: settings(), ...context};
  // Shopify settings is a global object and survives isolated nested renders.
  return engine({settings: values.settings}).parseAndRender(body(source(file)), values);
}
module.exports = {root, source, body, schema, defaults, color, settings, engine, render};
