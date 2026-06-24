/**
 * Genera build/manual.pdf: el manual de usuario de ManiPDF.
 *
 * Es un script independiente (no entra en el bundle): se ejecuta con
 * `npm run build:manual` y produce un PDF maquetado con pdf-lib. El manual se
 * empaqueta como recurso (electron-builder extraResources) y la app lo muestra
 * la primera vez que se abre.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'build', 'manual.pdf')

const PAGE = { w: 612, h: 792 }
const MARGIN = 56
const ACCENT = rgb(0, 0.6, 0.82) // azul de la marca (#0099d1 aprox)
const TEXT = rgb(0.13, 0.13, 0.15)
const DIM = rgb(0.4, 0.4, 0.45)

const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)
const bold = await doc.embedFont(StandardFonts.HelveticaBold)

let page = doc.addPage([PAGE.w, PAGE.h])
let y = PAGE.h - MARGIN

function ensure(space) {
  if (y - space < MARGIN) {
    page = doc.addPage([PAGE.w, PAGE.h])
    y = PAGE.h - MARGIN
  }
}

function wrap(text, f, size, maxW) {
  const words = text.split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (f.widthOfTextAtSize(test, size) > maxW && line) {
      lines.push(line)
      line = w
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

function paragraph(text, { f = font, size = 11, color = TEXT, gap = 5, indent = 0 } = {}) {
  const maxW = PAGE.w - MARGIN * 2 - indent
  const lines = wrap(text, f, size, maxW)
  for (const line of lines) {
    ensure(size + gap)
    page.drawText(line, { x: MARGIN + indent, y, size, font: f, color })
    y -= size + gap
  }
}

function bullet(text) {
  ensure(16)
  page.drawText('•', { x: MARGIN + 6, y, size: 11, font: bold, color: ACCENT })
  paragraph(text, { indent: 22, gap: 4 })
  y -= 2
}

function heading(text) {
  ensure(34)
  y -= 8
  page.drawText(text, { x: MARGIN, y, size: 15, font: bold, color: ACCENT })
  y -= 22
}

function subheading(text) {
  ensure(24)
  y -= 4
  page.drawText(text, { x: MARGIN, y, size: 12, font: bold, color: TEXT })
  y -= 17
}

function space(n = 8) {
  y -= n
}

// -- Portada ----------------------------------------------------------------
y = PAGE.h - 180
page.drawText('ManiPDF', { x: MARGIN, y, size: 40, font: bold, color: ACCENT })
y -= 34
page.drawText('Manual de usuario', { x: MARGIN, y, size: 18, font, color: DIM })
y -= 60
paragraph(
  'ManiPDF es un editor de PDF de escritorio. Con él puedes ver, anotar, organizar páginas, rellenar y crear formularios, proteger con contraseña, comprimir, comparar, reconocer texto (OCR) y preparar separación de color, todo desde una interfaz sencilla.',
  { color: DIM }
)

// -- Cómo se organiza -------------------------------------------------------
page = doc.addPage([PAGE.w, PAGE.h])
y = PAGE.h - MARGIN
heading('1. La pantalla principal')
paragraph(
  'Arriba tienes la barra de menús (Archivo, Editar, Ver, Herramientas), el botón "Acerca de", el icono de Información del documento, la búsqueda, Imprimir y el zoom. Debajo, las pestañas: cada PDF abierto ocupa una pestaña. A la derecha está el panel de Páginas.'
)
bullet('Abre varios PDF a la vez en pestañas; cada uno recuerda su propio zoom.')
bullet('Arrastra un PDF a la ventana para abrirlo.')
bullet('Un punto junto al nombre indica que hay cambios sin guardar.')

heading('2. Archivo')
subheading('Abrir y guardar')
bullet('Abrir (Cmd/Ctrl+O), Guardar (Cmd/Ctrl+S) y Guardar como (Cmd/Ctrl+Shift+S).')
subheading('Imprimir')
bullet('Imprimir (Cmd/Ctrl+P) abre una vista previa y el diálogo de impresión del sistema. Si el documento prohíbe imprimir, la opción se desactiva.')
subheading('Exportar')
bullet('PDF (copia), imágenes PNG/JPG (eliges resolución), escala de grises (K) y texto.')
subheading('Convertir')
bullet('Imágenes a PDF (cada imagen una página tamaño Carta) y PDF a imágenes.')
subheading('Unir o dividir')
bullet('Combina varios PDF en uno, o divide el actual en archivos de N páginas.')

heading('3. Ver')
bullet('Acercar / Alejar y Zoom 100%. Truco: doble clic sobre el porcentaje vuelve al 100%.')
bullet('Mantén la barra espaciadora para activar la "mano" y arrastrar el documento.')

page = doc.addPage([PAGE.w, PAGE.h])
y = PAGE.h - MARGIN
heading('4. Editar')
paragraph('Solo un modo de edición está activo a la vez; al cambiar de modo o cerrar, ManiPDF te avisa si hay cambios sin grabar.')
subheading('Anotar')
bullet('Resaltar, subrayar, recuadro, dibujo a mano, notas, texto e insertar imagen/firma.')
bullet('Selecciona un elemento para moverlo o bórralo con Supr.')
subheading('Crear campos')
bullet('Campos de texto, casillas y desplegables. Escribe un nombre (opcional), elige el tipo y arrastra para colocarlo. El texto de los campos usa un tamaño fijo y legible.')
subheading('Censurar')
bullet('Tapa zonas con datos sensibles; al aplicar, el contenido se elimina de verdad (no es solo un rectángulo encima).')
subheading('Deshacer / Rehacer')
bullet('Cmd/Ctrl+Z deshace y Cmd/Ctrl+Shift+Z (o Ctrl+Y) rehace, en todas las ediciones.')

heading('5. Buscar')
bullet('Cmd/Ctrl+F. Escribe y navega entre coincidencias; se resaltan sin alterar el texto.')

heading('6. Panel de Páginas')
bullet('Girar izquierda/derecha, duplicar, extraer, insertar y borrar páginas; reordénalas arrastrando. Tiene su propio deshacer/rehacer.')

heading('7. Información del documento (i)')
bullet('Número de páginas, tamaño de hoja, color, tamaño de archivo, versión de PDF, si está cifrado, autor, fechas, etc.')

page = doc.addPage([PAGE.w, PAGE.h])
y = PAGE.h - MARGIN
heading('8. Herramientas')
subheading('Proteger')
bullet('Cifra el PDF con contraseña de apertura y define permisos (imprimir, copiar, modificar).')
bullet('La contraseña de propietario es opcional: si la dejas vacía, se genera una interna para que los permisos se respeten. Para poder saltarte tú las restricciones, usa una contraseña de propietario distinta.')
bullet('ManiPDF abre PDF protegidos (te pide la contraseña) y respeta el "no imprimir".')
subheading('Comprimir')
bullet('Estructura (sin pérdida): reduce manteniendo calidad. Rasterizar (con pérdida): reduce más, pero el texto deja de ser seleccionable.')
subheading('Marcas')
bullet('Marca de agua, encabezado/pie y numeración de páginas. Usa {page}, {total} y {date}.')
subheading('Comparar')
bullet('Compara el texto de dos PDF página por página y muestra líneas añadidas y eliminadas.')
subheading('OCR')
bullet('Reconoce texto de páginas escaneadas: extrae el texto o crea un PDF buscable. La primera vez descarga el idioma (necesita internet).')
subheading('Separación de color')
bullet('Previsualiza y exporta las planchas de color (CMYK/RGB) para flujos de imprenta.')

heading('9. Consejos rápidos')
bullet('Los diálogos son modales: si haces clic fuera, suenan y se resaltan; ciérralos con Cerrar/Cancelar o Esc.')
bullet('Los avisos de error desaparecen solos a los pocos segundos.')
bullet('Guarda con frecuencia: el punto junto al nombre te recuerda los cambios pendientes.')

space(16)
paragraph('ManiPDF — gracias por usarlo. Este manual también está disponible desde el botón "Acerca de".', { color: DIM, f: bold })

await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, await doc.save())
console.log('Manual generado en', OUT, `(${doc.getPageCount()} páginas)`)
