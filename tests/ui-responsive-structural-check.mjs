import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const page = fs.readFileSync(`${root}/apps/web/app/page.tsx`, 'utf8');
const css = fs.readFileSync(`${root}/apps/web/app/globals.css`, 'utf8');
const layout = fs.readFileSync(`${root}/apps/web/app/layout.tsx`, 'utf8');
const manifest = JSON.parse(fs.readFileSync(`${root}/apps/web/public/manifest.json`, 'utf8'));

for (const token of ['--clinai-blue', '--clinai-red', '--surface', '--border']) assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
for (const marker of ['desktop-sidebar','tablet-rail','mobile-bottom-nav','nav-drawer','mobile-search','metric-grid','quick-actions','create-record']) assert.match(css, new RegExp(`\\.${marker}`));
for (const marker of ['Command Center','ClinAI','Clinical journey','Register patient','View queue','Patients','Queue','Tasks','More']) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
assert.match(page, /\/clinai-logo\.png/);
assert.match(page, /\/clinai-icon\.png/);
assert.match(layout, /favicon\.ico/);
assert.equal(manifest.theme_color, '#04366b');
assert.ok(manifest.icons.length >= 2);
console.log('ClinAI responsive design system structural check passed');
