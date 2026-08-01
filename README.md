# audit-lang

Denetim raporu yazmak için oluşturulmuş bir dildir.

```bash
node audit-lang.js ornek.audit > rapor.html
```

```js
import { compile } from './audit-lang.js';
const html = compile(kaynakMetin);
```

Dosyalar: `audit-lang.js` (dil), `ornek.audit` (örnek rapor), `rapor.html` (çıktı).

## Deneme alanı

`playground.html` — tek dosya, sunucu gerekmez, çift tıklayıp açılır.
Solda kaynak, sağda anında derlenmiş rapor.

- Yazdıkça derler (300 ms), `⌘/Ctrl + ↵` hemen derler
- Söz dizimi renklendirme, satır numaraları
- Hata alt şeritte görünür; sözdizimi hatasında ilgili satır numarası kırmızıya döner
- Hata anında önizleme son çalışan hâlinde kalır
- Dört örnek: tam rapor, küçük başlangıç, filtre ve fonksiyon, tablo
- **HTML indir** düğmesi üretilen raporu kaydeder

Dili ya da örneği değiştirdikten sonra yeniden üretmek için:

```bash
node build-playground.js     # playground.tpl.html + audit-lang.js + ornek.audit → playground.html
```

Şablonu düzenlemek istersen `playground.tpl.html`. Şablondaki örnekler ters
tırnak içinde yazıldığı için, rapor kaynağındaki `${...}` yazımlarını `\${...}`
diye kaçırman gerekir — yoksa JavaScript kendi değişkeni sanır.

---

## 1. Temel kural

Her şey iki biçimden biri:

```js
ad: değer          // bildirim — çıktı üretmez
function(arg)     // çağrı — çıktıyı bunlar üretir
```

```js
baslik: "Satınalma Süreç Denetimi"
sayi: 3
liste: ["a", "b"]
audit: { id: "AUD-2026-014", findings: [] }

print(baslik)
```

`audit`, `style`, `report` gibi adlar dilin bildiği şeyler **değil**; sıradan
değişkenler. İstediğin adı verebilirsin.

Noktalı virgül isteğe bağlı. Yorumlar `//` ve `/* */`.

---

## 2. Değerler

| Tür | Yazımı |
|---|---|
| Metin | `"merhaba"` · `'merhaba'` |
| Sayı | `11` · `1.5` |
| Mantıksal | `true` · `false` |
| Boş | `null` |
| Dizi | `["a", "b"]` |
| Obje | `{ ad: "F-01", n: 3 }` |
| Fonksiyon | `(x) => x * 2` |

Obje anahtarı anahtar sözcük de olabilir: `{ in: "...", out: "..." }` geçerli,
`audit.scope.in` diye okunur.

### Metin içinde değişken

Tek kural var: `${ ... }`. İçine her ifade yazılabilir.

```js
print("${audit.id} numaralı rapor")                     // alan
print("${count(bulgular)} bulgu, ${count(acik)} açık")  // çağrı
print("${ad[f.severity]} — ${f.title}")                 // köşeli parantez
print("Termin: ${date(f.action.due, 'd MMM yyyy')}")    // içeride tırnak serbest
```

Süssüz `$` düz metindir: `"tutar: $100"` olduğu gibi basılır.

---

## 3. İşleçler

Öncelik sırasıyla (düşükten yükseğe):

```
where   ||   &&   == !=   < > <= >=   + -   * / %
```

Önek: `!` ve `-`.

`+` taraflardan biri metinse birleştirir, değilse toplar.

### Doğruluk

Şunlar **yanlış** sayılır: `null`, tanımsız, `false`, `0`, `""`, **boş dizi**.
Boş dizinin yanlış sayılması sayesinde `if (f.evidence)` doğrudan çalışır.
Boş obje `{}` doğrudur.

---

## 4. `where` — filtre

```js
acik:   audit.findings where status == "open"
majors: audit.findings where severity == "major"
gec:    audit.findings where status == "open" && action.due < "2026-08-01"
```

Koşulun içinde öğenin alanları doğrudan ad olarak geçer (`status`, `severity`).
Öğenin kendisine `it` ile ulaşırsın: `xs where it.n > 4`.

Bir öğede o alan **yoksa hata olmaz**, boş kabul edilir — bu yüzden bazı
bulgularda `status` olmaması filtreyi bozmaz.

Zincirlenebilir: `liste where a == 1 where b > 2`.

---

## 5. Erişim

```js
audit.findings          // alan
renk[f.severity]        // dinamik anahtar
liste[0]
```

Olmayan alan hata değil, tanımsız değer verir (`f.action.owner` gibi zincirler
güvenli). Buna karşılık **tanımsız değişken adı hatadır** — yazım hatalarını
yakalamak için.

---

## 6. Denetim ve döngü

```js
if (count(majors) > 0) {
  print("Majör uygunsuzluk var")
} else if (count(acik) > 0) {
  print("Açık bulgu var")
} else {
  print("Temiz")
}

for (f in audit.findings) {
  print(f.title)
}
```

### Sayaç

`ad: değer` üst kapsamda o ad varsa **onu günceller**, yoksa bulunduğu yerde
tanımlar. Bu yüzden döngü içindeki sayaç sıfırlanmaz:

```js
i: 0
for (f in liste) {
  i: i + 1
  print("${i}. ${f.title}")
}
```

---

## 7. Fonksiyonlar

İki yazım aynı şey:

```js
function alan(baslik, deger, stil = body) { ... }
alan: (baslik, deger, stil = body) => { ... }
```

Tek ifadeli gövde de olur:

