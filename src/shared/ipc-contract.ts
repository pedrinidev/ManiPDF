/**
 * CONTRATO IPC — única fuente de verdad de la comunicación Renderer <-> Main.
 *
 * Tanto la UI (renderer) como los handlers (main) importan estos tipos.
 * Si cambias una firma aquí, TypeScript te obliga a actualizar ambos lados:
 * ese es el objetivo arquitectónico (acoplamiento explícito y seguro).
 */

/** Canales IPC disponibles. Agrupados por módulo de dominio. */
export const IpcChannel = {
  // Módulo: document
  DocumentOpen: 'document:open',
  DocumentOpenPath: 'document:open-path',
  DocumentSave: 'document:save',
  DocumentSaveAs: 'document:save-as',
  DocumentMetadata: 'document:metadata',
  DocumentClose: 'document:close',
  DocumentPrint: 'document:print',
  DocumentExportCopy: 'document:export-copy',
  DocumentRestore: 'document:restore',

  // Módulo: pages
  PagesRotate: 'pages:rotate',
  PagesDelete: 'pages:delete',
  PagesReorder: 'pages:reorder',
  PagesDuplicate: 'pages:duplicate',
  PagesInsert: 'pages:insert',
  PagesExtract: 'pages:extract',

  // Módulo: annotations
  AnnotationsBurn: 'annotations:burn',
  AnnotationsPickImage: 'annotations:pick-image',

  // Módulo: security
  SecurityProtect: 'security:protect',

  // Módulo: optimize
  OptimizeLossless: 'optimize:lossless',
  OptimizeRebuildFromImages: 'optimize:rebuild-images',

  // Módulo: convert
  ConvertExportImages: 'convert:export-images',
  ConvertImagesToPdf: 'convert:images-to-pdf',

  // Módulo: forms
  FormsList: 'forms:list',
  FormsFill: 'forms:fill',
  FormsCreate: 'forms:create',

  // Módulo: ocr
  OcrExtract: 'ocr:extract',
  OcrSearchable: 'ocr:searchable',
  OcrSaveText: 'ocr:save-text',

  // Módulo: stamp (marca de agua, encabezado/pie, numeración)
  StampApply: 'stamp:apply',

  // Módulo: redact
  RedactApply: 'redact:apply',

  // Módulo: combine (unir varios / dividir)
  CombineMerge: 'combine:merge',
  CombineSplit: 'combine:split',

  // Módulo: compare
  ComparePick: 'compare:pick',

  // Módulo: separations (separación de colores con Ghostscript)
  SeparationsRender: 'separations:render',
  SeparationsExport: 'separations:export',
  SeparationsExportGray: 'separations:export-gray'
} as const

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel]

/** Resultado uniforme de toda operación IPC: nunca lanzamos a través del puente. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcError }

export interface IpcError {
  code: IpcErrorCode
  message: string
}

export type IpcErrorCode =
  | 'CANCELLED' // el usuario cerró un diálogo
  | 'NOT_FOUND' // archivo inexistente
  | 'INVALID_PDF' // archivo no es un PDF válido
  | 'IO_ERROR' // fallo de lectura/escritura
  | 'NO_DOCUMENT' // operación sobre documento que no está abierto
  | 'UNKNOWN'

// ---------------------------------------------------------------------------
// DTOs (Data Transfer Objects) — lo que viaja por el puente IPC.
// Son objetos planos serializables (sin clases, sin Buffers crudos grandes).
// ---------------------------------------------------------------------------

/** Identifica un documento abierto en la sesión del main process. */
export type DocumentId = string

/** Metadatos visibles del documento. */
/** Un tamaño de página presente en el documento y cuántas páginas lo usan. */
export interface PageSizeGroup {
  widthPt: number
  heightPt: number
  /** Etiqueta lista para mostrar, p. ej. "21.6 × 27.9 cm · Carta". */
  label: string
  count: number
}

