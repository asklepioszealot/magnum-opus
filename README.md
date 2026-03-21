# Magnum Opus

`magnum-opus`, `flashcards-app` ve `multiple-choices-test` projelerini tek Git deposunda toplayan Phase A monorepo'dur.

Bu fazda hedef, urun davranisini degistirmeden iki uygulamayi ayni workspace altinda calistirabilmek ve release/test hatlarini merkezi olarak yonetebilmektir.

## Yapi

```text
magnum-opus/
  apps/
    flashcards/
    mcq/
  packages/
    shared-build/
    shared-content/
    shared-storage/
    shared-ui/
  tooling/
    release/
    scripts/
  docs/
```

## Onemli Not

Bu fazda kok dizinde bilerek `index.html` yoktur.

Her uygulama kendi giris dosyasini korur:

- `apps/flashcards/index.html`
- `apps/mcq/index.html`

Kok dizin, urun giris noktasi degil; workspace orkestrasyon katmanidir.

## Workspace Komutlari

Bagimliliklari kurmak icin:

```powershell
npm install
```

Flashcards:

```powershell
npm run dev:flashcards
npm run build:dist:flashcards
npm run build:desktop:flashcards
npm run test:flashcards
npm run release:flashcards
```

MCQ:

```powershell
npm run dev:mcq
npm run build:dist:mcq
npm run build:desktop:mcq
npm run test:mcq
npm run release:mcq
```

Set validation:

```powershell
npm run validate:set:flashcards
npm run validate:set:mcq
```

## Dogrulanan Durum

Phase A bootstrap sonrasinda bu branch uzerinde asagidakiler teyit edildi:

- `npm run build:dist:flashcards`
- `npm run build:dist:mcq`
- `npm run test:flashcards`
- `npm run test:mcq`

## Sonraki Adimlar

- Dusuk riskli ortak altyapilari `packages/` altina tasimak
- Root release/test yardimci scriptlerini artirmak
- Ortak icerik ve storage kontratlarini tanimlamak
- Phase B icin `apps/study-shell` uygulamasini ayri bir katman olarak eklemek
