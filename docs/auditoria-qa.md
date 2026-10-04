# Auditoría y QA — ManiPDF 0.1.8

**Fecha:** 2026-10-03 · **Alcance:** todo `src/` (main, preload, renderer, shared), `scripts/`, CI y la
app instalada `/Applications/ManiPDF.app` (0.1.8).

## Resumen

ManiPDF es un editor de PDF de escritorio (Electron 33 + React 19 + TypeScript). El proceso main
manipula el PDF con pdf-lib (cifrado con `@cantoo/pdf-lib`, prepress y descifrado con Ghostscript
embebido, OCR con tesseract.js); el renderer lo muestra con pdf.js y envía las ediciones por el
contrato IPC tipado.

La arquitectura por capas es sólida, el typecheck pasa y los 24 tests pasan, pero esos tests solo
cubren helpers puros: **ningún servicio que modifique PDFs tiene pruebas**, y ahí está casi todo lo
que falla.

| Severidad | Nº | Verificación |
|-----------|----|--------------|
| Crítica   | 4  | las 4 reproducidas |
| Alta      | 11 | 7 reproducidas · 4 por análisis de código |
| Media     | 11 | 1 reproducida · 10 por análisis de código |
| Baja      | 14 | análisis de código |

Los 4 críticos pueden **destruir o filtrar contenido del usuario sin ningún aviso**.

## Estado de las correcciones