export interface DocumentMetadataDTO {
  title: string | null
  author: string | null
  subject: string | null
  keywords: string | null
  creator: string | null
  producer: string | null
  creationDate: string | null
  modificationDate: string | null
  /** Número de páginas. */
  pageCount: number
  /** Tamaño del archivo en bytes. */
  fileSize: number
  /** Versión del PDF (p. ej. "1.7"), o null si no se detecta. */
  pdfVersion: string | null
  /** Si el documento está cifrado. */
  encrypted: boolean
  /** Espacio(s) de color detectado(s), etiqueta legible (heurístico). */
  colorSpace: string
  /** Tamaños de página agrupados (uno por tamaño distinto). */
  pageSizes: PageSizeGroup[]
}

/** Giro relativo a aplicar a una página, en grados (múltiplos de 90). */
export type RotationDelta = 90 | 180 | 270 | -90

/** Resumen de un documento recién abierto que necesita el renderer. */
export interface OpenDocumentDTO {
  id: DocumentId
  filePath: string | null
  fileName: string
  pageCount: number
  /** Bytes del PDF en base64 para que pdf.js lo renderice en el renderer. */
  dataBase64: string
  isDirty: boolean
}

// ---------------------------------------------------------------------------
// Anotaciones. Todas las coordenadas son NORMALIZADAS al tamaño de la página
// (0..1), con el origen arriba-izquierda (estilo pantalla). Así son
// independientes del zoom; el backend las convierte a puntos PDF al grabarlas.
// ---------------------------------------------------------------------------

export type AnnotationColor = string // hex, p. ej. '#ffeb3b'

