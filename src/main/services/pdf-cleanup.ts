import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNull,
  PDFPageLeaf,
  PDFRef,
  PDFStream,
  type PDFObject,
  type PDFPage
} from 'pdf-lib'

/**
 * Limpieza de documentos antes de guardar (lógica pura sobre pdf-lib).
 *
 * pdf-lib no elimina nada por su cuenta: una página quitada del árbol sigue en el
 * archivo, y `copyPages` arrastra en profundidad todo lo que referencia una página,
 * incluidas OTRAS páginas a las que apuntan sus enlaces. Así, el contenido de una
 * página borrada o censurada seguía dentro del PDF guardado, recuperable por
 * cualquiera que lo inspeccionara.
 */

/**
 * Elimina las páginas «muertas» (objetos /Page que no están en el árbol de
 * páginas: borradas, sustituidas o arrastradas por copyPages). Las referencias a
 * ellas (destinos de enlaces y marcadores, /P de anotaciones…) se anulan y luego
 * se descartan todos los objetos que ya no son alcanzables desde el trailer.
 */
export function pruneDeadPages(pdf: PDFDocument): void {
  // Del árbol real: `pdf.getPages()` puede devolver una caché obsoleta tras
  // `removePage` (pdf-lib no la invalida).
  const live = new Set<string>()
  pdf.catalog.Pages().traverse((node, ref) => {
    if (node instanceof PDFPageLeaf) live.add(ref.toString())
  })
  const dead = new Set<string>()
  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    if (isPageObject(object) && !live.has(ref.toString())) dead.add(ref.toString())
  }
  if (dead.size > 0) detachReferences(pdf, dead)
  removeUnreachableObjects(pdf)
}

/**
 * Referencias de las anotaciones de unas páginas. Se recogen ANTES de quitarlas
 * para saber qué campos de formulario se quedan sin widgets (`pruneFormFields`).
 */
export function annotationRefs(pages: PDFPage[]): Set<string> {
  const refs = new Set<string>()
  for (const page of pages) {
    const annots = page.node.Annots()
    if (!annots) continue
    for (const item of annots.asArray()) if (item instanceof PDFRef) refs.add(item.toString())
  }
  return refs
}

/**
 * Quita del formulario (AcroForm) los widgets que estaban en páginas eliminadas y
 * los campos que se quedan sin ninguno. Si no, el campo seguía en el formulario
 * (con su valor dentro del archivo) aunque ya no apareciera en ninguna página.
 */
export function pruneFormFields(pdf: PDFDocument, removedAnnots: Set<string>): void {
  if (removedAnnots.size === 0) return
  const acroForm = pdf.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
  const fields = acroForm?.lookupMaybe(PDFName.of('Fields'), PDFArray)
  if (!fields) return

  /** true si el campo (o widget) debe conservarse; poda sus hijos en el sitio. */
  const keep = (item: PDFObject): boolean => {
    if (item instanceof PDFRef && removedAnnots.has(item.toString())) return false
    const dict = item instanceof PDFRef ? pdf.context.lookup(item) : item
    if (!(dict instanceof PDFDict)) return true
    const kids = dict.lookupMaybe(PDFName.of('Kids'), PDFArray)
    if (!kids || kids.size() === 0) return true
    for (let i = kids.size() - 1; i >= 0; i--) if (!keep(kids.get(i))) kids.remove(i)
    return kids.size() > 0
  }
  for (let i = fields.size() - 1; i >= 0; i--) if (!keep(fields.get(i))) fields.remove(i)
}

// -- internos -----------------------------------------------------------------

function isPageObject(object: PDFObject): boolean {
  if (object instanceof PDFPageLeaf) return true
  return object instanceof PDFDict && object.get(PDFName.of('Type')) === PDFName.of('Page')
}

/** Sustituye por `null` toda referencia a los objetos `dead` (salvo dentro de ellos). */
function detachReferences(pdf: PDFDocument, dead: Set<string>): void {
  const isDead = (value: PDFObject): boolean => value instanceof PDFRef && dead.has(value.toString())
  const visit = (object: PDFObject): void => {
    if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        if (isDead(value)) object.set(key, PDFNull)
        else visit(value)
      }
    } else if (object instanceof PDFArray) {
      for (let i = 0; i < object.size(); i++) {
        const value = object.get(i)
        if (isDead(value)) object.set(i, PDFNull)
        else visit(value)
      }
    } else if (object instanceof PDFStream) {
      visit(object.dict)
    }
  }
  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    if (!dead.has(ref.toString())) visit(object)
  }
}

/** Descarta los objetos indirectos que no se alcanzan desde el trailer. */
function removeUnreachableObjects(pdf: PDFDocument): void {
  const { context } = pdf
  const reachable = new Set<string>()
  const pending: PDFRef[] = []
  const collect = (object: PDFObject | undefined): void => {
    if (object === undefined) return
    if (object instanceof PDFRef) pending.push(object)
    else if (object instanceof PDFDict) for (const [, value] of object.entries()) collect(value)
    else if (object instanceof PDFArray) for (const value of object.asArray()) collect(value)
    else if (object instanceof PDFStream) collect(object.dict)
  }
  const { Root, Info, Encrypt } = context.trailerInfo
  collect(Root)
  collect(Info)
  collect(Encrypt)
  while (pending.length > 0) {
    const ref = pending.pop() as PDFRef
    const key = ref.toString()
    if (reachable.has(key)) continue
    reachable.add(key)
    collect(context.lookup(ref))
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) context.delete(ref)
  }
}
