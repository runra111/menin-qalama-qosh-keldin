// Bundles main.js + three.js and inlines every asset and font into one HTML file.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const A = path.join(here, '..', 'assets');
const bundle = async (bhs) => (await build({ entryPoints: [path.join(here, 'main.js')], bundle: true, minify: true, format: 'iife', write: false, target: 'es2020', legalComments: 'none', define: { __BHS__: String(bhs) } })).outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const js = await bundle(true);
const jsGit = await bundle(false);

const b64 = (f) => fs.readFileSync(path.join(A, f)).toString('base64');
const assets = {
  kbtu: 'data:image/jpeg;base64,' + b64('kbtu.jpg'),
  saturn_diff: 'data:image/jpeg;base64,' + b64('saturn_diff.jpg'),
  neptune_diff: 'data:image/jpeg;base64,' + b64('neptune_diff.jpg'),
  saturn_ring: 'data:image/png;base64,' + b64('saturn_ring.png'),
  neptune_ring: 'data:image/png;base64,' + b64('neptune_ring.png'),
  enceladus: 'data:image/jpeg;base64,' + b64('enceladus.jpg'),
  mimas: 'data:image/jpeg;base64,' + b64('mimas.jpg'),
  saturn: b64('saturn.bin'),
  neptune: b64('neptune.bin'),
  stars: b64('stars.bin'),
  astronaut: b64('astronaut.glb'),
  bart: b64('bart.glb'),
  pig: b64('pig.glb'),
};

const fontDir = (p) => path.join(here, 'node_modules', '@fontsource', p, 'files');
const ranges = {
  latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  cyrillic: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  'cyrillic-ext': 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
};
let fonts = '';
for (const [fam, pkg, weights] of [['IBM Plex Sans', 'ibm-plex-sans', [300, 400, 500, 600]], ['IBM Plex Mono', 'ibm-plex-mono', [400]]]) {
  for (const w of weights) for (const sub of Object.keys(ranges)) {
    const f = path.join(fontDir(pkg), `${pkg}-${sub}-${w}-normal.woff2`);
    if (!fs.existsSync(f)) continue;
    fonts += `@font-face{font-family:"${fam}";font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${fs.readFileSync(f).toString('base64')}) format("woff2");unicode-range:${ranges[sub]};}\n`;
  }
}

const tpl = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
const page = tpl
  .replace('/*FONTS*/', () => fonts)
  .replace('/*CREDIT*/', () => '')
  .replace('/*ASSETS*/', () => JSON.stringify(assets))
  .replace('/*BUNDLE*/', () => js);

const head = '<!doctype html>\n<html lang="kk">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';
// web build (artifact, GitHub Pages): songs are separate files in music/
fs.writeFileSync(path.join(here, 'artifact.html'), page);
const web = path.join(here, '..', 'web');
fs.mkdirSync(path.join(web, 'music'), { recursive: true });
fs.writeFileSync(path.join(web, 'index.html'), head + page + '\n</html>\n');
const hasSong = (n) => fs.existsSync(path.join(A, 'music', n + '.mp3'));
for (const n of ['bg', 'bh', 'egg']) if (hasSong(n)) fs.copyFileSync(path.join(A, 'music', n + '.mp3'), path.join(web, 'music', n + '.mp3'));
// local single file: songs embedded, works offline from a double-click
const music = {};
for (const n of ['bg', 'bh', 'egg']) if (hasSong(n)) music['music_' + n] = b64(path.join('music', n + '.mp3'));
const local = tpl
  .replace('/*FONTS*/', () => fonts)
  .replace('/*CREDIT*/', () => '')
  .replace('/*ASSETS*/', () => JSON.stringify({ ...assets, ...music }))
  .replace('/*BUNDLE*/', () => js);
fs.writeFileSync(path.join(here, '..', 'Презентация.html'), head + local + '\n</html>\n');
// GitHub build: no Black Hole Sun; Deftones and the dance song as files in music/
const gh = path.join(here, '..', 'github');
fs.mkdirSync(path.join(gh, 'music'), { recursive: true });
const ghPage = tpl
  .replace('/*FONTS*/', () => fonts)
  .replace('/*CREDIT*/', () => '')
  .replace('/*ASSETS*/', () => JSON.stringify(assets))
  .replace('/*BUNDLE*/', () => jsGit);
fs.writeFileSync(path.join(gh, 'index.html'), head + ghPage + '\n</html>\n');
for (const n of ['bg', 'egg']) fs.copyFileSync(path.join(A, 'music', n + '.mp3'), path.join(gh, 'music', n + '.mp3'));
console.log('ok github', (ghPage.length / 1e6).toFixed(2), 'MB');
console.log('ok web', (page.length / 1e6).toFixed(2), 'MB, local', (local.length / 1e6).toFixed(2), 'MB');