/** Área rectangular normalizada (x,y = esquina superior izquierda). */
export interface RectArea {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

interface BaseAnnotation {
  id: string
  page: number // 1-based
  color: AnnotationColor
}

export interface HighlightAnnotation extends BaseAnnotation {
  type: 'highlight'
  rect: RectArea
}
export interface UnderlineAnnotation extends BaseAnnotation {
  type: 'underline'
  rect: RectArea
}
export interface RectAnnotation extends BaseAnnotation {
  type: 'rect'
  rect: RectArea
}
export interface InkAnnotation extends BaseAnnotation {
  type: 'ink'
  points: Point[]
  width: number // grosor, fracción del ancho de página
}
export interface NoteAnnotation extends BaseAnnotation {
  type: 'note'
  pos: Point
  text: string
}
export interface TextAnnotation extends BaseAnnotation {
  type: 'text'
  pos: Point
  text: string
  /** Tamaño de fuente como fracción de la altura de página. */
  size: number
}
export interface ImageAnnotation extends BaseAnnotation {
  type: 'image'
  rect: RectArea
  /** Imagen (firma) en base64, sin prefijo data:. */
  dataBase64: string
  format: 'png' | 'jpg'
}

export type Annotation =
  | HighlightAnnotation
  | UnderlineAnnotation
  | RectAnnotation
  | InkAnnotation
  | NoteAnnotation
  | TextAnnotation
  | ImageAnnotation

export type AnnotationType = Annotation['type']

// ---------------------------------------------------------------------------
// Seguridad: cifrado del PDF con contraseña y permisos.
// ---------------------------------------------------------------------------

/** Permisos que se conceden al abrir con la contraseña de usuario. */
export interface SecurityPermissions {
  printing: boolean
  copying: boolean
  modifying: boolean
}

export interface ProtectOptions {
  /** Contraseña necesaria para abrir el documento. */
  userPassword: string
  /** Contraseña con acceso total (cambiar permisos). Si se omite, se usa la de usuario. */
  ownerPassword?: string
  permissions: SecurityPermissions
}

// ---------------------------------------------------------------------------
// Optimización / compresión.
// ---------------------------------------------------------------------------

/** Una página ya rasterizada en el renderer, lista para reensamblar en el main. */
export interface RasterPage {
  /** Imagen JPEG de la página, en base64 (sin el prefijo data:). */
  jpegBase64: string
  /** Dimensiones de la página en puntos PDF (1/72"). */
  widthPt: number
  heightPt: number
}

// ---------------------------------------------------------------------------
// Conversión PDF <-> imágenes.
// ---------------------------------------------------------------------------

export type ImageFormat = 'png' | 'jpg'

// ---------------------------------------------------------------------------
// Formularios.
// ---------------------------------------------------------------------------

export type FormFieldType =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'optionlist'
  | 'button'
  | 'signature'
  | 'unknown'

/** Un campo de formulario tal como lo ve la UI. */
export interface FormFieldDTO {
  name: string
  type: FormFieldType
  /** Valor textual actual (vacío si no aplica). */
  value: string
  /** Estado actual para checkbox. */
  checked: boolean
  /** Opciones disponibles para radio/dropdown/optionlist. */
  options: string[]
  /** true si el campo no es editable (button/signature). */
  readOnly: boolean
}

/** Valor a escribir en un campo al rellenar. */
export interface FormFieldValue {
  name: string
  value: string | boolean
}

/** Definición de un campo nuevo a crear (coordenadas normalizadas 0..1, origen arriba). */
export interface NewFormField {
  type: 'text' | 'checkbox' | 'dropdown'
  name: string
  page: number // 1-based
  rect: RectArea
  options: string[] // solo para dropdown
}

// ---------------------------------------------------------------------------
// OCR (reconocimiento de texto). El renderer rasteriza; el main hace el OCR
// (tesseract.js en Node) y ensambla el PDF buscable.
// ---------------------------------------------------------------------------

export type OcrLang = 'spa' | 'eng'

/** Página rasterizada que se envía al main para OCR / PDF buscable. */
export interface OcrInputPage {
  jpegBase64: string
  widthPt: number
  heightPt: number
  imgWidthPx: number
  imgHeightPx: number
}

// ---------------------------------------------------------------------------
// Sellos: marca de agua, encabezado/pie y numeración de páginas.
// En los textos se admiten placeholders: {page}, {total}, {date}.
// ---------------------------------------------------------------------------

/** Texto en tres posiciones (izquierda / centro / derecha) de un encabezado o pie. */
export interface HeaderFooter {
  left: string
  center: string
  right: string
}

export interface StampConfig {
  /** Marca de agua (vacío = no se aplica). */
  watermarkText: string
  watermarkOpacity: number // 0..1
  watermarkColor: string // hex
  watermarkDiagonal: boolean
  header: HeaderFooter
  footer: HeaderFooter
  hfFontSize: number // tamaño de fuente de encabezado/pie en puntos
  hfColor: string // hex
  margin: number // margen desde el borde, en puntos
}

// ---------------------------------------------------------------------------
// Redacción: las páginas con zonas a tachar se rasterizan (con los recuadros
// negros quemados) y reemplazan a la original; así el contenido bajo el recuadro
// desaparece de verdad. Las páginas sin redacción se conservan intactas.
// ---------------------------------------------------------------------------

export interface RedactedPage {
  pageIndex: number // 0-based
  jpegBase64: string
  widthPt: number
  heightPt: number
}

// ---------------------------------------------------------------------------
// Separación de colores (prepress). Ghostscript genera una plancha por tinta
// (CMYK + tintas planas) como TIFF en escala de grises; el renderer las muestra.
// ---------------------------------------------------------------------------

/** Espacio de color en el que se separa una página. */
export type SeparationSpace = 'cmyk' | 'rgb'
/** Modo elegido por el usuario: 'auto' detecta el espacio original del documento. */
export type SeparationMode = 'auto' | SeparationSpace

/** Cobertura de tinta (fracción 0..1) por canal de proceso, medida con Ghostscript inkcov. */
export interface InkCoverage {
  c: number
  m: number
  y: number
  k: number
}

/** Mapa de canal -> firma (request, response). Habilita tipado fuerte del bridge. */
export interface IpcApi {
  [IpcChannel.DocumentOpen]: {
    request: void
    response: IpcResult<OpenDocumentDTO>
  }
  [IpcChannel.DocumentOpenPath]: {
    request: { filePath: string }
    response: IpcResult<OpenDocumentDTO>
  }
  [IpcChannel.DocumentSave]: {
    request: { id: DocumentId }
    response: IpcResult<{ filePath: string }>
  }
  [IpcChannel.DocumentSaveAs]: {
    request: { id: DocumentId }
    response: IpcResult<{ filePath: string }>
  }
  [IpcChannel.DocumentMetadata]: {
    request: { id: DocumentId }
    response: IpcResult<DocumentMetadataDTO>
  }
  [IpcChannel.DocumentClose]: {
    request: { id: DocumentId }
    response: IpcResult<{ id: DocumentId }>
  }
  // Abre el diálogo de impresión nativo del SO con el documento actual.
  [IpcChannel.DocumentPrint]: {
    request: { id: DocumentId }
    response: IpcResult<{ printed: boolean }>
  }
  // Exporta una COPIA del documento actual (con sus cambios aplicados) a un PDF
  // nuevo, sin cambiar el archivo asociado a la pestaña.
  [IpcChannel.DocumentExportCopy]: {
    request: { id: DocumentId }
    response: IpcResult<{ filePath: string }>
  }
  // Restaura los bytes del documento a un estado anterior (deshacer/rehacer).
  [IpcChannel.DocumentRestore]: {
    request: { id: DocumentId; dataBase64: string }
    response: IpcResult<OpenDocumentDTO>
  }

