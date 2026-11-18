'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { buildSync } = require('esbuild');

// Build in memory so this suite can run alongside distribution-build tests without
// competing for generated output. Exercise the actual browser entry point.
const bundle = buildSync({ entryPoints: [path.join(__dirname, '../../src/client/features/adventure-notes/markdown-entry.js')],
  bundle: true, write: false, platform: 'browser', target: ['safari16', 'chrome100'], format: 'iife' }).outputFiles[0].text;
function renderer() {
  const dom = new JSDOM('<!doctype html><main></main>', { url: 'https://campaign.example/', runScripts: 'outside-only' });
  dom.window.eval(bundle);
  const mount = dom.window.document.querySelector('main');
  return { dom, render(source) { mount.innerHTML = dom.window.CampaignMarkdown.render(source); return mount; } };
}

test('Markdown renders Chinese documentation, hierarchy, lists, quotes, and code', () => {
  const h = renderer();
  const root = h.render('# 楚尔特指南\n\n## 准备\n\n**食物**、*水*与~~旧地图~~。\n\n> 每天检查补给。\n\n- 火把\n- 绳索\n\n3. 休息\n4. 出发\n\n`<danger>`\n\n```js\nconst n = "<script>";\n```');
  assert.equal(root.querySelector('h1').textContent, '楚尔特指南');
  assert.equal(root.querySelector('h2').textContent, '准备');
  assert.equal(root.querySelector('strong').textContent, '食物');
  assert.equal(root.querySelector('em').textContent, '水');
  assert.equal(root.querySelector('del').textContent, '旧地图');
  assert.equal(root.querySelectorAll('ul li').length, 2);
  assert.equal(root.querySelector('ol').getAttribute('start'), '3');
  assert.match(root.querySelector('blockquote').textContent, /补给/);
  assert.match(root.querySelector('pre code').textContent, /<script>/);
  assert.equal(root.querySelector('script'), null);
  h.dom.window.close();
});

test('GFM tables and task lists render without interactive form fields', () => {
  const h = renderer();
  const root = h.render('| 物品 | 数量 |\n| :--- | ---: |\n| 绳索 | 2 |\n\n- [x] 准备食物\n- [ ] 检查船只');
  assert.equal(root.querySelectorAll('th').length, 2);
  assert.equal(root.querySelectorAll('td').length, 2);
  assert.equal(root.querySelector('td[align="right"]').textContent, '2');
  assert.match(root.textContent, /\[x\] 准备食物/);
  assert.match(root.textContent, /\[ \] 检查船只/);
  assert.equal(root.querySelector('input'), null);
  h.dom.window.close();
});

test('only absolute web and mail links survive with isolated opener access', () => {
  const h = renderer();
  const root = h.render('[guide](https://example.org/guide "Guide") [email](mailto:guide@example.org) [http](http://example.org) [relative](/api/auth) [network](//example.org) [file](file:///secret)');
  const links = [...root.querySelectorAll('a')];
  assert.equal(links.length, 3);
  for (const link of links) {
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
  }
  assert.equal(links[0].title, 'Guide');
  assert.match(root.textContent, /relative.*network.*file/);
  h.dom.window.close();
});

test('Markdown image syntax is a descriptive link and never fetches remote images', () => {
  const h = renderer();
  const root = h.render('![港口地图](https://example.org/map.png) ![unsafe](data:image/svg+xml;base64,PHN2Zz4=)');
  assert.equal(root.querySelector('img'), null);
  assert.equal(root.querySelectorAll('a').length, 1);
  assert.equal(root.querySelector('a').textContent, '港口地图');
  assert.match(root.textContent, /unsafe/);
  h.dom.window.close();
});

test('raw HTML, SVG, clobbering names, event handlers, and styles stay inert text', () => {
  const h = renderer();
  const payload = '<script>window.pwned=1</script>\n<svg><a href="javascript:alert(1)">click</a></svg>\n<img src=x onerror="alert(1)">\n<form id="CampaignMarkdown" name="location"><input name="href"></form>\n<style>body{display:none}</style>\n<iframe srcdoc="evil"></iframe>';
  const root = h.render(payload);
  assert.equal(root.querySelector('script,svg,img,form,input,style,iframe'), null);
  assert.equal(root.querySelector('[id],[name],[style],[onerror]'), null);
  assert.match(root.textContent, /<script>window.pwned=1<\/script>/);
  assert.equal(h.dom.window.pwned, undefined);
  assert.equal(typeof h.dom.window.CampaignMarkdown.render, 'function');
  h.dom.window.close();
});

test('script and encoded-protocol Markdown links cannot create active destinations', () => {
  const h = renderer();
  for (const destination of ['javascript:alert%281%29', 'JaVaScRiPt:alert%281%29', 'data:text/html,evil', 'vbscript:msgbox%281%29',
    'javascript&#58;alert%281%29', 'javascript&colon;alert%281%29', 'java&#x73;cript:alert%281%29', 'java%0ascript:alert%281%29']) {
    const root = h.render(`[click](${destination})`);
    assert.equal(root.querySelector('a[href]'), null, destination);
    assert.equal(root.querySelector('script,iframe,svg'), null, destination);
  }
  const root = h.render('[safe](https://example.org/\"onmouseover=alert%281%29)');
  assert.equal(root.querySelector('[onmouseover]'), null);
  h.dom.window.close();
});

test('nested malicious markup and code fences cannot escape the sanitized HTML context', () => {
  const h = renderer();
  const root = h.render('**[<img src=x onerror=alert(1)>](https://example.org)**\n\n```html\n</code><script>alert(1)</script>\n```\n\n<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">');
  assert.equal(root.querySelector('img,svg,math,script,style'), null);
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of element.attributes) assert.ok(!/^on/i.test(attribute.name));
  }
  assert.match(root.querySelector('pre').textContent, /<script>/);
  h.dom.window.close();
});

test('empty and non-string bodies render empty output without introducing markup', () => {
  const h = renderer();
  for (const value of ['', null, undefined, {}, 42]) assert.equal(h.render(value).innerHTML, '');
  h.dom.window.close();
});
