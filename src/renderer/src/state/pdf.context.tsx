import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type JSX
} from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useDocument } from './document.store'
import { loadPdf, isPasswordError, getPageSizes, type PageSize } from '../services/pdf-renderer'
import { documentClient, ClientError } from '../services/document.client'

/** Bit de permiso de impresión en pdf.js (PermissionFlag.PRINT). */
const PDF_PRINT_FLAG = 0x04

/**
 * Carga UNA sola instancia pdf.js del documento activo y la comparte con
 * todas las vistas (visor + miniaturas). Se recarga cuando cambian los bytes
 * (al editar páginas) y destruye la anterior para no fugar memoria.
 *
 * Si el PDF está cifrado, pdf.js pide contraseña: lo exponemos con `needsPassword`
 * y `submitPassword` para que el visor muestre un campo y reintente.
 */
interface PdfContextValue {
  pdf: PDFDocumentProxy | null
  /**
   * Tamaño de cada página (puntos, escala 1, CropBox y rotación aplicados). Se
   * publica junto con `pdf`: si hay `pdf`, hay tamaños.
   */
  pageSizes: PageSize[] | null
  /**
   * Revisión del documento de la que se cargó `pdf`. Tras una edición, el visor
   * sigue mostrando la versión anterior hasta que carga la nueva: las operaciones
   * que rasterizan con `pdf` deben enviar ESTA revisión (y no la del store) para
   * que el proceso principal detecte que lo rasterizado ya no es lo actual.
   */
  revision: number | null
  loading: boolean
  error: string | null
  /** El documento está cifrado y hace falta una contraseña para abrirlo. */
  needsPassword: boolean
  /** Mensaje cuando la contraseña introducida es incorrecta. */
  passwordError: string | null
  /** false si el documento prohíbe imprimir (permisos del PDF). */
  printingAllowed: boolean
  /** Reintenta la apertura con la contraseña indicada. */
  submitPassword: (password: string) => void
}

const PdfContext = createContext<PdfContextValue | null>(null)

interface InternalPdfState {
  pdf: PDFDocumentProxy | null
  pageSizes: PageSize[] | null
  revision: number | null
  loading: boolean
  error: string | null
  needsPassword: boolean
  passwordError: string | null
  printingAllowed: boolean
}

const EMPTY: InternalPdfState = {
  pdf: null,
  pageSizes: null,
  revision: null,
  loading: false,
  error: null,
  needsPassword: false,
  passwordError: null,
  printingAllowed: true
}

