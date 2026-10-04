import { createHash, randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { DocumentId, ReadOnlyReason } from '@shared/ipc-contract'

/**
 * Cifrado del archivo original, para volver a cifrarlo igual al guardar: misma
 * contraseña de apertura y mismos permisos.
 */
export interface Protection {
  /** Contraseña de apertura ('' si el PDF se abría sin contraseña). */
  userPassword: string
  /** Contraseña de propietario si el usuario la introdujo; si no, se genera una nueva al guardar. */
  ownerPassword: string | null
  /** Permisos originales (valor /P del diccionario /Encrypt). */
  permissions: number
}

/** El PDF sigue cifrado en memoria: solo se puede ver hasta desbloquearlo. */
export interface Lock {
  reason: ReadOnlyReason
  /** Permisos originales (valor /P), para conservarlos al desbloquear. */
  permissions: number
}

/**
 * Modelo de dominio de un documento PDF abierto.
 *
 * Es deliberadamente "tonto": guarda estado, no sabe leer/escribir disco
 * ni renderizar. Las operaciones de I/O y de PDF viven en los services.
 * Esto lo hace testeable sin Electron ni sistema de archivos.
 */
export class PdfDocument {
  readonly id: DocumentId
  /** Ruta en disco. null = documento nuevo aún no guardado. */
  filePath: string | null
  /** Contenido binario actual del PDF. */
  bytes: Uint8Array
  /** true si hay cambios sin guardar. */
  isDirty: boolean
  /** Versión de los bytes: sube con cada cambio (detecta operaciones desfasadas). */
  revision: number
  /** Si se abrió cifrado y se descifró en memoria: cómo volver a cifrarlo al guardar. */
  protection: Protection | null
  /**
   * Si sigue cifrado (falta la contraseña o sus permisos no permiten modificarlo):
   * solo lectura. Editarlo así lo corrompía.
   */
  lock: Lock | null
  /**
   * Huella de los bytes guardados (o tal como se abrieron): deshacer hasta ellos
   * deja el documento sin cambios. Antes seguía marcado como modificado.
   */
  private savedDigest: string

  private constructor(id: DocumentId, filePath: string | null, bytes: Uint8Array) {
    this.id = id
    this.filePath = filePath
    this.bytes = bytes
    this.isDirty = false
    this.revision = 0
    this.protection = null
    this.lock = null
    this.savedDigest = digest(bytes)
  }

  /** Crea un documento a partir de bytes leídos de disco. */
  static fromBytes(bytes: Uint8Array, filePath: string | null): PdfDocument {
    return new PdfDocument(randomUUID(), filePath, bytes)
  }

  /** Nombre de archivo para mostrar en la UI. */
  get fileName(): string {
    return this.filePath ? basename(this.filePath) : 'Sin título.pdf'
  }

  /** Reemplaza el contenido binario (tras una edición) y marca como modificado. */
  replaceBytes(bytes: Uint8Array): void {
    this.bytes = bytes
    this.isDirty = true
    this.revision += 1
  }

  /**
   * Vuelve a unos bytes anteriores (deshacer / rehacer): si son los guardados, el
   * documento deja de estar modificado.
   */
  restoreBytes(bytes: Uint8Array): void {
    this.bytes = bytes
    this.revision += 1
    this.isDirty = digest(bytes) !== this.savedDigest
  }

  /** true si el documento no se puede modificar (sigue cifrado en memoria). */
  get readOnly(): boolean {
    return this.lock !== null
  }

  /** Marca el documento como cifrado en memoria: solo lectura. */
  markLocked(lock: Lock): void {
    this.lock = lock
  }

  /**
   * Sustituye los bytes por la versión DESCIFRADA (al abrir o desbloquear un PDF
   * protegido) sin marcarlo como modificado: es el mismo documento, solo descifrado
   * en memoria. Deja de ser de solo lectura.
   */
  setDecryptedBytes(bytes: Uint8Array, protection: Protection): void {
    this.bytes = bytes
    this.revision += 1
    this.protection = protection
    this.lock = null
    this.isDirty = false
    this.savedDigest = digest(bytes)
  }

  /** Marca el documento como guardado en la ruta indicada. */
  markSaved(filePath: string): void {
    this.filePath = filePath
    this.isDirty = false
    this.savedDigest = digest(this.bytes)
  }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
