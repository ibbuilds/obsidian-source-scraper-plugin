# Source Scraper: flujo de uso

Abre **Source Scraper** en la barra de estado, a la derecha de ChatGPT. El panel mide 400 × 500 px y usa la fuente, los colores y los controles de Obsidian. Se ajusta a ventanas pequeñas y desplaza el contenido dentro del panel:

- La pantalla inicial muestra la conexión a X y un botón para conectar, buscar o detener la búsqueda. Si falta preparar el motor o lector local, el botón indica qué configuración falta. Una sesión cargada todavía requiere una búsqueda real para verificar acceso.
- Pulsa la fila **Recursos** para filtrar y seleccionar resultados. Pulsa el nombre de un recurso para revisar su procedencia. **Ver borradores** muestra borradores; no guarda archivos. Pide a ChatGPT que evalúe la selección y escriba mediante tu conector de Obsidian solo cuando tú se lo indiques. La flecha del encabezado vuelve a la pantalla inicial.

Los datos del proyecto inicial se identifican como **Ejemplo local**. No son tu feed de X. La disponibilidad del motor/MCP no se presenta como una conexión verificada a X.

El icono de ajustes abre **Opciones**: importación JSON, sesión de X, otras fuentes, diagnósticos y herramientas avanzadas. No necesitas escoger un proyecto para usar el feed de X: el botón principal utiliza la fuente X registrada. Las fuentes genéricas siguen disponibles en Otras fuentes. Herramientas avanzadas conserva el editor de proyectos y el mapeo de borradores. La flecha vuelve a la pantalla desde la que abriste las opciones.

La importación explícita lleva directamente a Resultados. Los resultados que llegan por MCP actualizan la cola sin abrir el panel. Esc, el botón de cierre o un clic fuera lo cierran. No se abre un panel lateral ni se ejecuta una búsqueda al arrancar.

## Conectar X

1. Pulsa **Conectar X**. La ayuda **¿Dónde encuentro estos datos?** explica cómo obtener localmente `twid`, `auth_token` y `ct0` de tu propia sesión de X.
2. Pega `twid` completo o tu ID numérico y los dos valores ocultos. No los envíes al chat. Pulsa **Conectar** para cargarlos en memoria; esto no hace una petición a X.
3. Vuelve al panel inicial y abre **Filtros de búsqueda**. Ajusta términos a incluir/excluir, cualquiera/todos, antigüedad máxima en días, likes y reposts mínimos. En **Límite y reglas del perfil** puedes cambiar las páginas por búsqueda y la puntuación mínima de coincidencia, además de consultar las reglas avanzadas. Un campo vacío no agrega esa restricción. Empieza con una página. Cambiar filtros conserva la configuración y los datos anteriores en otro perfil externo; no modifica notas.
4. Pulsa **Buscar recursos**. La primera muestra real debe confirmar acceso, procedencia y utilidad. No hay API de pago ni alternativa comercial automática.

En Windows, la sesión se guarda cifrada con DPAPI para tu usuario, fuera de la bóveda, y se restaura automáticamente al abrir Obsidian o recargar el plugin. **Desconectar X** elimina la copia guardada. No se guarda en notas, proyectos ni preferencias. Si X vence o revoca la sesión, hay que renovarla. Editar filtros no solicita cookies. Para renovar una sesión ya cargada puedes dejar las cookies vacías para conservarla; reconectar con la misma cuenta mantiene todo el perfil existente. En otros sistemas se mantiene el modo en memoria. Consulta [X-FEED](X-FEED.md) para límites y detalles del lector local.

## Usar desde ChatGPT

Las 15 herramientas Source Scraper del conector existente permiten validar fuentes, iniciar trabajos acotados, leer hallazgos, registrar recomendaciones de IA separadas de revisiones humanas y preparar una selección persistente. Las recomendaciones incluyen evidencia y referencias; no equivalen a verificación independiente ni a autorización de escritura.

Los borradores se preparan para una carpeta elegida por el usuario. Solo ChatGPT, mediante el conector separado de Obsidian y con una orden explícita, crea o cambia notas. Source Scraper no tiene una herramienta para guardarlas.

## Límites

Importaciones: 5.000 registros / 8 MB. Consultas MCP: hasta 500 registros por página. Selecciones: 1–200 claves. El motor ejecuta un comando por vez; la cancelación conserva lo ya confirmado. Los trabajos interrumpidos no se reinician automáticamente. Las referencias de la cola persisten sin volver a recolectar fuentes.


## Formularios y ajustes

Los formularios normales miden 560 × 600 px; los editores de JSON y borradores,
720 × 640 px. Todos se acotan a la ventana disponible. El título y las acciones
permanecen visibles; el contenido central y el código largo tienen scroll interno.
Los campos mantienen etiquetas, ayudas y tamaños consistentes. Los resultados
muestran hasta 40 filas por página y conservan el foco al seleccionar o filtrar.

**Configuración del plugin** agrupa Conexión y Borradores. Las rutas, huellas y el
registro de proyectos quedan dentro de **Configuración del motor**. Editar un
campo no reinicia el proveedor. **Guardar ajustes** aplica los campos editados;
conserva cambios de sesión o formato realizados entretanto en otras pantallas.
