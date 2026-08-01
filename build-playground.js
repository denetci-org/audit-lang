/* playground.tpl.html + audit-lang.js + ornek.audit → playground.html
   kullanım: node build-playground.js                                   */

import fs from 'node:fs';

const oku = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const koy = (metin, isaret, deger) => metin.split(isaret).join(deger);

// dilden komut satırı bölümünü kes (tarayıcıda process/import.meta yok)
const KESME = '/* --- KOMUT SATIRI';
const dil = oku('./audit-lang.js')
  .split(KESME)[0]
  .replace('export function compile', 'function compile');

let cikti = oku('./playground.tpl.html');
cikti = koy(cikti, '/*{{LANG}}*/', dil);
cikti = koy(cikti, '/*{{ORNEK}}*/', JSON.stringify(oku('./ornek.audit')));

fs.writeFileSync(new URL('./playground.html', import.meta.url), cikti);
console.log('playground.html yazıldı — ' + (cikti.length / 1024).toFixed(1) + ' KB');