```js
etiket: (f) => ad[f.severity]
kirmizi: (f) => { color: "#b00020" }    // { } obje gibiyse obje döner
```

- Varsayılan parametre: `stil = body`
- Değer döndürme: `return ifade`
- Erken çıkış: tek başına `return`
- Bir fonksiyon hem basabilir hem değer döndürebilir; `print` yan etki, `return` değerdir.

```js
function alan(baslik, deger, stil = body) {
  if (!deger) { return }              // boşsa hiç basma
  row({ after: 4 }) {
    print(baslik, { style: label })
    print(deger, { style: stil })
  }
}
```

---

## 8. Basım

### `print(değer, seçenekler)`

```js
print("Yönetici Özeti", { style: h2 })
print(audit.conclusion.text, { style: body })
print("Uyarı", { style: body, color: "#b00020", align: "right" })
```

`style` bir stil objesi; yanına yazdığın diğer anahtarlar onu ezer.

### Kapsayıcılar

Kapsayıcı çağrısından sonra içerik bloğu gelir:

```js
box({ border: "#e2e2e2", pad: 14, radius: 4 }) {
  print("başlık", { style: h3 })
  print("gövde", { style: body })
}

row({ after: 4 }) {          // yan yana
  print("Durum", { style: label })   // width verilen sabit kalır
  print(f.condition, { style: body }) // vermeyen kalan alanı doldurur
}

col() { ... }                // alt alta (varsayılan akış)
```

Ayar gerekmiyorsa parantez boş bırakılır: `box() { print("x") }`.
Blok parantezin içine argüman olarak yazılamaz. Kapsayıcılar iç içe girebilir.

### Sayfa ve kenar çubukları

```js
header({ center: audit.title, right: "Rev 1.2" })
footer({ left: "Kuruma Özel", right: "Sayfa ${page} / ${pages}" })
newpage()
```

`header`/`footer` `left`, `center`, `right` alır. `page` ve `pages` yer tutucu
değişkenlerdir; gerçek sayfa numarası ancak PDF arka ucunda anlam kazanır,
HTML çıktısında `{page}` olarak görünür.

---

## 9. Tablo

```js
table(audit.findings, {
  headStyle: { size: 10, bold: true, color: "#666" },
  border: "#e2e2e2",
  zebra: "#fafafa"
}) {
  column("Kod", "code", { width: 60 })
  column("Bulgu", "title")
  column("Önem", (f) => ad[f.severity], {
    width: 130,
    style: (f) => renk[f.severity]
  })
  column("Sorumlu", "action.owner", { width: 110 })
  column("Termin", (f) => date(f.action.due), { width: 90, align: "right" })
}
```

İlk argüman satır listesi, ikinci argüman tablo seçenekleridir. Sütunlar zorunlu
blok içinde `column(başlık, değer, seçenekler)` çağrılarıyla tanımlanır.

**`değer` — hücreye ne yazılacağı:**

| Yazım | Anlamı |
|---|---|
| `"code"` | satırın `code` alanı |
| `"action.owner"` | iç içe alan; ara halka boşsa hücre boş kalır |
| `(f) => date(f.action.due)` | hesaplanmış değer |

**Sütun seçenekleri:** `width`, `align`, `style` (`style` sabit obje ya da satır
alan fonksiyon olabilir — satıra göre renk).

**Tablo seçenekleri:** `headStyle`, `cellStyle`, `border`, `zebra`, `pad`,
`before`, `after`.

Tablo bloğunda yalnızca `column(...)` tanımları kullanılabilir.

---

## 10. Stiller

Stil ayrı bir kavram değil, sıradan obje:

```js
h1:    { size: 22, bold: true, after: 4 }
body:  { size: 11, color: "#333", line: 1.5 }
muted: { size: 10, color: "#888", italic: true }
major: { color: "#b00020" }

print(x, { style: h1 })
print(x, { style: style(h2, major) })     // birleştir — sağdaki solu ezer
print(x, { style: { size: 14 } })          // yerinde
```

Değere göre stil seçmek için düz obje eşlemesi:

```js
renk: { major: major, minor: minor, ofi: ofi }
print(f.title, { style: renk[f.severity] })
```

### Anahtarlar

| Anahtar | CSS karşılığı |
|---|---|
| `size` | font-size (px) |
| `color` | color |
| `bold` | font-weight 700 / 400 |
| `italic` | font-style |
| `line` | line-height |
| `before` / `after` | margin-top / margin-bottom (px) |
| `width` | genişlik (px) — `row` içinde sabit sütun |
| `align` | text-align |
| `border` | 1px solid *renk* |
| `pad` | padding (px) |
| `radius` | border-radius (px) |
| `bg` | background |
| `font` | font-family |

Tanınmayan anahtarlar sessizce yok sayılır.

---

## 11. Gömülü fonksiyonlar

| Fonksiyon | Ne yapar |
|---|---|
| `count(x)` | dizi uzunluğu; boş/`null` → 0, dizi değilse 1 |
| `join(dizi, ayrac = ", ")` | birleştirir |
| `sum(dizi, alan?)` | toplar — `sum(xs, "n")` ya da `sum([1,2,3])` |
| `upper(s)` / `lower(s)` | Türkçe kurallarına göre büyük/küçük harf |
| `date(v, bicim = "d MMM yyyy")` | `"2026-09-30"` → `30 Eyl 2026`; boşsa boş dize |
| `style(...objeler)` | stil objelerini birleştirir |

`date` biçim damgaları: `yyyy`, `MMM` (Oca…Ara), `MM`, `dd`, `d`.
Girdi `YYYY-MM-DD` ile başlamıyorsa olduğu gibi döner.

---




