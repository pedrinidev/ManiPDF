# Módulos — ManiPDF

Cada módulo = `service` (lógica) + `ipc` (handlers) + DTOs en el contrato + UI.
Un módulo se considera **completo** solo cuando: funciona, está integrado,
maneja errores y está documentado.

## Roadmap por fases

### Fase 1 — Núcleo (visor + documento)

| Módulo | Estado | Funciones |
|--------|--------|-----------|
| `document` | ✅ Completo | Abrir (diálogo y por ruta), guardar, guardar como, metadata, cerrar |
| `viewer` | ✅ Completo | Render de todas las páginas, zoom (25%–400%), HiDPI, estado vacío/carga/error |
| `search` | ✅ Completo | Buscar texto (Cmd/Ctrl+F), resaltado de coincidencias, navegación ↑/↓, scroll automático. Solo renderer (pdf.js `getTextContent`), sin IPC. |
| `stamp` | ✅ Completo | Marca de agua (diagonal, color, opacidad), encabezado/pie (izq/centro/der) y numeración con placeholders `{page}`/`{total}`/`{date}`. |
| `redact` | ✅ Completo | Redacción **real**: marca zonas → la página se rasteriza con recuadros negros quemados (el contenido bajo desaparece). Las páginas sin redacción se conservan intactas. |
| `combine` | ✅ Completo | Combinar varios PDF en uno (elige archivos) y dividir el actual en archivos de N páginas (a una carpeta). |
| `navigation` | ✅ Completo | Panel de **marcadores** (índice del PDF, clic para saltar) y **enlaces** clicables (internos saltan de página, externos abren el navegador). Solo lectura/navegación; *crear* marcadores/enlaces queda fuera de alcance. |
| `compare` | ✅ Completo | Compara el texto con otro PDF, página a página (diff por líneas LCS); resalta líneas añadidas/eliminadas con resumen. Solo renderer (pdf.js + diff propio). |
| `separations` | ✅ Completo | **Separación de colores real** (prepress): planchas CMYK + tintas planas vía Ghostscript (`tiffsep`); el renderer decodifica los TIFF con `utif`. **Requiere Ghostscript instalado** (`brew install ghostscript`). |

### Fase 2 — Organización de páginas (`pages`) — ✅ Completo

- ✅ Rotar página(s) (izquierda/derecha)
- ✅ Borrar página(s) (impide vaciar el documento)
- ✅ Reordenar por **drag & drop** en el panel de miniaturas
- ✅ Duplicar página(s)
- ✅ Insertar páginas de otro PDF (en la posición seleccionada)
- ✅ Extraer página(s) a un PDF nuevo
- ✅ Panel lateral de **miniaturas** con selección múltiple (clic / Ctrl / Shift)

> "Combinar varios PDF" se cubre con *Insertar*; "dividir" se cubre con *Extraer*.
> La selección múltiple permite operar sobre varias páginas a la vez.

### Fase 3 — Anotaciones (`annotations`) — ✅ Completo

- ✅ Resaltar (rectángulo translúcido)
- ✅ Subrayar (línea)
- ✅ Rectángulo (contorno)
- ✅ Dibujo a mano alzada (ink)
- ✅ Notas adhesivas con texto editable
- ✅ Color configurable por herramienta
- ✅ Seleccionar (clic) y borrar (botón / tecla Supr)
- ✅ "Grabar en PDF": aplana las anotaciones en el contenido (pdf-lib)

> **Limitación conocida:** las anotaciones se *aplanan* en el contenido del PDF
> al grabar (no quedan como objetos de anotación re-editables al reabrir, como
> en otros editores profesionales). Mejora futura: escribir objetos de anotación PDF reales.
> Las coordenadas se guardan normalizadas (0..1) para ser independientes del zoom.
> Pendiente: anotar sobre páginas rotadas.

### Fase 4 — Utilidades

| Módulo | Estado | Funciones |
|--------|--------|-----------|
| `security` | ✅ Completo | Proteger con contraseña (apertura + propietario), cifrar, permisos (imprimir/copiar/modificar) |
| `optimize` | ✅ Completo | Comprimir: modo estructura (sin pérdida) y rasterizar a JPEG (con pérdida, calidad/resolución configurable) |
| `convert` | ✅ Completo | PDF → imágenes (PNG/JPG, resolución configurable, a una carpeta), imágenes → PDF (una página por imagen) |
| `forms` | ✅ Completo | Detectar y rellenar campos (con aplanado opcional) **y crear campos nuevos** (texto/casilla/desplegable) dibujándolos sobre la página |

**Nota técnica `security`:** `pdf-lib` no cifra al guardar, por eso se usa
**`@cantoo/pdf-lib`** (fork pura-JS con `encrypt()`) solo en este módulo.
Exporta una *copia* cifrada; el documento abierto no se altera.

### Fase 5 — Avanzado

- **OCR** (`ocr`) — ✅ Completo
  - ✅ Extraer texto de las páginas (con elección de idioma: español / inglés)
  - ✅ Guardar el texto como `.txt`
  - ✅ Crear **PDF buscable**: imagen de página + capa de texto invisible (seleccionable)
  - Implementado con **tesseract.js en el proceso main** (Node): el modelo de
    idioma se descarga una vez y se cachea. El renderer rasteriza; el main hace
    el OCR y ensambla. **Requiere internet la primera vez** (descarga del modelo).
- **Empaquetado / CI multiplataforma** — ✅ Completo
  - ✅ `.dmg` de macOS generado con `npm run dist` (electron-builder); app
    empaquetada verificada arrancando.
  - ✅ `tesseract.js` desempaquetado del asar (`asarUnpack`) para que el OCR
    funcione en la app instalada.
  - ✅ Workflow `.github/workflows/build.yml` (GitHub Actions) que genera
    `.dmg` / `.exe` / `.AppImage` en sus respectivos SO.
  - Sin firma de código (uso personal): macOS/Windows piden confirmación la 1ª vez.
- **Añadir texto / firma visible** — ✅ Completo (parte de `annotations`)
  - ✅ Cuadros de **texto** visible (color y 3 tamaños), grabados como texto real
  - ✅ **Firma / imagen**: elegir un PNG/JPG y colocarlo (se embebe en el PDF)
  - Reutiliza el overlay de anotaciones; la fuente del texto escala con el zoom
    (unidades `cqh`); el grabado usa `drawText` / `embedPng`/`embedJpg`.
  - ⚠️ Limitación honesta: esto **añade** texto nuevo. *Editar texto existente con
    reflujo* (cambiar un párrafo ya escrito) no es viable en JS — es el motor
    propio de Adobe. Queda fuera de alcance.
- **Firma digital con certificado** (criptográfica) — ⏳ mejora futura (de nicho)

## Cómo se añade un módulo nuevo (receta)

1. Definir DTOs y canales en `src/shared/ipc-contract.ts`.
2. Crear `src/main/services/<modulo>.service.ts` con la lógica (única que usa pdf-lib).
3. Crear `src/main/ipc/<modulo>.ipc.ts` con los handlers (sin lógica).
4. Registrar el handler en `src/main/index.ts` (`registerModules`).
5. Añadir el método al preload (`src/preload/index.ts`) y al tipo `AppApi`.
6. Crear el cliente/uso en el renderer (`services/`, `state/`, `ui/` o `views/`).
7. Actualizar `docs/` (este archivo + `api.md`).
8. `npm run typecheck && npm run build`.
