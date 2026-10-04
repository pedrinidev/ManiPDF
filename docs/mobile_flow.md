# Flujo móvil

**No aplica:** ManiPDF es solo de escritorio (Electron: macOS, Windows y Linux). No hay
app Android ni iOS.

La interfaz se adapta a ventanas estrechas (barra superior hasta 900 px de ancho), pero
no está pensada para pantallas táctiles pequeñas.

Si en el futuro se hiciera una versión móvil, las reglas del proyecto (CLAUDE.md) piden
MVVM con separación UI / Domain / Data y repositorios. La lógica de PDF del proceso main
(`src/main/services`, sin dependencias de Electron salvo `FileService`) y el contrato
(`src/shared/ipc-contract.ts`) serían el punto de partida para la capa de datos; este
documento describiría entonces sus pantallas y su navegación.