| ID | Estado | Cambio | Verificación |
|----|--------|--------|--------------|
| U1 | ✅ Corregido | Imágenes siempre suavizadas (`canvas-smoothing.ts` + `CanvasFactory` propia); Cmd/Ctrl +/−/0 y pellizco = zoom del visor; zoom de Chromium anulado al arrancar | E2E: recorte al 200 % sin escalones; Cmd+= → 125 %, Cmd+0 → 100 %, pellizco → 225 %, `devicePixelRatio` intacto |
| U2 | ✅ Corregido | Clic en miniatura → el visor va a la página; miniatura actual resaltada y seguida | E2E: clic en la 9 → página 9 arriba, indicador 9 |
| U3 | ✅ Corregido | Selector `‹ [n] / total ›` en la barra, Enter para saltar, Cmd/Ctrl+G; barra adaptable hasta 900 px | E2E (120 págs. con tamaños mezclados): 32, 100 y 999→120 exactos; el primer clic selecciona el número |
| A7 | ✅ Corregido | Renders cancelables con lienzo de trabajo; páginas fuera de vista liberadas a cualquier zoom; tamaño exacto de página desde el inicio; repintado al cambiar de pantalla | E2E: 6 clics rápidos en + → 250 % bien pintado |
| A8 | ✅ Corregido | `moveIndex` en `page-order.ts`: la página ocupa la posición de destino; indicador antes/después | Tests unitarios + E2E (1→2 intercambia; 1→última va al final) |
| A11 | ✅ Corregido | Menú propio de macOS sin Recargar, zoom de Chromium, Cerrar ventana ni herramientas de desarrollo (`src/main/menu.ts`) | Tests de la plantilla del menú |
| M6 | ✅ Corregido | Enlaces internos bien colocados en páginas giradas o con CropBox (`convertToViewportRectangle`). Búsqueda (`text-search.ts`): frases partidas en fragmentos o líneas, sin mayúsculas ni tildes, cajas con la matriz del texto + viewport (una por línea), texto cacheado por página, contador «…» que ya no se queda atascado, y una edición ya no salta a la primera coincidencia | Tests unitarios + E2E: frase en 2 fragmentos y entre líneas, páginas giradas 90/180/270° y recortadas, tildes; cada resaltado dentro del texto real |
| C1 | ✅ Corregido | PDFs cifrados: descifrado sin pérdidas al abrir si se abren sin contraseña y permiten modificar; si no, solo lectura (`READ_ONLY`) con desbloqueo por contraseña de propietario; nunca se editan cifrados. Orígenes cifrados al insertar/combinar se descifran o se rechazan con mensaje | Tests de regresión (`pdf-integrity.test.ts`) + banco de pruebas: rotar/anotar/borrar/combinar ya no corrompen |
| C2 | ✅ Corregido | `pruneDeadPages` (`pdf-cleanup.ts`): anula referencias a páginas muertas y elimina objetos inalcanzables antes de guardar (censurar, borrar, extraer, dividir, combinar, insertar) | Tests: `SECRETO-123` ya no aparece en ningún flujo |
| C3 | ✅ Corregido | Borrar/reordenar/duplicar/extraer en el propio documento (con atributos heredados fijados y widgets podados); comprimir sin pérdida sin copiar páginas y validando el resultado de Ghostscript | Tests: formulario y marcadores intactos tras cada operación |
| C4 | ✅ Corregido | `applyEncryption` fija la cabecera 1.7 → AES-128 siempre | Test: PDF 1.3 → `/V 4 /CFM /AESV2` |
| A4 | ✅ Corregido | Desbloqueo sin pérdidas (Ghostscript solo de respaldo); al guardar y al exportar copia se conservan contraseña de apertura y permisos (AES) | Tests: campos y marcadores tras desbloquear; mismo `/P` al guardar; copia cifrada |
| M3 | ✅ Corregido | Escritura atómica (temporal + `rename`, conserva permisos, respeta enlaces simbólicos); `restore()` valida antes de sustituir | Tests de regresión |
| A1 | ✅ Corregido | Anotaciones, sellos y campos nuevos se dibujan en el marco visible de la página (`page-frame.ts`: CropBox ∩ MediaBox + /Rotate); los widgets giran con la página | Tests contra pdf.js en las 4 rotaciones + banco de pruebas (resaltado y pie en su sitio) |
| A2 | ✅ Corregido | `winansi.ts` adapta los textos a la fuente estándar («→»→«->», «ﬁ»→«fi», «Ł»→«L», resto «?»); rellenar formularios guarda el valor Unicode real (NeedAppearances) y solo aplanar avisa | Tests de regresión |
| A3 | ✅ Corregido | Si grabar lo pendiente falla, Guardar/Cerrar/Imprimir se detienen (antes se guardaba sin ello y se perdía) | Revisión de código + typecheck |
| A9 | ✅ Corregido | Ghostscript escribe en un temporal con nombre fijo; «%» escapado en todas sus rutas de salida | Test (se omite si no hay Ghostscript) + banco de pruebas |
| M2 | ✅ Corregido | Exportar, Imprimir, Proteger, Dividir y Extraer graban antes lo pendiente | Revisión de código |
| A5 | ✅ Corregido | ManiPDF descarga el modelo (con tiempo límite y escritura atómica) a `userData/tessdata` antes de crear el worker; tesseract.js ya no toca la red. Además se esquivan dos fallos de tesseract.js: la creación que no termina nunca si falla el idioma y la excepción no capturada | Test sin conexión (antes se colgaba) + prueba real: descarga, caché y uso sin red |
| A6 | ✅ Corregido | Planchas en bytes (4× menos memoria), como mucho 2 renders a la vez, caché limitada salvo páginas visibles, generación que descarta resultados tardíos | Tests de la caché + E2E: máx. 2 simultáneos, sin tintas de otro modo |
| M1 | ✅ Corregido | Cola por documento en el main (`handleExclusive`); `revision` + `baseRevision` → `CONFLICT` en censurar, PDF buscable y comprimir rasterizando; deshacer/rehacer de uno en uno. El renderer envía la revisión del pdf.js que rasterizó (justo tras editar, el visor aún tiene la anterior) | Tests de la cola y del conflicto (censurar tras reordenar se rechaza) + E2E |
| M4 | ✅ Corregido | Exportar imágenes, dividir y exportar planchas escriben en una subcarpeta nueva (`createUniqueFolder`), nunca sobrescriben; nombres saneados | Tests |
| M5 | ✅ Corregido | Exportación a imágenes página a página (bytes, sin base64), escala limitada al máximo de canvas con aviso, progreso | Tests + E2E (12 páginas PNG válidas) |
| M7 | ✅ Corregido | macOS: abrir un PDF desde Finder sin ventanas crea la ventana, que recoge la cola de archivos | Revisión de código |
| M8 | ✅ Corregido | Proteger: el texto explica que sin contraseña de propietario se genera una aleatoria (nadie podrá cambiar los permisos); la contraseña no se recorta y hay que confirmarla | Revisión de código + typecheck |
| M9 | ✅ Corregido | Contraseña válida pero imposible de descifrar para editar → solo lectura con el motivo (antes «Contraseña incorrecta»). En el respaldo de Ghostscript la contraseña va en un archivo de argumentos privado, no en la línea de comandos (visible con `ps`) | Tests con Ghostscript real: espacios, comillas, barras, apóstrofos |
| M10 | ✅ Corregido | «Crear PDF buscable» añade el texto invisible sobre las páginas originales (marco visible: giradas y recortadas incluidas) y solo en las páginas sin texto; progreso visible; páginas e idioma validados en el main | Test de regresión (texto vectorial y formulario intactos, posición correcta) + E2E (PDF mixto: 3 de 5 páginas al OCR) + OCR real (0,5 pt de desfase entre página normal y girada) |
| M11 | 🟡 Parcial | `sandbox: true`; la ventana no puede navegar fuera de la interfaz; `openExternal` solo con http(s) y mailto, validado en el main. **Pendiente:** actualizar Electron 33 (sin parches), cambio mayor que requiere aprobación | E2E con sandbox activo |
| M13 | ✅ Corregido (nuevo) | **Selección de texto en páginas giradas:** la capa de texto de pdf.js se maqueta sin girar y su visor la gira por CSS (`data-main-rotation`); ManiPDF no tenía esas reglas y, en páginas giradas, seleccionar o copiar texto caía en otro sitio | E2E: la capa coincide con el texto visible a 90/180/270° |
| Bajos | ✅ Corregidos | Deshacer hasta lo guardado deja el documento sin cambios (huella SHA-256 de lo guardado); selección de miniaturas ajustada tras borrar/reordenar/duplicar/insertar; contador «…» de la búsqueda; al cerrar la ventana se pregunta por cada documento **con «Guardar»** (respaldo nativo si el renderer no responde); recordatorio anual como mucho una vez al mes y contando desde cada versión; versión de «Acerca de» desde `package.json`; «Recientes» oculta los archivos que ya no existen; cifrado leído del diccionario `/Encrypt` real y marcadores de color contados por trozos (archivos > 512 MB); «Crear campos» renombra los nombres repetidos; Imágenes → PDF con tamaño Carta, A4 o de la imagen; temporales «manipdf-*» borrados al arrancar; CI ejecuta los tests (macOS) | Tests unitarios + E2E (selección, cierre de ventana con Guardar/Cancelar/Descartar) |
| Bajos | ⏸ Sin cambios | CI sigue con `npm install`: decisión documentada en el workflow (con `npm ci`, un lockfile generado en otra plataforma puede dejar fuera los binarios opcionales de rollup/esbuild). Licencias (Ghostscript AGPL, MIT vs «Uso personal»): decisión del autor | — |
| M12 | ✅ Corregido (nuevo) | pdf-lib lee los JPEG ignorando el desplazamiento del Buffer: imágenes JPEG de menos de 4 KB (firmas pequeñas) fallaban con «SOI not found in JPEG». `bytesFromBase64` devuelve un buffer propio | Test de censura con un JPEG mínimo |

