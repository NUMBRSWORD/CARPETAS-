# Carpetas fiscales

Aplicación de Mesa de Partes con portal personal de efectivos, documentos por carpeta,
recordatorios de vencimiento y recepción de archivos con confirmación del administrador.

## Dónde se guarda todo

El servidor Python usa SQLite en `datos_servidor/carpetas.db`, dentro de la PC administradora.
No usa Supabase. La base, el Excel, los documentos, el padrón de personal, los sellos y los
respaldos **no se suben a este repositorio**. `.gitignore` permite únicamente una lista
concreta de archivos de código. No usar `git add -f` ni publicar el HTML generado.

La configuración específica de la instalación vive en
`.automation/pagina_web/privado_local.json`, también excluida de Git. Incluye firma,
correcciones de registros, datos de decretos y distribución de personal. Se conserva
en la PC original; no reemplazarla por el ejemplo al actualizar el código.

## Uso en la PC existente

1. Abrir `ABRIR EN CHROME.bat`.
2. Tras actualizar Python, ejecutar `REINICIAR SERVIDOR.bat`. Si el proceso anterior
   está elevado, usar clic derecho → Ejecutar como administrador.
3. Tras cambiar plantillas o Excel, ejecutar `REGENERAR PAGINA.bat` y recargar.

El código activo está en `.automation/pagina_web/`. El Excel y los recursos de esta
instalación permanecen locales. Un clon nuevo requiere Python 3.12 o posterior y los
recursos locales autorizados: Excel, configuración, padrón, plantillas Word, escudo y
librerías de lectura/OCR. El repositorio no es una copia de los expedientes ni un
respaldo completo de la instalación. Las dependencias locales son pdf.js, Tesseract.js,
su motor/idioma español y JSZip, en `vendor/`, sin descargas al usar la aplicación.

## Acceso por internet sin Tailscale

GitHub almacena el código; GitHub Pages solo sirve archivos estáticos. El portal necesita
comunicarse con la PC encendida y conectada para leer datos y recibir archivos.

La entrada preparada en `acceso_internet.py` escucha **solo en 127.0.0.1:8766** y permite
únicamente `/e/<código>`, su documento autorizado y su envío. Bloquea las rutas de
administración, respaldos y API general. El servidor local del administrador sigue
en 8765 y **no debe publicarse directamente**: sus conexiones locales tienen permisos
de administrador.

Ejemplo con un dominio propio ya configurado:

```powershell
python -I .automation/pagina_web/acceso_internet.py --dominio portal.example.org
```

Configurar un túnel HTTPS de Cloudflare hacia `http://127.0.0.1:8766`, conservando el
Host público. No configurar el túnel hacia 8765. La entrada no crea un túnel ni abre
puertos del router por sí sola. No usar `httpHostHeader: localhost`: la entrada exige
el dominio público exacto. Excluir `/e/*` de caché y de registros de URL en servicios
externos cuando corresponda. El enlace personal concede acceso: compartirlo solo
con su titular y renovarlo si se divulga.

Cada efectivo ve solo sus pendientes, documentos y envíos. El archivo enviado llega
como «Por revisar»; en **Recibidos** el administrador lo confirma u observa. Los
recordatorios aparecen al abrir/actualizar el portal; no hay notificaciones con la
página cerrada. La configuración y prueba de la dirección pública se documentarán
cuando estén activadas; subir código no significa haber publicado el servicio.

### Entrada desde GitHub Pages

`docs/` contiene únicamente la pantalla pública de acceso, sin expedientes ni códigos
personales. Pages se configura desde `main`, carpeta `/docs`. `docs/config.json` solo
se habilita cuando el portal HTTPS esté listo. El enlace compartido puede tener la forma
`https://<usuario>.github.io/<repositorio>/#<código-personal>`: el fragmento no se envía a
GitHub y la pantalla lleva al portal de la PC. No publicar códigos de efectivos en Git.
La pantalla también permite pegar el enlace personal entregado por Mesa de Partes.

## Pruebas

```powershell
node .automation/pagina_web/pruebas/cliente.cjs
python -I .automation/pagina_web/pruebas/servidor_avanzado_test.py
python -I .automation/pagina_web/pruebas/portal_test.py
python -I .automation/pagina_web/pruebas/acceso_internet_test.py
python -I .automation/pagina_web/pruebas/codigo_git_test.py
```

Las pruebas HTTP generan una base temporal con datos ficticios. No se ensayan cargas,
restauraciones ni borrados en la base real.