  // -- pages --
  // Las operaciones que mutan el documento devuelven el OpenDocumentDTO
  // actualizado (nuevos bytes, pageCount e isDirty) para que la UI se refresque.
  [IpcChannel.PagesRotate]: {
    request: { id: DocumentId; pageIndices: number[]; delta: RotationDelta }
    response: IpcResult<OpenDocumentDTO>
  }
  [IpcChannel.PagesDelete]: {
    request: { id: DocumentId; pageIndices: number[] }
    response: IpcResult<OpenDocumentDTO>
  }
  [IpcChannel.PagesReorder]: {
    request: { id: DocumentId; order: number[] }
    response: IpcResult<OpenDocumentDTO>
  }
  [IpcChannel.PagesDuplicate]: {
    request: { id: DocumentId; pageIndices: number[] }
    response: IpcResult<OpenDocumentDTO>
  }
  [IpcChannel.PagesInsert]: {
    request: { id: DocumentId; atIndex: number }
    response: IpcResult<OpenDocumentDTO>
  }
  [IpcChannel.PagesExtract]: {
    request: { id: DocumentId; pageIndices: number[] }
    response: IpcResult<{ filePath: string }>
  }

  // -- annotations --
  // Graba ("burn") las anotaciones en el contenido del PDF y devuelve el doc
  // actualizado. Tras grabar, la capa de overlay del renderer se vacía.
  [IpcChannel.AnnotationsBurn]: {
    request: { id: DocumentId; annotations: Annotation[] }
    response: IpcResult<OpenDocumentDTO>
  }
  [IpcChannel.AnnotationsPickImage]: {
    request: void
    response: IpcResult<{ dataBase64: string; format: 'png' | 'jpg' }>
  }

  // -- security --
  // Exporta una COPIA cifrada del documento (no altera el abierto en sesión,
  // que sigue siendo visible sin contraseña en el visor).
  [IpcChannel.SecurityProtect]: {
    request: { id: DocumentId; options: ProtectOptions }
    response: IpcResult<{ filePath: string }>
  }

  // -- optimize --
  // Ambas reemplazan el documento en sesión por su versión optimizada.
  [IpcChannel.OptimizeLossless]: {
    request: { id: DocumentId }
    response: IpcResult<OpenDocumentDTO>
  }
  [IpcChannel.OptimizeRebuildFromImages]: {
    request: { id: DocumentId; pages: RasterPage[] }
    response: IpcResult<OpenDocumentDTO>
  }

  // -- convert --
  // PDF -> imágenes: el renderer rasteriza cada página y el main las escribe en
  // una carpeta elegida por el usuario.
  [IpcChannel.ConvertExportImages]: {
    request: { format: ImageFormat; images: string[] } // base64 en orden de página
    response: IpcResult<{ dir: string; count: number }>
  }
  // Imágenes -> PDF: independiente del documento abierto. El main pide los
  // archivos de imagen y ensambla un PDF (una página por imagen).
  [IpcChannel.ConvertImagesToPdf]: {
    request: void
    response: IpcResult<{ filePath: string }>
  }