Además, al cambiar el zoom se conserva la página que se estaba viendo (antes el visor
saltaba a otra zona del documento).

## Cómo se verificó

1. Lectura completa del código y de la configuración de build/CI.
2. `npm run typecheck` ✔ · `npm test` ✔ (24/24).
3. Banco de pruebas propio (fuera del repo): ejecuta los **servicios reales** de `src/main/services`
   con Electron simulado sobre PDFs generados a medida (formulario + marcadores + enlace interno,
   PDFs cifrados AES-128 y RC4-128, página girada, página con CropBox) y comprueba el resultado con
   pdf.js y con Ghostscript (extracción de texto y render a imagen).
4. Inspección de la app instalada: Ghostscript embebido y OCR ejecutado desde su `app.asar` con el
   propio binario de ManiPDF (`ELECTRON_RUN_AS_NODE`).
5. Prueba E2E de la interfaz: el renderer y el preload **reales** compilados (`out/`) cargados en una
   ventana invisible de Electron con un main simulado; clics reales en la UI, capturas y mediciones.

---

## Fallos reportados por el usuario (2026-10-03)

### U1 · Al hacer zoom, las imágenes de la página se ven deformadas

- **Causa principal (reproducida):** pdf.js 4.10 **desactiva el suavizado** de las imágenes sin
  `/Interpolate` (casi todas) cuando un píxel de la imagen ocupa más de ~1,33 × `devicePixelRatio`
  píxeles de pantalla (`getImageSmoothingEnabled` en `pdfjs-dist/build/pdf.mjs`). Al ampliar, las
  imágenes se dibujan por «vecino más próximo»: bordes en escalera y líneas finas irregulares,
  mientras el texto (vectorial) sigue nítido. Por eso solo se nota en las páginas con imágenes.
  Comparativa al 200 %: actual con escalones; con suavizado forzado, limpia (como Vista Previa o
  Acrobat).
- **Causa adicional en macOS (reproducida):** Cmd + / Cmd − / Cmd 0 no llegan al zoom de la app: los
  captura el menú por defecto de Electron (Ver → Zoom In), que amplía **toda la interfaz** con el zoom
  de Chromium. El bitmap ya pintado se estira (0,76 píxeles de imagen por píxel de pantalla → borroso)
  y el indicador de la app sigue en 100 %. Ver A11.
