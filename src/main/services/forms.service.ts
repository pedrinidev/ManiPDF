import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFButton,
  PDFSignature,
  type PDFField
} from 'pdf-lib'
import { DocumentService, DocumentError } from './document.service'
import type {
  DocumentId,
  FormFieldDTO,
  FormFieldType,
  FormFieldValue,
  NewFormField,
  OpenDocumentDTO
} from '@shared/ipc-contract'

/** Tamaño de fuente fijo (pt) para los campos nuevos de texto/desplegable. */
const FIELD_FONT_SIZE = 11

/**
 * Lógica del módulo "forms": detectar y rellenar campos de formulario PDF.
 * Usa la API de formularios de pdf-lib (AcroForm).
 */
export class FormsService {
  constructor(private readonly documents: DocumentService) {}

  /** Lista los campos del formulario del documento (vacío si no tiene). */
  async list(id: DocumentId): Promise<FormFieldDTO[]> {
    const doc = this.documents.getDocument(id)
    const pdf = await this.load(doc.bytes)
    return pdf
      .getForm()
      .getFields()
      .map((field) => this.describeField(field))
  }

  /** Rellena los campos indicados y, opcionalmente, aplana el formulario. */
  async fill(
    id: DocumentId,
    values: FormFieldValue[],
    flatten: boolean
  ): Promise<OpenDocumentDTO> {
    const doc = this.documents.getDocument(id)
    const pdf = await this.load(doc.bytes)
    const form = pdf.getForm()

    const byName = new Map(form.getFields().map((f) => [f.getName(), f]))
    for (const { name, value } of values) {
      const field = byName.get(name)
      if (field) this.applyValue(field, value)
    }

    if (flatten) form.flatten()

    doc.replaceBytes(await pdf.save())
    return this.documents.describe(id)
  }

  /** Crea campos de formulario nuevos en las posiciones indicadas. */
  async create(id: DocumentId, fields: NewFormField[]): Promise<OpenDocumentDTO> {
    if (fields.length === 0) {
      throw new DocumentError('INVALID_PDF', 'No se definió ningún campo')
    }
    const doc = this.documents.getDocument(id)
    const pdf = await this.load(doc.bytes)
    const form = pdf.getForm()
    const pages = pdf.getPages()
    const used = new Set(form.getFields().map((f) => f.getName()))

    for (const field of fields) {
      const page = pages[field.page - 1]
      if (!page || used.has(field.name)) continue
      const { width: W, height: H } = page.getSize()
      const box = {
        x: field.rect.x * W,
        y: H - (field.rect.y + field.rect.h) * H,
        width: field.rect.w * W,
        height: field.rect.h * H
      }
      try {
        if (field.type === 'text') {
          const tf = form.createTextField(field.name)
          tf.addToPage(page, box)
          // Tamaño de fuente FIJO: por defecto pdf-lib auto-escala el texto a la
          // altura de la caja (cajas grandes → texto enorme). Lo fijamos a un
          // tamaño legible y constante, independiente del tamaño del campo.
          tf.setFontSize(FIELD_FONT_SIZE)
        } else if (field.type === 'checkbox') {
          form.createCheckBox(field.name).addToPage(page, box)
        } else {
          const dd = form.createDropdown(field.name)
          if (field.options.length > 0) dd.addOptions(field.options)
          dd.addToPage(page, box)
          dd.setFontSize(FIELD_FONT_SIZE)
        }
        used.add(field.name)
      } catch {
        // Nombre inválido/duplicado u otro problema con el campo: se omite.
      }
    }

    doc.replaceBytes(await pdf.save())
    return this.documents.describe(id)
  }

  // -- helpers --------------------------------------------------------------

  private describeField(field: PDFField): FormFieldDTO {
    const name = field.getName()
    const base = { name, value: '', checked: false, options: [] as string[], readOnly: false }

    if (field instanceof PDFTextField) {
      return { ...base, type: 'text', value: field.getText() ?? '' }
    }
    if (field instanceof PDFCheckBox) {
      return { ...base, type: 'checkbox', checked: field.isChecked() }
    }
    if (field instanceof PDFRadioGroup) {
      return { ...base, type: 'radio', value: field.getSelected() ?? '', options: field.getOptions() }
    }
    if (field instanceof PDFDropdown) {
      return {
        ...base,
        type: 'dropdown',
        value: field.getSelected()[0] ?? '',
        options: field.getOptions()
      }
    }
    if (field instanceof PDFOptionList) {
      return {
        ...base,
        type: 'optionlist',
        value: field.getSelected()[0] ?? '',
        options: field.getOptions()
      }
    }
    if (field instanceof PDFButton) return { ...base, type: 'button', readOnly: true }
    if (field instanceof PDFSignature) return { ...base, type: 'signature', readOnly: true }
    return { ...base, type: 'unknown' as FormFieldType, readOnly: true }
  }

  private applyValue(field: PDFField, value: string | boolean): void {
    try {
      if (field instanceof PDFTextField) {
        field.setText(String(value))
      } else if (field instanceof PDFCheckBox) {
        value === true || value === 'true' ? field.check() : field.uncheck()
      } else if (
        field instanceof PDFRadioGroup ||
        field instanceof PDFDropdown ||
        field instanceof PDFOptionList
      ) {
        const v = String(value)
        if (v) field.select(v)
      }
    } catch {
      // Valor inválido para ese campo (p. ej. opción inexistente): se ignora.
    }
  }

  private async load(bytes: Uint8Array): Promise<PDFDocument> {
    try {
      return await PDFDocument.load(bytes, { ignoreEncryption: true })
    } catch {
      throw new DocumentError('INVALID_PDF', 'El PDF no es válido o está dañado')
    }
  }
}
