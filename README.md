# Edenvale Panel Manager

Estado: **Etapa 0 de 8** (scaffolding + modelo de datos + datos ficticios + navegación
funcional). Todavía no importa el Excel real ni tiene mapa jerárquico ni backend — ver
"Próximas etapas" abajo.

## Qué es esto

PWA para localizar paneles solares individuales, reportar daños y registrar reemplazos en
Edenvale Solar Farm (36 bloques). Reutiliza el stack y las convenciones ya probadas en
`edenvale-vegetation-control` (React + TS + Vite + Tailwind + Supabase + Dexie/IndexedDB +
Zustand) y la numeración/estructura de `edenvale-tracker-finder`.

## Requisitos

- Node.js 18 o superior.
- **No hace falta Supabase todavía.** La app funciona 100% local (IndexedDB) hasta que
  se conecte un backend en la Etapa 7.

## Correr localmente

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`. Al cargar por primera vez, la app siembra datos ficticios
(2 bloques, ~336 paneles, algunos issues y un reemplazo de ejemplo) para que puedas probar
todo el flujo sin depender del Excel real. Para reiniciar los datos ficticios, borrá el
IndexedDB del sitio desde las DevTools del navegador (Application → IndexedDB →
`edenvale-panel-manager` → Delete).

Al entrar, elegí (o creá) un operario — no hace falta contraseña. Después navegá por
Dashboard / Map / Search / Reports / Replacements / Records / Sync / Settings.

## Estructura del proyecto

```
src/
  lib/
    types.ts          modelo de datos (PhysicalLocation, Panel, Issue, Replacement, ActivityEvent, Operator)
    locationCode.ts    parseo/construcción del código BLOCK.INV.DCBOX.ARRAY.STRING.MODULE
    db.ts              esquema de IndexedDB (Dexie)
    fictionalData.ts   datos ficticios con la MISMA forma que el Excel real
    time.ts            formato de fecha/hora en Australia/Brisbane, DD/MM/YYYY, 24h
    id.ts              generación de IDs
  store/
    session.ts         operario activo (persistido, sin contraseña)
    settings.ts         nombre de la app, PIN admin, rango de voltage válido
  i18n/
    en.ts, index.ts     diccionario de textos (agregar es.ts acá suma español sin tocar componentes)
  components/
    NavBar.tsx, StatusBar.tsx, OperatorGate.tsx
  pages/
    Dashboard.tsx, MapView.tsx, Search.tsx, Reports.tsx, Replacements.tsx, Records.tsx, Sync.tsx, Settings.tsx
