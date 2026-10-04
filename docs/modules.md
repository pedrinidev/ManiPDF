# Módulos — ManiPDF

Cada módulo = `service` (lógica) + `ipc` (handlers) + DTOs en el contrato + UI.
Un módulo se considera **completo** solo cuando: funciona, está integrado,
maneja errores y está documentado.

## Roadmap por fases

### Fase 1 — Núcleo (visor + documento)

| Módulo | Estado | Funciones |
|--------|--------|-----------|
| `document` | ✅ Completo | Abrir (diálogo y por ruta), guardar, guardar como, metadata, cerrar. Deshacer/rehacer hasta lo guardado deja el documento sin cambios; al cerrar la ventana con cambios se pregunta por cada documento con opción de **Guardar**; «Recientes» oculta los archivos que ya no existen |
| `viewer` | ✅ Completo | Render de las páginas cercanas a la vista (memoria acotada a cualquier zoom), cada página con su tamaño exacto desde el primer pintado, zoom 25 %–400 % con botones, Cmd/Ctrl +/−/0 y pellizco del trackpad (Ctrl + rueda) conservando la posición, imágenes suavizadas al ampliar, renders cancelables (sin páginas en blanco o deformadas al cambiar de zoom), repintado al cambiar de pantalla (Retina ↔ externa), estado vacío/carga/error |
| `search` | ✅ Completo | Buscar texto (Cmd/Ctrl+F), resaltado de coincidencias, navegación ↑/↓, scroll automático. Encuentra frases repartidas en varios fragmentos o líneas, sin distinguir mayúsculas ni tildes; resaltado correcto en páginas giradas o recortadas; texto cacheado por página. Solo renderer (pdf.js `getTextContent` + `services/text-search.ts`, lógica pura), sin IPC. |
| `stamp` | ✅ Completo | Marca de agua (diagonal, color, opacidad), encabezado/pie (izq/centro/der) y numeración con placeholders `{page}`/`{total}`/`{date}`. |
| `redact` | ✅ Completo | Redacción **real**: marca zonas → la página se rasteriza con recuadros negros quemados (el contenido bajo desaparece). Las páginas sin redacción se conservan intactas. El resultado es un documento nuevo sin marcadores, formularios ni metadatos del original (podrían contener lo censurado) y sin restos de la página original: antes seguía dentro del archivo si otra página la enlazaba. |
| `combine` | ✅ Completo | Combinar varios PDF en uno (elige archivos) y dividir el actual en archivos de N páginas (en una subcarpeta nueva `‹nombre›-partes`). Los PDF cifrados se descifran antes si sus permisos lo permiten (si no, error claro en vez de páginas en blanco). |
| `navigation` | ✅ Completo | **Ir a página** en la barra (`‹ [32] / 120 ›`, Enter para saltar, Cmd/Ctrl+G), indicador de la página actual, clic en una **miniatura** lleva el visor a esa página (la miniatura actual se resalta y la lista la sigue), panel de **marcadores** y **enlaces** clicables (internos saltan de página, externos abren el navegador; bien colocados también en páginas giradas). Estado en `state/navigation.context.tsx`. *Crear* marcadores/enlaces queda fuera de alcance. |
| `compare` | ✅ Completo | Compara el texto con otro PDF, página a página (diff por líneas LCS); resalta líneas añadidas/eliminadas con resumen. Solo renderer (pdf.js + diff propio). |
| `separations` | ✅ Completo | **Separación de colores real** (prepress): planchas CMYK o RGB vía Ghostscript (`tiff32nc`/`tiff24nc`); el renderer decodifica los TIFF con `utif`, como mucho 2 a la vez y solo de las páginas visibles, con las planchas en bytes. Ghostscript va empaquetado con la app (si no, se usa el del sistema). |

### Fase 2 — Organización de páginas (`pages`) — ✅ Completo

- ✅ Rotar página(s) (izquierda/derecha)
- ✅ Borrar página(s) (impide vaciar el documento)
- Todas las operaciones trabajan sobre el propio documento: se conservan formulario,
  marcadores, destinos, etiquetas y estructura. Las páginas borradas (y lo que solo
  ellas usaban) se eliminan del archivo de verdad (`services/pdf-cleanup.ts`).
- Duplicar comparte contenido y recursos con el original (no duplica imágenes) y sus
  widgets pasan a ser otro widget del mismo campo.
- ✅ Reordenar por **drag & drop** en el panel de miniaturas (la página arrastrada ocupa la posición de la miniatura de destino; indicador antes/después)
- ✅ Duplicar página(s)
- ✅ Insertar páginas de otro PDF (en la posición seleccionada)
- ✅ Extraer página(s) a un PDF nuevo
- ✅ Panel lateral de **miniaturas** con selección múltiple (clic / Ctrl / Shift)
- La selección se ajusta tras cada operación (`page-order.ts`): borrar la vacía,
  reordenar la conserva en sus páginas, duplicar selecciona las copias e insertar las
  páginas nuevas; si el nº de páginas cambia por otra vía (deshacer), se vacía. Antes
  apuntaba a otras páginas y un segundo «Borrar» se llevaba la siguiente.

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
| `security` | ✅ Completo | Proteger con contraseña (apertura + propietario), cifrado **AES-128**, permisos (imprimir/copiar/modificar). Abrir PDFs protegidos: descifrado sin pérdidas, solo lectura si sus permisos no permiten modificarlos (desbloqueable con la contraseña de propietario) y, al guardar, se conservan contraseña y permisos |
| `optimize` | ✅ Completo | Comprimir: modo estructura (sin pérdida real: conserva formulario, marcadores, estructura, adjuntos y enlaces; si Ghostscript perdiera algo, se descarta su resultado) y rasterizar a JPEG (con pérdida, calidad/resolución configurable) |
| `convert` | ✅ Completo | PDF → imágenes (PNG/JPG, resolución configurable), **página a página** con progreso y en una subcarpeta nueva (nunca sobrescribe; páginas enormes se reducen al máximo de canvas con aviso); imágenes → PDF (una página por imagen; tamaño Carta, A4 o el de la imagen) |
| `forms` | ✅ Completo | Detectar y rellenar campos (con aplanado opcional) **y crear campos nuevos** (texto/casilla/desplegable) dibujándolos sobre la página; los nombres repetidos se renombran (`nombre_2`) |

**Nota técnica `security`:** `pdf-lib` no cifra al guardar, por eso se usa
**`@cantoo/pdf-lib`** (fork pura-JS con `encrypt()`/descifrado) en `pdf-crypto.ts`.
La librería elige el algoritmo según la versión de la cabecera; ManiPDF fija la 1.7
para obtener siempre AES-128. Exporta una *copia* cifrada; el documento abierto no se
altera.

### Fase 5 — Avanzado

- **OCR** (`ocr`) — ✅ Completo
  - ✅ Extraer texto de las páginas (con elección de idioma: español / inglés)
  - ✅ Guardar el texto como `.txt`
  - ✅ Crear **PDF buscable**: capa de texto invisible (seleccionable) sobre las
    páginas originales, solo en las escaneadas (sin texto); el resto del documento no
    cambia. Muestra el progreso (preparación y reconocimiento).
  - Implementado con **tesseract.js en el proceso main** (Node): ManiPDF descarga el
    modelo de idioma una vez a `userData/tessdata` y tesseract.js lo lee de ahí (nunca
    toca la red). El renderer rasteriza; el main hace el OCR y ensambla. **Requiere
    internet la primera vez**; sin conexión ni modelo, mensaje claro.
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
