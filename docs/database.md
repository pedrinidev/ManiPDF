# Base de datos

**No aplica:** ManiPDF no usa base de datos ni servidor. Es una app de escritorio que
trabaja sobre archivos PDF locales.

## Qué se guarda y dónde

| Dato | Dónde | Quién lo gestiona |
|------|-------|-------------------|
| Documentos abiertos (bytes, ruta, revisión, si hay cambios, protección) | Memoria del proceso main (`PdfDocument`) | `DocumentService` |
| PDFs del usuario | Su propio disco (abrir / guardar / exportar) | `FileService` (escritura atómica) |
| Historial de deshacer/rehacer | Memoria del renderer (`document.store.tsx`) | Store del renderer |
| Marca de primera ejecución | `userData/.manipdf-first-run-done` | `index.ts` (main) |
| Recordatorio de actualización (versión, desde cuándo, último aviso) | `userData/.manipdf-update-reminder.json` | `index.ts` (main) |
| Modelos de idioma del OCR | `userData/tessdata/` | `OcrService` |
| «Recientes» (máx. 8) y último tamaño de página de Imágenes → PDF | `localStorage` del renderer | `services/recents.ts`, `ConvertDialog.tsx` |
| Temporales (Ghostscript, imprimir, descifrar) | Carpeta temporal del sistema, prefijo `manipdf-` | `services/temp.ts` (se borran al terminar y, si quedan, al arrancar) |

Nada sale del equipo, salvo la descarga (una vez) de los modelos del OCR.

Si en el futuro hiciera falta una base de datos (p. ej. historial de documentos con
miniaturas o etiquetas), se documentará aquí su esquema antes de implementarla.