```

## El modelo de datos, confirmado contra el Excel real

Se analizó `EDE-GRS-CM-RPT-3190-C1-UPDATED_MAPPING_07-06_FORMULAS.xlsx` (hoja `INFORME`,
377.888 filas = 13.496 strings × 28 paneles, 36 bloques, 0 códigos sin parsear). La columna
`BLOCK.INV.DCBOX.ARRAY.STRING.MODULE` (ej. `S-1.1.1.1.1.1`) ya da la ubicación física a
nivel de panel individual, con la posición 1-28 incluida (1 = extremo norte, 28 = extremo
sur) — no hace falta derivarla. `locationId` en la app es ese código sin el prefijo `S-`.

| Excel (INFORME) | Campo de la app |
|---|---|
| `BLOCK.INV.DCBOX.ARRAY.STRING.MODULE` | `PhysicalLocation.locationId` / `Panel.locationId` |
| `SERIAL NUMBER` (821...) | `Panel.serialNumber` |
| `S/N` corto (14 dígitos) | `Panel.serialNumberShort` |
| `Vmp (V)` | `Panel.voltage` (el campo "Voltage" del spec) |
| `Pmp`, `Isc`, `Voc`, `Imp`, `Pnom`, `Pmp>Pnom` | `Panel.electrical.*` |

La hoja `Replaced` (348 reemplazos reales) se usó para calibrar los tipos de issue: la
causa más común con enorme diferencia es **"bypass diode activated"** (241/348 casos), así
que se agregó como tipo configurable además de los que ya pedía el spec. `WO SM` en esa
hoja es el número de orden de trabajo de SunManager (ej. 526, 602...), sólo completo en
~91/348 filas históricas.

**Pendiente para la Etapa 2:** ni el Tracker Finder ni la Vegetation Control tienen
geometría a nivel de panel individual (llegan hasta string/tracker). El campo
`PhysicalLocation.tracker`/`row`/`geometry` queda vacío hasta que se linkee esa geometría
(ver "Qué necesito de vos" abajo). Mientras tanto, `orientationFromModule()` en
`locationCode.ts` usa una regla simple (posición 1-14 = Norte, 15-28 = Sur) como
placeholder del split Norte/Sur real de Tracker Finder.

## Cómo crear el repo y desplegar (no existe todavía)

1. **GitHub**: creá un repo nuevo, por ejemplo `edenvale-panel-manager` (podés hacerlo
   privado). Subí esta carpeta completa vía "Add file → Upload files" arrastrando todo
   (o `git push` si preferís).
2. **Netlify**: "Add new site → Import an existing project" y conectá el repo (build
   command `vite build`, publish directory `dist` — ya están en `netlify.toml`). O, para
   probar rápido sin GitHub, corré `npm run build` acá y arrastrá la carpeta `dist/` a
   app.netlify.com/drop.
3. Renombrá el site desde Netlify (Site config → Change site name) para tener una URL
   prolija.

`netlify.toml` ya fuerza `vite build` (no `tsc -b && vite build`) — con TypeScript
estricto y sin tipos de todas las dependencias instalados, `tsc -b` fallaría el build por
errores de tipos aunque el código funcione bien; `vite build` (esbuild) sólo falla por
errores de sintaxis reales.

## Qué necesito de vos para las próximas etapas

- **Etapa 1 (importador real)**: nada más — ya tengo el Excel y el mapeo de columnas.
- **Etapa 2 (mapa jerárquico con geometría real)**: `all_blocks.json` o los SQL
  `tracker_boxes_part1/2.sql` si los tenés guardados de una sesión anterior; si no, los
  PDFs `EDE-ISE-EL-DRW-0002-*` + el Excel de strings (`EDE-ISE-EL-SCH-0006`).
- **Etapa 7 (backend/sync real)**: crear un proyecto Supabase nuevo (independiente del de
  Vegetation Control) y pasarme la URL + anon key (la anon key es pública por diseño, va
  en el bundle del frontend igual que en Vegetation Control — nunca la `service_role`).

## Próximas etapas

0. ✅ Scaffolding, modelo de datos, datos ficticios, navegación — **este entregable**.
1. Importador de Excel real (preview, mapeo, validaciones, upsert).
2. Mapa jerárquico planta → bloque → panel con geometría real.
3. Ficha de panel completa + búsqueda avanzada + escaneo QR/barras.
4. Formulario de reporte completo (fotos, selección múltiple).
5. Asistente de reemplazo completo (fotos antes/después, validaciones finas).
6. Records con columnas configurables, filtros guardados, export CSV/Excel, PDF.
7. Backend real: Supabase + sync offline (outbox, paginación, conflictos) + fotos.
8. PWA final, checklist de pruebas completa, deploy productivo.

## Qué se probó en esta entrega

- `npx tsc --noEmit` sobre todo `src/` sin errores de sintaxis (sólo ruido esperado por
  no tener `node_modules` instalado localmente — no hay red en este entorno para
  `npm install`, igual que pasó al construir Vegetation Control).
- Balance de JSON válido en `package.json` / `tsconfig*.json`.
- Flujo manual leído línea por línea: alta de operario → reporte de issue → reemplazo →
  cierre de issue relacionado → contadores del Dashboard.

Falta (antes de considerar esta etapa "verificada" de verdad): correr `npm install && npm
run dev` en una máquina con red y click-test real en el navegador — no lo pude hacer
desde acá.
