# ManiPDF

Editor de PDF de escritorio completo y profesional: ver y seleccionar texto,
anotar, organizar páginas, formularios, OCR, seguridad, comparación, exportación
y separación de color para artes gráficas. Construido con Electron + React +
TypeScript (pdf.js para renderizar, pdf-lib para manipular y Ghostscript para
prepress).

## Requisitos

- Node.js 20+ (probado con Node 24)
- npm 10+
- **Ghostscript** (opcional, solo para *Separación de colores*): `brew install ghostscript`

## Desarrollo

```bash
npm install      # instalar dependencias
npm run dev      # arrancar la app con hot-reload
```

## Otros comandos

```bash
npm run typecheck   # comprobar tipos (main + renderer)
npm run build       # compilar producción a out/
npm run start       # previsualizar el build
npm run package     # generar app sin instalador (carpeta) en dist/
npm run dist        # generar instalador (.dmg / .exe / .AppImage) en dist/
```

## Instalar (uso personal)

- **macOS:** `npm run dist` genera `dist/ManiPDF-<versión>-arm64.dmg`. Ábrelo y
  arrastra la app a Aplicaciones. Como no está firmada, la primera vez: clic
  derecho sobre la app → **Abrir** (para saltar Gatekeeper).
- **Windows / Linux:** se generan en su propio SO, o automáticamente con la CI.

## Instaladores multiplataforma (CI)

`.github/workflows/build.yml` compila los tres instaladores (macOS/Windows/Linux)
en GitHub Actions. Tras subir el repo a GitHub:
- Manual: pestaña **Actions → Build installers → Run workflow**.
- Por versión: `git tag v0.1.0 && git push --tags`.
Los instaladores quedan como *artifacts* del workflow.

## Estado actual

**Fases 1–4 completas:**
- **document + viewer:** abrir/guardar/cerrar, metadata, visor con zoom
- **pages:** rotar, borrar, reordenar (drag&drop), duplicar, insertar, extraer, miniaturas
- **annotations:** resaltar, subrayar, rectángulo, dibujo, notas, **texto** y **firma/imagen** + grabar en el PDF
- **security:** proteger con contraseña y permisos
- **optimize:** comprimir (estructura sin pérdida / rasterizar)
- **convert:** PDF↔imágenes (PNG/JPG)
- **forms:** detectar y rellenar campos de formulario

- **ocr:** extraer texto + crear PDF buscable (tesseract.js)
- **empaquetado:** `.dmg` local + CI multiplataforma (GitHub Actions)

Única limitación de alcance: editar texto *existente* con reflujo y firma digital
con certificado (mejoras futuras de nicho). Ver [docs/modules.md](docs/modules.md).

## Documentación

- [Arquitectura](docs/architecture.md) — cómo está construido y por qué
- [Módulos](docs/modules.md) — qué hay hecho y qué falta
- [API IPC](docs/api.md) — el contrato renderer ↔ main

## Estructura

```
src/
├── main/        proceso Node: services, ipc handlers, dominio
├── preload/     puente seguro (contextBridge) → window.api
├── shared/      contrato IPC compartido (fuente de verdad)
└── renderer/    UI React: ui/ views/ state/ services/
```