  // -- forms --
  [IpcChannel.FormsList]: {
    request: { id: DocumentId }
    response: IpcResult<FormFieldDTO[]>
  }
  [IpcChannel.FormsFill]: {
    request: { id: DocumentId; values: FormFieldValue[]; flatten: boolean }
    response: IpcResult<OpenDocumentDTO>
  }
  [IpcChannel.FormsCreate]: {
    request: { id: DocumentId; fields: NewFormField[] }
    response: IpcResult<OpenDocumentDTO>
  }

  // -- ocr --
  [IpcChannel.OcrExtract]: {
    request: { lang: OcrLang; images: string[] } // base64 por página
    response: IpcResult<{ text: string }>
  }
  [IpcChannel.OcrSearchable]: {
    request: { id: DocumentId; lang: OcrLang; pages: OcrInputPage[] }
    response: IpcResult<OpenDocumentDTO>
  }
  [IpcChannel.OcrSaveText]: {
    request: { text: string }
    response: IpcResult<{ filePath: string }>
  }

  // -- stamp --
  [IpcChannel.StampApply]: {
    request: { id: DocumentId; config: StampConfig }
    response: IpcResult<OpenDocumentDTO>
  }

  // -- redact --
  [IpcChannel.RedactApply]: {
    request: { id: DocumentId; pages: RedactedPage[] }
    response: IpcResult<OpenDocumentDTO>
  }

  // -- combine --
  // merge: elige varios PDF y los une en uno nuevo. split: parte el documento
  // actual en archivos de `everyN` páginas (1 = una página por archivo).
  [IpcChannel.CombineMerge]: {
    request: void
    response: IpcResult<{ filePath: string; pageCount: number }>
  }
  [IpcChannel.CombineSplit]: {
    request: { id: DocumentId; everyN: number }
    response: IpcResult<{ dir: string; count: number }>
  }

  // -- compare --
  // Elige un segundo PDF y devuelve sus bytes para compararlo en el renderer.
  [IpcChannel.ComparePick]: {
    request: void
    response: IpcResult<{ dataBase64: string; fileName: string }>
  }