- **Agravante (código):** el render anterior no se cancela al cambiar el zoom (A7).
- **Dónde:** [pdf-renderer.ts:34-55](../src/renderer/src/services/pdf-renderer.ts#L34-L55),
  [Viewer.tsx:114-130](../src/renderer/src/views/Viewer.tsx#L114-L130),
  [MenuBar.tsx](../src/renderer/src/ui/MenuBar.tsx) (sin atajos de zoom),
  [index.ts:260](../src/main/index.ts#L260) (en macOS se conserva el menú por defecto).

### U2 · Hacer clic en una miniatura no lleva el visor a esa página

- **Estado:** reproducido (clic en la miniatura 9: queda seleccionada, pero el visor sigue en la
  página 1; `scrollTop` 0 → 0).
- **Dónde:** [PagesPanel.tsx:106](../src/renderer/src/views/PagesPanel.tsx#L106): el clic solo llama a
  `select()` (selección para las acciones de página); no navega. Además, `goToPage`
  ([navigate.ts](../src/renderer/src/services/navigate.ts)), usado por marcadores y enlaces, usa
  `scrollIntoView`, que también puede desplazar contenedores padres (la búsqueda ya lo evita a
  propósito por ese motivo).

### U3 · No hay forma de ir directamente a una página (p. ej. la 32)

- **Estado:** confirmado: no existe ningún control de número de página ni indicador de la página
  actual; solo el total («· 12 pág.») en la barra.

---

## Críticos

### C1 · Los PDF «restringidos» quedan ilegibles o en blanco tras cualquier edición

- **Estado:** reproducido (AES-128 y RC4-128).
- **Dónde:** todos los servicios cargan con `ignoreEncryption: true`
  ([document.service.ts:222](../src/main/services/document.service.ts#L222),
  [pages.service.ts:149](../src/main/services/pages.service.ts#L149),
  [annotations.service.ts:43](../src/main/services/annotations.service.ts#L43),
  [combine.service.ts:28](../src/main/services/combine.service.ts#L28)…). pdf.js abre sin pedir
  contraseña los PDF que solo tienen contraseña de propietario
  ([pdf.context.tsx:77](../src/renderer/src/state/pdf.context.tsx#L77)), así que nunca se descifran.
- **Qué pasa:** muchos PDF reales (extractos bancarios, facturas electrónicas, formularios
  oficiales) llevan contraseña de propietario sin contraseña de apertura. pdf-lib no puede
  descifrarlos y los reescribe mezclando objetos cifrados y sin cifrar.
- **Evidencia:**
  - Rotar una página o «Grabar en PDF» → el resultado **no se puede abrir** (pdf.js: «No password
    given»; Ghostscript: «Couldn't initialise file»). En la app aparece «Documento protegido»
    pidiendo una contraseña que no existe; si el usuario pulsa Guardar, **sobrescribe el original
    con un archivo inservible**.
  - Borrar una página → las páginas restantes salen **en blanco** («Page drawing error»).
  - Combinar (y por el mismo motivo Insertar páginas) → las páginas del PDF restringido salen **en
    blanco**.
- **Corrección propuesta:** al abrir, si el PDF está cifrado y pdf.js lo abre sin contraseña,
  descifrarlo en memoria antes de permitir ediciones. Ghostscript con contraseña vacía lo hace bien
  (verificado con ambos cifrados); `@cantoo/pdf-lib` con `{ password: '' }` funcionó con AES pero
  falló con RC4, así que usarlo con validación y caer a Ghostscript. Si no se puede descifrar,
  abrir **en solo lectura** y desactivar las ediciones. Aplicar lo mismo a los PDF de origen de
  Insertar y Combinar.

### C2 · «Censurar» no elimina el contenido: el texto censurado sigue dentro del archivo

- **Estado:** reproducido.
- **Dónde:** [redact.service.ts:41](../src/main/services/redact.service.ts#L41) (`copyPages` de las
  páginas no censuradas). Mismo mecanismo en `rebuild()`
  ([pages.service.ts:139-145](../src/main/services/pages.service.ts#L139-L145)).
- **Qué pasa:** `copyPages` copia en profundidad todo lo que referencia la página, incluidos los
  **enlaces internos**. Si una página no censurada (un índice, por ejemplo) enlaza con la página
  censurada, pdf-lib copia la página original completa, con su contenido, como objeto huérfano. No
  se ve en el visor, pero cualquiera que inspeccione el archivo lo recupera.
- **Evidencia:** PDF de 3 páginas; la 1 enlaza con la 2, que contiene `SECRETO-123`. Tras censurar
  la 2, el visor no muestra texto en ella, pero `SECRETO-123` sigue en el objeto `13 0 R` del
  archivo. Lo mismo al **borrar** la página: su contenido sigue en el archivo.
- **Corrección propuesta:** antes de guardar, eliminar del contexto de pdf-lib los objetos no
  alcanzables desde el trailer (un «recolector» de huérfanos reutilizable en todas las
  reconstrucciones) y quitar de las páginas copiadas los enlaces y destinos que apunten a páginas
  censuradas o borradas. Añadir un test que busque el texto censurado en *todos* los flujos del
  archivo.

### C3 · Borrar, reordenar, duplicar o «Comprimir sin pérdida» eliminan formularios y marcadores

- **Estado:** reproducido.
- **Dónde:** `rebuild()` en [pages.service.ts:139-145](../src/main/services/pages.service.ts#L139-L145)
  y `lossless()` en [optimize.service.ts:37-41](../src/main/services/optimize.service.ts#L37-L41):
  copian las páginas a un `PDFDocument.create()` nuevo, que no hereda el catálogo.
- **Qué pasa:** se pierde todo lo que vive en el catálogo: formulario (AcroForm), marcadores,
  destinos con nombre, etiquetas de página, estructura de accesibilidad, capas, adjuntos, XMP…
- **Evidencia:** documento con 1 campo y 2 marcadores → tras borrar una página: 0 campos y 0
  marcadores; tras reordenar, igual; tras «Comprimir (estructura, sin pérdida)», igual. El archivo
  «comprime» precisamente porque ha tirado esa información. Rotar sí lo conserva todo.
- **Corrección propuesta:** operar sobre el mismo documento: `removePage()` en orden descendente,
  reordenar quitando e insertando los `PDFPage` existentes y duplicar con `pdf.copyPages(pdf, [i])`
  + `insertPage`; después, eliminar los huérfanos (ver C2). En Comprimir, no usar `copyPages`:
  guardar el propio documento con `useObjectStreams` y descartar cualquier resultado (pdf-lib o
  Ghostscript) que pierda AcroForm o marcadores respecto al original.

### C4 · «Proteger» cifra con RC4 de 40 bits según la versión del PDF

- **Estado:** reproducido.
- **Dónde:** [security.service.ts:49](../src/main/services/security.service.ts#L49) y
  [pdf-crypto.ts:72](../src/main/services/pdf-crypto.ts#L72). `@cantoo/pdf-lib` elige el algoritmo
  **según la cabecera del PDF**: 1.3, 2.0 y otras → V1/R2 **RC4 de 40 bits** (rompible por fuerza
  bruta); 1.4/1.5 → RC4-128 (obsoleto); 1.6/1.7 → AES-128.
- **Evidencia:** PDF 1.3 → `/V 1 /R 2`; PDF 2.0 → `/V 1 /R 2`; PDF 1.4 → `/V 2 /R 3 /Length 128`;
  PDF 1.7 → `/V 4` AESV2. Los PDF de macOS (Vista Previa, «Guardar como PDF») son 1.3: en un Mac lo
  habitual es obtener 40 bits.
- **Corrección (verificada):** antes de `encrypt()`, forzar
  `pdf.context.header = PDFHeader.forVersion(1, 7)`. Resultado: `/V 4` AESV2, que se abre
  correctamente con la contraseña. Añadir un test que compruebe `/V ≥ 4`.

---

## Altos

### A1 · Anotaciones, campos nuevos y marcas salen mal colocados en páginas giradas o recortadas

- **Estado:** reproducido.
- **Dónde:** la conversión usa `page.getSize()` (MediaBox) e ignora `/Rotate` y el origen del
  CropBox: [annotations.service.ts:85-92](../src/main/services/annotations.service.ts#L85-L92) y
  [213-224](../src/main/services/annotations.service.ts#L213-L224),
  [forms.service.ts:78-84](../src/main/services/forms.service.ts#L78-L84),
  [stamp.service.ts:44](../src/main/services/stamp.service.ts#L44) y
  [80-83](../src/main/services/stamp.service.ts#L80-L83). El visor (pdf.js) muestra CropBox + rotación.
- **Evidencia** (resaltado dibujado arriba a la izquierda: x 0.05, y 0.05, 30 % × 10 %):
  - página girada con la propia app → aparece **arriba a la derecha y girado** (x 0.85, 10 % × 30 %);
  - página con CropBox → queda casi entera **fuera del área visible** (solo una franja del 3 %);
  - pie centrado «PIE {page}/{total}» en una página girada → aparece **en el borde izquierdo, a
    media altura y girado**.
- **Corrección propuesta:** convertir con la inversa del viewport de la página (CropBox +
  rotación), por ejemplo calculando en el renderer con `viewport.convertToPdfPoint` y enviando
  coordenadas PDF, o replicando la transformación en el main con `getCropBox()` y `getRotation()`.
  Los textos deben girarse con la página.

### A2 · Caracteres fuera de WinAnsi hacen fallar Grabar, Marcas, Formularios y el OCR completo

- **Estado:** reproducido.
- **Dónde:** se usa la fuente estándar Helvetica (solo WinAnsi). `wrapLines` y
  `widthOfTextAtSize` se llaman fuera del `try`
  ([annotations.service.ts:140](../src/main/services/annotations.service.ts#L140) y
  [175](../src/main/services/annotations.service.ts#L175),
  [stamp.service.ts:47](../src/main/services/stamp.service.ts#L47) y
  [94](../src/main/services/stamp.service.ts#L94),
  [ocr.service.ts:118](../src/main/services/ocr.service.ts#L118)); en formularios falla `pdf.save()`
  al regenerar apariencias ([forms.service.ts:60](../src/main/services/forms.service.ts#L60)).
- **Evidencia:** fallan «Total → 10 €», «Revisar 😀», «Expediente Nº 5 — Łódź» y rellenar
  «Łukasz Nowak». En OCR, una sola palabra con la ligadura «ﬁ» o con «→» **aborta el PDF buscable
  entero**. Los acentos y la ñ del español funcionan.
- **Corrección propuesta:** incrustar una fuente Unicode (p. ej. Noto Sans con
  `@pdf-lib/fontkit`) o, como mínimo, sanear el texto antes de medirlo y dibujarlo; en OCR,
  proteger cada palabra por separado.

### A3 · Guardar con anotaciones que fallan al grabarse: se guarda sin ellas y se da por guardado

- **Estado:** análisis de código (el fallo de grabado se reproduce con A2).
- **Dónde:** `apply()` de anotaciones captura el error y no lo relanza
  ([annotations.context.tsx:187-203](../src/renderer/src/state/annotations.context.tsx#L187-L203));
  `save()` y `closeDoc()` continúan tras `flushPending()`
  ([document.store.tsx:413-429](../src/renderer/src/state/document.store.tsx#L413-L429),
  [494-496](../src/renderer/src/state/document.store.tsx#L494-L496)).
- **Qué pasa:** el usuario escribe una nota con «→» y pulsa Cerrar pestaña → Guardar. El grabado
  falla, el aviso dura 5 s, el documento se guarda sin la nota y la pestaña se cierra: **las
  anotaciones se pierden**.
- **Corrección propuesta:** que `apply()` relance el error (o devuelva éxito/fallo) y que guardar y
  cerrar se aborten si el grabado falla.

### A4 · Desbloquear un PDF protegido lo altera y, al guardar, le quita las restricciones

- **Estado:** reproducido.
- **Dónde:** [pdf-crypto.ts:37-46](../src/main/services/pdf-crypto.ts#L37-L46) (re-destila con
  Ghostscript `pdfwrite`), [pdf-crypto.ts:70-86](../src/main/services/pdf-crypto.ts#L70-L86)
  (re-cifra con todos los permisos y propietario = contraseña de apertura) y
  [document.service.ts:118](../src/main/services/document.service.ts#L118) (Exportar copia sin cifrar).
- **Evidencia:** PDF protegido con 1 campo y 2 marcadores → tras desbloquear, **0 campos** (el valor
  «Juan» queda aplanado en la página) y +60 % de tamaño. Al guardar, los permisos pasan de
  `/P -1852` (restringido) a `/P -4` (todo permitido) y la contraseña de propietario original
  desaparece. «Exportar → PDF (copia)» de ese documento sale **sin cifrar**.
- **Corrección propuesta:** descifrar sin pérdidas con `@cantoo/pdf-lib`
  (`load(bytes, { password })`; verificado: conserva campos y marcadores con AES) y usar Ghostscript
  solo como respaldo. Al guardar, conservar el cifrado y los permisos originales (o preguntar) y
  avisar o re-cifrar en Exportar copia.

### A5 · OCR en la app instalada: descarga el modelo cada vez y, sin internet, error no capturado

- **Estado:** reproducido con el binario instalado.
- **Dónde:** [ocr.service.ts:93-95](../src/main/services/ocr.service.ts#L93-L95): `createWorker(lang)`
  sin `cachePath` ni `errorHandler`.
- **Qué pasa:** tesseract.js guarda el modelo en el directorio de trabajo. En macOS la app arranca
  con directorio de trabajo `/`, que no es escribible: nunca se cachea y **cada OCR necesita
  internet** (el manual dice que se descarga una vez). En desarrollo deja `eng.traineddata` y
  `spa.traineddata` en la raíz del repo (están ahí ahora); en Linux, en la carpeta personal. Sin
  conexión, tesseract lanza la excepción dentro de un manejador de eventos: **excepción no
  capturada en el proceso principal** (diálogo de error de Electron) además del error de la
  operación.
- **Corrección propuesta:**
  `createWorker(lang, 1, { cachePath: join(app.getPath('userData'), 'tessdata'), errorHandler })`.
  Mejor aún: empaquetar los `.traineddata` (spa, eng) para que funcione sin conexión.

### A6 · Separación de color: memoria desproporcionada y resultados cruzados

- **Estado:** medición + análisis de código.
- **Dónde:** [separations.context.tsx:129-180](../src/renderer/src/state/separations.context.tsx#L129-L180),
  [separation-utils.ts:55](../src/renderer/src/services/separation-utils.ts#L55) y
  [85](../src/renderer/src/services/separation-utils.ts#L85); el visor solo virtualiza por encima de
  75 páginas ([Viewer.tsx:20](../src/renderer/src/views/Viewer.tsx#L20)).
- **Qué pasa:** cada página carta a 300 ppp genera un TIFF de 32 MB → 43 MB en base64 por IPC →
  **128 MB** en Float32Array (4 planchas) + 32 MB de composición. En documentos de hasta 75 páginas
  se piden **todas a la vez**, con un Ghostscript por página en paralelo: 10 páginas ≈ 1,6 GB y
  20 páginas ≈ 3,2 GB → la ventana se congela o el renderer se cae. Además, la caché se indexa solo
  por número de página: un render en curso que termina tras cambiar de documento o de modo
  (CMYK↔RGB) **pinta las planchas del documento o del modo anterior**.
- **Corrección propuesta:** renderizar solo las páginas visibles y en cola (1-2 Ghostscript a la
  vez), guardar las planchas en Uint8Array, previsualizar a ~150 ppp, limitar la caché (LRU) e
  invalidar resultados con un contador de generación (documento + modo + ppp).

### A7 · Visor: páginas en blanco o cortadas al cambiar el zoom rápido; memoria sin límite

- **Estado:** análisis de código (pdf.js 4.10 lanza «Cannot use the same canvas during multiple
  render() operations»).
- **Dónde:** [Viewer.tsx:114-130](../src/renderer/src/views/Viewer.tsx#L114-L130) y
  [pdf-renderer.ts:34-55](../src/renderer/src/services/pdf-renderer.ts#L34-L55): el efecto no
  cancela el `RenderTask` anterior, redimensiona el canvas mientras todavía se dibuja y el error se
  ignora en silencio. La capa de texto tampoco se cancela.
- **Qué pasa:** pulsar «+» varias veces, o editar mientras se pinta, deja páginas en blanco, a otra
  escala o con el texto seleccionable duplicado y desalineado. Además, hasta 75 páginas se pintan
  todas: en una pantalla Retina, cada página carta ocupa ~7 MB al 100 % y ~118 MB al 400 %, así que
  75 páginas al 400 % rondan los 9 GB.
- **Corrección propuesta:** guardar el `RenderTask` y llamar a `cancel()` en la limpieza (y
  `TextLayer.cancel()`), pintar en un canvas nuevo y sustituir al terminar, y virtualizar siempre
  (o según un presupuesto de píxeles, no por número de páginas).

### A8 · Arrastrar miniaturas: soltar sobre la página siguiente no hace nada; no se puede mover al final

- **Estado:** reproducido (lógica de
  [pages.context.tsx:142-147](../src/renderer/src/state/pages.context.tsx#L142-L147)).
- **Evidencia:** pág. 1 sobre pág. 2 → `[0,1,2]` (sin cambios); pág. 2 sobre pág. 3 → sin cambios;
  pág. 1 sobre pág. 3 → queda en 2.ª posición. Aun así se envía la operación, que reconstruye el PDF
  (y provoca C3) y añade un paso de deshacer vacío.
- **Corrección propuesta:** insertar en la posición del destino (`order.splice(to, 0, from)` tras
  quitar `from`) o mostrar una línea de inserción antes/después; ignorar movimientos nulos.

### A9 · Exportar en grises a un nombre con «%» falla y crea otro archivo

- **Estado:** reproducido.
- **Dónde:** [separations.service.ts:59](../src/main/services/separations.service.ts#L59) pasa la ruta
  elegida tal cual a `-sOutputFile`; Ghostscript interpreta `%d` como número de página.
- **Evidencia:** destino «Oferta 50%descuento.pdf» → error «Fallo al exportar a negro» y aparece
  «Oferta 501escuento.pdf».
- **Corrección propuesta:** escribir siempre en un temporal sin «%» y moverlo después a la ruta
  final (o escapar `%` como `%%`).

### A10 · Mac Intel: el instalador x64 lleva el Ghostscript de Apple Silicon

- **Estado:** configuración + código.
- **Dónde:** la CI usa `macos-latest` (arm64) y solo genera `resources/gs/darwin-arm64`;
  [electron-builder.yml](../electron-builder.yml) construye DMG x64 y arm64 con esa misma carpeta;
  [ghostscript.ts:32-52](../src/main/services/ghostscript.ts#L32-L52) busca exactamente `darwin-x64`.
- **Qué pasa:** en un Mac Intel, la separación de color, exportar en grises, desbloquear PDFs y la
  compresión con Ghostscript no funcionan salvo que el usuario tenga Ghostscript de Homebrew (y el
  DMG carga decenas de MB inútiles).
- **Corrección propuesta:** empaquetar Ghostscript por arquitectura (job adicional en un runner
  x64 o binario universal con `lipo`) o publicar solo arm64.

### A11 · macOS: el menú por defecto de Electron permite recargar la app y perder el trabajo

- **Estado:** menú reproducido (listado desde Electron); efecto por análisis de código.
- **Dónde:** [index.ts:260](../src/main/index.ts#L260) solo quita el menú en Windows/Linux; en macOS
  queda el de Electron: Ver → **Reload (Cmd+R)**, Force Reload, **Toggle Developer Tools**, Zoom
  In/Out; Archivo → Close Window; Ayuda → enlaces a electronjs.org.
- **Qué pasa:** un Cmd+R accidental recarga la interfaz sin avisar: se cierran todas las pestañas y
  se pierden las ediciones no guardadas (el main sigue guardando los documentos en memoria). Tras la
  recarga la marca de «cambios sin guardar» vuelve a `false`, así que cerrar la ventana ya no avisa.
  Cmd +/− amplía toda la interfaz (ver U1) y cualquiera puede abrir las herramientas de desarrollo en
  la app instalada.
- **Corrección propuesta:** definir un menú propio de macOS (ManiPDF, Edición con los roles de
  copiar/pegar, Ventana), sin recarga, zoom de Chromium ni herramientas de desarrollo en producción;
  gestionar Cmd/Ctrl +, − y 0 como zoom del visor.

---

## Medios

| ID | Hallazgo | Dónde | Estado | Corrección |
|----|----------|-------|--------|------------|
| M1 | **Carreras entre operaciones.** Cada servicio lee `doc.bytes`, espera y luego reemplaza: dos operaciones a la vez (p. ej. «PDF buscable», que tarda minutos, y rotar desde el panel) pierden una de las dos. **Deshacer** con Cmd+Z mantenido usa un historial obsoleto: restaura dos veces el mismo estado y pierde un paso. | servicios del main; [document.store.tsx:520-542](../src/renderer/src/state/document.store.tsx#L520-L542) | código | Cola o mutex por documento en el main; bloquear deshacer mientras haya una restauración en curso. |
| M2 | **Exportar, Imprimir, Proteger y Dividir ignoran lo no grabado** (anotaciones, campos y censuras pendientes). Solo Guardar lo graba. | [ExportDialog.tsx:79](../src/renderer/src/ui/ExportDialog.tsx#L79), [document.store.tsx:445](../src/renderer/src/state/document.store.tsx#L445) | código | Llamar a `flushPending()` (o preguntar) antes de estas acciones. |
| M3 | **Guardado no atómico** y `restore()` reemplaza los bytes **antes** de validarlos: tras un `restore` inválido, Guardar escribe un archivo de 3 bytes sobre el original (probado). | [file.service.ts:112](../src/main/services/file.service.ts#L112), [document.service.ts:129-133](../src/main/services/document.service.ts#L129-L133) | reproducido | Validar antes de reemplazar; escribir en un temporal y hacer `rename`. |
| M4 | **Las exportaciones sobrescriben sin avisar** (`pagina-01.png`, `…-parte-01.pdf`, planchas). | [convert.service.ts:38-41](../src/main/services/convert.service.ts#L38-L41), [combine.service.ts:79-80](../src/main/services/combine.service.ts#L79-L80), [separations.service.ts:83-85](../src/main/services/separations.service.ts#L83-L85) | código | Comprobar si existe y preguntar, o crear una subcarpeta con el nombre del documento. |
| M5 | **Exportar a imágenes** rasteriza todas las páginas en memoria y las envía de golpe: a 600 ppp, un documento largo agota la memoria, y las páginas grandes (A0) superan el límite de canvas, de modo que `toDataURL` devuelve vacío y se escriben **imágenes de 0 bytes** sin error. | [ExportDialog.tsx:81-85](../src/renderer/src/ui/ExportDialog.tsx#L81-L85), [pdf-renderer.ts:141-166](../src/renderer/src/services/pdf-renderer.ts#L141-L166) | código | Enviar página a página, validar que la imagen no esté vacía y limitar los ppp según el tamaño. |
| M6 | **Búsqueda:** solo encuentra coincidencias dentro de un mismo fragmento de texto (las frases partidas no aparecen); los resaltados y los **enlaces** quedan mal colocados en páginas giradas o con CropBox; cada pulsación vuelve a recorrer todo el documento. | [search.context.tsx:110-145](../src/renderer/src/state/search.context.tsx#L110-L145), [LinkLayer.tsx:75-80](../src/renderer/src/views/LinkLayer.tsx#L75-L80) | código | Concatenar el texto de cada página con un mapa de offsets; usar `viewport.convertToViewportRectangle`; cachear el texto por página. |
| M7 | **macOS: abrir un PDF desde Finder con la app abierta pero sin ventanas no hace nada** (queda en cola hasta pulsar el Dock). | [index.ts:50-58](../src/main/index.ts#L50-L58), [224-227](../src/main/index.ts#L224-L227), [270-272](../src/main/index.ts#L270-L272) | código | En `openInRenderer`, crear la ventana si no existe. |
| M8 | **Diálogo Proteger engañoso:** dice «si se deja vacía, = apertura», pero se genera una contraseña de propietario aleatoria (nadie podrá cambiar los permisos); recorta espacios de la contraseña; no pide confirmarla. | [SecurityDialog.tsx:123](../src/renderer/src/ui/SecurityDialog.tsx#L123), [security.service.ts:28](../src/main/services/security.service.ts#L28) y [46](../src/main/services/security.service.ts#L46) | código | Corregir el texto, no recortar y pedir confirmación. |
| M9 | **Desbloqueo:** cualquier fallo de Ghostscript se muestra como «Contraseña incorrecta» aunque pdf.js ya validó la contraseña; la contraseña viaja en la línea de comandos de Ghostscript (visible con `ps`). | [pdf.context.tsx:208-215](../src/renderer/src/state/pdf.context.tsx#L208-L215), [pdf-crypto.ts:41](../src/main/services/pdf-crypto.ts#L41) | código | Distinguir los errores; con contraseña válida, caer a solo lectura; pasar la contraseña por un archivo de argumentos temporal. |
| M10 | **«PDF buscable» rasteriza todo el documento** a 144 ppp en JPEG (pierde vectores, enlaces y formularios), también las páginas que ya tenían texto; sin progreso ni cancelación. | [OcrDialog.tsx:11](../src/renderer/src/ui/OcrDialog.tsx#L11), [ocr.service.ts:55-72](../src/main/services/ocr.service.ts#L55-L72) | código | Añadir la capa de texto sobre las páginas originales (o solo en las que no tienen texto) y mostrar progreso. |
| M11 | **Seguridad del contenedor:** Electron 33 ya no recibe parches y la app abre PDF no confiables; `sandbox: false` es innecesario; `shell.openExternal` no valida el esquema en el main. | [package.json](../package.json), [index.ts:184](../src/main/index.ts#L184), [209-212](../src/main/index.ts#L209-L212) | código | Actualizar Electron a una versión con soporte; `sandbox: true`; permitir solo `http(s)` y `mailto` en el main. |

---

## Bajos

- Tras deshacer hasta el estado original, el documento sigue marcado como modificado
  ([document.model.ts:46](../src/main/domain/document.model.ts#L46)).
- Tras borrar o reordenar páginas, la selección apunta a otras páginas (riesgo de borrar la
  siguiente sin querer) ([pages.context.tsx:44-46](../src/renderer/src/state/pages.context.tsx#L44-L46)).
- El contador de búsqueda puede quedarse en «…» si se borra rápido la consulta
  ([search.context.tsx:58-81](../src/renderer/src/state/search.context.tsx#L58-L81)).
- Al cerrar la ventana con cambios, el diálogo nativo no ofrece «Guardar»
  ([index.ts:193-206](../src/main/index.ts#L193-L206)).
- El recordatorio de «más de un año» aparece en cada arranque, sin posponer
  ([index.ts:295-308](../src/main/index.ts#L295-L308)).
- Versión escrita a mano en «Acerca de» ([AboutDialog.tsx:8](../src/renderer/src/ui/AboutDialog.tsx#L8));
  mejor `app.getVersion()`.
- «Recientes» conserva archivos que ya no existen.
- `detectEncrypted` busca `/Encrypt` en todo el archivo (falsos positivos), y
  `detectColorLabel`/`detectColorSpace` convierten el archivo entero a string (falla con PDF de más
  de 512 MB).
- «Crear campos» omite en silencio los nombres que ya existen en el PDF
  ([forms.service.ts:77](../src/main/services/forms.service.ts#L77)).
- Imágenes → PDF fuerza el tamaño Carta (en España y buena parte de Latinoamérica se espera A4 o
  «ajustar a la imagen»).
- Los temporales con contenido descifrado (imprimir, desbloquear) quedan en disco si la app se
  cierra de golpe.
- CI: no ejecuta `npm test` y usa `npm install` (no reproducible) en vez de `npm ci`.
- Documentación desactualizada: [api.md](api.md) aún describe `dataBase64`, `tiffsep` y planchas por
  tinta; no lista `unlock`, `print`, `export-copy`, `restore` ni `separations:export*`, ni los códigos
  `WRONG_PASSWORD`, `DECRYPT_UNSUPPORTED` y `GHOSTSCRIPT_MISSING`. El README dice que Ghostscript
  solo se usa para la separación. Faltan `database.md` y `mobile_flow.md`, que exige CLAUDE.md (no
  aplican a esta app: conviene declararlo).
- Licencias: Ghostscript es AGPL y enlazar a ghostscript.com no identifica el código fuente exacto
  de la versión distribuida; además, package.json dice MIT y «Acerca de» dice «Uso personal».

---

## Plan de corrección propuesto

0. **Fallos reportados por el usuario:** U1 (con A7 y A11), U2 y U3.
1. **Integridad y seguridad de los datos:** C1, C2, C3, C4, A4 y M3. Incluye convertir el
   banco de pruebas de esta auditoría en tests de regresión del repo (vitest con `electron` simulado).
2. **Fallos visibles del uso diario:** A1, A2, A3, A7, A8, A9 y M2.
3. **Rendimiento y plataforma:** A5, A6, A10, M1 y M5.
4. **Resto** (M4, M6-M11 y bajos) y actualización de `/docs`.