export function PdfProvider({ children }: { children: ReactNode }): JSX.Element {
  const { state, replaceDoc, reportError } = useDocument()
  const doc = state.doc
  const [value, setValue] = useState<InternalPdfState>(EMPTY)
  const currentPdf = useRef<PDFDocumentProxy | null>(null)
  const currentDocId = useRef<string | null>(null)
  // Identifica el intento de carga vigente: invalida resultados que lleguen tarde
  // (cambios de documento o reintentos de contraseña).
  const attempt = useRef(0)
  // Bytes del documento actual, para reintentar con contraseña, y su revisión.
  const dataRef = useRef<Uint8Array | null>(null)
  const revisionRef = useRef<number | null>(null)
  // Restricción de impresión recordada por documento: tras descifrar, el PDF en
  // memoria ya no tiene permisos, así que conservamos los leídos al introducir la
  // contraseña.
  const restrictionRef = useRef<Record<string, boolean>>({})

  const runLoad = useCallback((data: Uint8Array, password?: string) => {
    const myAttempt = ++attempt.current
    const revision = revisionRef.current
    setValue((v) => ({ ...v, loading: true, error: null, needsPassword: false }))

    loadPdf(data, password)
      .then(async (p) => {
        if (myAttempt !== attempt.current) {
          p.destroy()
          return
        }
        // Permiso de impresión: si lo recordamos (doc descifrado) lo usamos; si no,
        // lo leemos del propio PDF (cubre PDFs restringidos sin contraseña).
        let printingAllowed = true
        try {
          const docId = currentDocId.current
          const remembered = docId ? restrictionRef.current[docId] : undefined
          if (remembered !== undefined) {
            printingAllowed = remembered
          } else {
            const perms = await p.getPermissions()
            printingAllowed = perms === null || perms.includes(PDF_PRINT_FLAG)
          }
        } catch {
          /* sin info de permisos: se permite por defecto */
        }
        // Tamaños de página ANTES de publicar: el visor reserva cada hueco desde el
        // primer pintado (sin saltos de maquetación al hacer zoom o ir a una página).
        const pageSizes = await getPageSizes(p)
        if (myAttempt !== attempt.current) {
          p.destroy()
          return
        }
        const prev = currentPdf.current
        currentPdf.current = p
        setValue({
          pdf: p,
          pageSizes,
          revision,
          loading: false,
          error: null,
          needsPassword: false,
          passwordError: null,
          printingAllowed
        })
        if (prev && prev !== p) prev.destroy()
      })
      .catch((err) => {
        if (myAttempt !== attempt.current) return
        const pw = isPasswordError(err)
        if (pw) {
          setValue({
            pdf: null,
            pageSizes: null,
            revision: null,
            loading: false,
            error: null,
            needsPassword: true,
            passwordError: pw === 'wrong' ? 'Contraseña incorrecta. Inténtalo de nuevo.' : null,
            printingAllowed: true
          })
          return
        }
        setValue({
          pdf: null,
          pageSizes: null,
          revision: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Error al renderizar',
          needsPassword: false,
          passwordError: null,
          printingAllowed: true
        })
      })
  }, [])

  useEffect(() => {
    if (!doc) {
      attempt.current++ // invalida cualquier carga en curso
      currentPdf.current?.destroy()
      currentPdf.current = null
      currentDocId.current = null
      dataRef.current = null
      revisionRef.current = null
      setValue(EMPTY)
      return
    }

    // Mismo documento recargado (p. ej. tras editar): conservamos el render
    // anterior visible mientras carga → sin parpadeo. Otro documento: limpiamos.
    const sameDoc = doc.id === currentDocId.current
    if (!sameDoc) {
      currentPdf.current?.destroy()
      currentPdf.current = null
      setValue(EMPTY)
    }
    currentDocId.current = doc.id
    dataRef.current = doc.data
    revisionRef.current = doc.revision
    runLoad(doc.data)
  }, [doc?.id, doc?.data, runLoad])

  const submitPassword = useCallback(
    async (password: string) => {
      const docId = currentDocId.current
      const data = dataRef.current
      if (!docId || !data) return
      setValue((v) => ({ ...v, loading: true, error: null, needsPassword: false }))

      // 1) Verifica la contraseña y LEE los permisos con pdf.js (fiable). Si es
      //    incorrecta, pdf.js lanza PasswordException.
      let printingAllowed = true
      let verified = false
      try {
        const verify = await loadPdf(data, password)
        verified = true
        const perms = await verify.getPermissions()
        printingAllowed = perms === null || perms.includes(PDF_PRINT_FLAG)
        verify.destroy()
      } catch (err) {
        if (isPasswordError(err)) {
          setValue({
            pdf: null,
            pageSizes: null,
            revision: null,
            loading: false,
            error: null,
            needsPassword: true,
            passwordError: 'Contraseña incorrecta. Inténtalo de nuevo.',
            printingAllowed: true
          })
          return
        }
        /* otro error al leer permisos: seguimos e intentamos descifrar igualmente */
      }

      // Recordamos la restricción: tras descifrar, el PDF ya no la lleva.
      restrictionRef.current[docId] = printingAllowed

      // 2) Descifra (Ghostscript) para poder EDITAR; al reemplazar los bytes, el
      //    efecto recarga el PDF descifrado (y runLoad usará la restricción recordada).
      try {
        const decrypted = await documentClient.unlock(docId, password)
        replaceDoc(decrypted)
      } catch (err) {
        // La contraseña es buena (pdf.js la aceptó) pero no se pudo descifrar para
        // editar: se muestra en solo lectura con pdf.js y se explica el motivo. Antes
        // decía «Contraseña incorrecta» aunque fuera correcta.
        if (verified || (err instanceof ClientError && err.code === 'DECRYPT_UNSUPPORTED')) {
          runLoad(data, password)
          reportError(
            `Se abre en solo lectura: no se pudo descifrar para editar (${err instanceof Error ? err.message : 'error desconocido'}).`
          )
          return
        }
        setValue({
          pdf: null,
          pageSizes: null,
          revision: null,
          loading: false,
          error: null,
          needsPassword: true,
          passwordError: 'Contraseña incorrecta. Inténtalo de nuevo.',
          printingAllowed: true
        })
      }
    },
    [runLoad, replaceDoc, reportError]
  )

  return <PdfContext.Provider value={{ ...value, submitPassword }}>{children}</PdfContext.Provider>
}

export function usePdf(): PdfContextValue {
  const ctx = useContext(PdfContext)
  if (!ctx) throw new Error('usePdf debe usarse dentro de <PdfProvider>')
  return ctx
}