  // -- separations --
  // Rasteriza la página al espacio adecuado (CMYK con tiff32nc, RGB con tiff24nc)
  // y devuelve el TIFF en base64 + el espacio usado; el renderer separa los canales.
  // mode='auto' detecta el espacio original del documento.
  [IpcChannel.SeparationsRender]: {
    request: { id: DocumentId; pageNumber: number; dpi: number; mode: SeparationMode }
    response: IpcResult<{ space: SeparationSpace; tiffBase64: string }>
  }
  [IpcChannel.SeparationsExport]: {
    request: { files: { name: string; pngBase64: string }[] }
    response: IpcResult<{ dir: string; count: number }>
  }
  // Exporta el documento completo a PDF en grises = una sola tinta negra (canal
  // K), vectorial. Devuelve también la cobertura de tinta medida para verificar
  // que C/M/Y quedan a cero.
  [IpcChannel.SeparationsExportGray]: {
    request: { id: DocumentId }
    response: IpcResult<{ filePath: string; ink: InkCoverage | null }>
  }
}

// ---------------------------------------------------------------------------
// API expuesta al renderer (window.api). Fuente única compartida por el
// preload (que la implementa) y el renderer (que la consume).
// ---------------------------------------------------------------------------

export interface AppApi {
  document: {
    open(): Promise<IpcResult<OpenDocumentDTO>>
    openPath(filePath: string): Promise<IpcResult<OpenDocumentDTO>>
    save(id: DocumentId): Promise<IpcResult<{ filePath: string }>>
    saveAs(id: DocumentId): Promise<IpcResult<{ filePath: string }>>
    metadata(id: DocumentId): Promise<IpcResult<DocumentMetadataDTO>>
    close(id: DocumentId): Promise<IpcResult<{ id: DocumentId }>>
    print(id: DocumentId): Promise<IpcResult<{ printed: boolean }>>
    exportCopy(id: DocumentId): Promise<IpcResult<{ filePath: string }>>
    restore(id: DocumentId, dataBase64: string): Promise<IpcResult<OpenDocumentDTO>>
  }
  pages: {
    rotate(
      id: DocumentId,
      pageIndices: number[],
      delta: RotationDelta
    ): Promise<IpcResult<OpenDocumentDTO>>
    remove(id: DocumentId, pageIndices: number[]): Promise<IpcResult<OpenDocumentDTO>>
    reorder(id: DocumentId, order: number[]): Promise<IpcResult<OpenDocumentDTO>>
    duplicate(id: DocumentId, pageIndices: number[]): Promise<IpcResult<OpenDocumentDTO>>
    insert(id: DocumentId, atIndex: number): Promise<IpcResult<OpenDocumentDTO>>
    extract(id: DocumentId, pageIndices: number[]): Promise<IpcResult<{ filePath: string }>>
  }
  annotations: {
    burn(id: DocumentId, annotations: Annotation[]): Promise<IpcResult<OpenDocumentDTO>>
    pickImage(): Promise<IpcResult<{ dataBase64: string; format: 'png' | 'jpg' }>>
  }
  security: {
    protect(id: DocumentId, options: ProtectOptions): Promise<IpcResult<{ filePath: string }>>
  }
  optimize: {
    lossless(id: DocumentId): Promise<IpcResult<OpenDocumentDTO>>
    rebuildFromImages(id: DocumentId, pages: RasterPage[]): Promise<IpcResult<OpenDocumentDTO>>
  }
  convert: {
    exportImages(
      format: ImageFormat,
      images: string[]
    ): Promise<IpcResult<{ dir: string; count: number }>>
    imagesToPdf(): Promise<IpcResult<{ filePath: string }>>
  }
  forms: {
    list(id: DocumentId): Promise<IpcResult<FormFieldDTO[]>>
    fill(
      id: DocumentId,
      values: FormFieldValue[],
      flatten: boolean
    ): Promise<IpcResult<OpenDocumentDTO>>
    create(id: DocumentId, fields: NewFormField[]): Promise<IpcResult<OpenDocumentDTO>>
  }
  ocr: {
    extract(lang: OcrLang, images: string[]): Promise<IpcResult<{ text: string }>>
    searchable(
      id: DocumentId,
      lang: OcrLang,
      pages: OcrInputPage[]
    ): Promise<IpcResult<OpenDocumentDTO>>
    saveText(text: string): Promise<IpcResult<{ filePath: string }>>
  }
  stamp: {
    apply(id: DocumentId, config: StampConfig): Promise<IpcResult<OpenDocumentDTO>>
  }
  redact: {
    apply(id: DocumentId, pages: RedactedPage[]): Promise<IpcResult<OpenDocumentDTO>>
  }
  combine: {
    merge(): Promise<IpcResult<{ filePath: string; pageCount: number }>>
    split(id: DocumentId, everyN: number): Promise<IpcResult<{ dir: string; count: number }>>
  }
  compare: {
    pick(): Promise<IpcResult<{ dataBase64: string; fileName: string }>>
  }
  separations: {
    render(
      id: DocumentId,
      pageNumber: number,
      dpi: number,
      mode: SeparationMode
    ): Promise<IpcResult<{ space: SeparationSpace; tiffBase64: string }>>
    exportFiles(
      files: { name: string; pngBase64: string }[]
    ): Promise<IpcResult<{ dir: string; count: number }>>
    exportGray(id: DocumentId): Promise<IpcResult<{ filePath: string; ink: InkCoverage | null }>>
  }
  system: {
    /** Devuelve la ruta en disco de un File arrastrado (Electron webUtils). */
    getPathForFile(file: unknown): string
    /** Plataforma del SO ('darwin' | 'win32' | 'linux'). */
    platform: string
  }
  app: {
    /** Informa al main de si el documento tiene cambios sin guardar (para el aviso al cerrar). */
    setDirty(dirty: boolean): void
    /** Revela un archivo en el explorador del SO (Finder / Explorador). */
    reveal(filePath: string): void
    /** Diálogo nativo de cambios sin guardar. Devuelve la acción elegida. */
    confirmUnsaved(opts: {
      message: string
      detail: string
      saveLabel: string
    }): Promise<'save' | 'cancel' | 'discard'>
  }
}
