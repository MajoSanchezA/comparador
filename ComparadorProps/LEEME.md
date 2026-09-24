# Comparador de versiones de props

Guarda cada versión de un prop y te deja comparar dos cualquiera, a calidad original.

## Cómo arrancarlo

1. Descomprime la carpeta donde quieras (por ejemplo el Escritorio).
2. Doble clic en **Abrir comparador.bat**. Se abre una ventana negra y el navegador solo.
3. Para apagarlo, cierra la ventana negra.

La ventana negra es el servidor: mientras esté abierta el comparador funciona.
Si el `.bat` se cierra de golpe, es que Python no está en el PATH — abre la carpeta
en la terminal y escribe `python app/servidor.py`.

## Cómo se usa

**Subir una versión.** Botón naranja arriba a la derecha. Escribes proyecto,
episodio, shot y prop, arrastras la imagen y guardas. El número de versión lo pone
el programa solo: la primera es v1, la siguiente v2, y así.

Si ya tienes un prop seleccionado, el formulario viene relleno — subir la v5 de algo
son tres clics.

**Comparar.** Eliges el prop en el árbol de la izquierda. Se cargan solas la
penúltima versión en A y la última en B. Con los desplegables de arriba puedes
comparar dos cualesquiera, por ejemplo v1 contra v7.

**Avance.** La pestaña de al lado lista los props que cambiaron en los últimos
7 días, ya emparejados (versión anterior contra la nueva). Haces clic y se abre
la comparación.

Modos: **Cortina** (`1`), **Lado a lado** (`2`), **Superposición** (`3`).
`F` ajusta a pantalla, `0` va al 100% (un píxel del archivo = un píxel de pantalla).

## Aprobar una versión

Junto al botón de anotar hay un sello. Al pulsarlo eliges:

- **🦁 Aprobar** — queda registrado quién y cuándo, igual que el león en el chat.
- **Pedir cambios** — misma idea, pero marcada como pendiente.
- **Quitar marca** — vuelve a "sin revisar".

En la biblioteca aparece un 🦁 al lado de los props cuya última versión está
aprobada, y un ✎ en los que tienen cambios pendientes. El sello sale impreso en la
esquina de las hojas y los reportes que exportes, así que el registro viaja con la
imagen cuando la mandas al equipo.

La marca va contra la versión concreta: si apruebas la v3 y luego subes una v4, la
v4 nace sin revisar y la v3 conserva su aprobación.

## Encuadrar las imágenes de una hoja

En "Armar hoja…" hay un selector de ajuste:

- **Tamaño original** — cada imagen como viene.
- **Mismo alto** — todas a la misma altura, respetando su proporción.
- **Recortar a la misma medida** — todos los cuadros idénticos, como en Canva.

Con la última opción puedes encuadrar cada imagen a mano en la vista previa:
arrastras para moverla dentro de su cuadro, rueda del ratón para acercar y doble
clic para dejarla como estaba.

## Revisar y anotar

Con un prop abierto, el botón **Anotar B** enciende el modo revisión sobre la
versión nueva. Aparece un panel a la derecha y tres herramientas:

- **Mover** — desplazas y haces zoom como siempre, sin marcar nada.
- **Señalar** — clic sobre la imagen y queda un punto numerado. Escribes al lado
  qué hay que cambiar.
- **Dibujar** — arrastras y queda un trazo a mano alzada, para encerrar o subrayar.

El color se elige con el cuadrito de al lado, así puedes separar por persona o por
gravedad. Abajo hay una casilla para comentarios generales, los que no van sobre un
punto concreto: escribes y das Enter.

Cada nota se puede marcar como **resuelta** (queda tenue, no se borra) o borrar.
Todo queda guardado contra esa versión: si subes una v4, la v3 conserva sus notas.

**Exportar reporte** genera un PNG con la cabecera del estudio, la imagen con las
marcas encima y la lista numerada de comentarios, con fecha y autor. Es lo que le
mandas al equipo o adjuntas a la review.

## Tipos de asset

Al subir eliges si es prop, background, personaje, vestuario u otro. En la
biblioteca hay un filtro arriba para ver solo un tipo, y cada prop muestra su
etiqueta al lado del nombre.

## Cómo borrar algo

En el árbol de la izquierda, pasa el ratón por encima de cualquier fila: aparece
una **×** a la derecha. Sirve en los cuatro niveles — puedes borrar un prop suelto,
un shot entero, un episodio o el proyecto completo. Te pregunta antes y te dice
cuántas versiones se van a quitar.

**Nada se borra del disco de verdad.** Los archivos se mueven a la carpeta
`data/papelera/`, dentro de una subcarpeta con la fecha y hora del borrado. Si te
arrepientes, ahí están; se recuperan a mano desde el explorador de Windows.

Esa carpeta no se vacía sola, así que cada tanto conviene revisarla y borrarla tú
si ya no la necesitas.

## Dónde queda todo

```
ComparadorProps/
├── app/
│   ├── servidor.py        servidor y API
│   └── web/               interfaz (HTML, CSS y JavaScript)
├── data/                  datos creados por la aplicación (no se suben a Git)
│   ├── biblioteca.db      fichas y comentarios (SQLite)
│   ├── biblioteca/        archivos originales, sin recomprimir
│   ├── papelera/          archivos borrados recuperables
│   ├── proyectos/         logos de proyectos
│   └── respaldos/         copias automáticas de la base de datos
├── tests/                 pruebas automáticas
└── Abrir comparador.bat   inicio en este PC
```

Los PNG se copian byte por byte, nadie los toca. Puedes abrir esa carpeta en el
explorador y llevártelos a Photoshop cuando quieras.

**Respaldo:** copia la carpeta entera a un disco externo o al Drive del estudio.
Ahí va todo, no hay nada escondido en otro lado.

## Cuando lo quieras abrir al equipo

Abre **Abrir para el equipo.bat** en vez del otro. No hay que tocar código.

La ventana negra te dirá "MODO EQUIPO" y te mostrará el enlace exacto que tienen
que escribir tus compañeros, algo como `http://192.168.1.47:8777`. Ese número es
tu IP y te la calcula el programa solo.

Cosas que suelen fallar, en orden:

- **"Rechazó la conexión"** — el servidor no está arrancado, o está arrancado en
  modo privado. Mira que la ventana negra diga MODO EQUIPO.
- **La primera vez Windows pregunta por el firewall** — acepta en redes privadas.
  Si no aceptas, tú lo ves pero los demás no.
- **"Se queda cargando" desde otro PC** — casi siempre es el firewall bloqueando.
- **La IP cambia** cuando reinicias el router. Si el enlace deja de funcionar,
  vuelve a abrir el `.bat` y mira el número nuevo.

Dos cosas más antes de que el equipo dependa de esto: que el PC servidor no se
apague ni se suspenda (mejor una máquina fija del estudio que tu portátil), y que
tal como está cualquiera en la red puede subir versiones, no hay contraseñas.

## Respaldo automático

Cada vez que cambias la biblioteca, el programa guarda una copia de la ficha del
día en `data/respaldos/biblioteca-AAAA-MM-DD.db`. Esa copia protege el catálogo,
comentarios y aprobaciones. Los archivos originales siguen en `data/biblioteca/`, así
que para un respaldo completo conviene copiar ambas carpetas a otra unidad o al
Drive del estudio.

Las imágenes se validan antes de guardarse: se admiten PNG, JPG, GIF, WebP y TIFF,
con un máximo de 50 MB por archivo.
