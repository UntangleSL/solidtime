# Apariencia y marca Untangle (Fase 3.2)

Notas para quien despliega y opera `time.untangle.es`. Solo contiene **nombres** de tablas, rutas,
volúmenes y archivos: ningún valor secreto, ningún identificador real y ninguna dirección de correo.

## Alcance

- Qué añade la Fase 3.2: la paleta Untangle como aspecto por defecto (claro y oscuro), el tema y el
  color de acento de cada persona, y el icono de cada organización.
- Tipografía: Inter sigue siendo la única familia, también en los títulos de página (decisión de la
  propietaria D-10). No se añade ningún archivo de fuente.
- No hay variables de entorno nuevas. La pestaña Environment de Dokploy no cambia.
- El compose de referencia es `docs/deploy/dokploy-compose.fork.yml`. Pegarlo en Dokploy y redesplegar
  es un paso manual que se hace tras la aprobación de la propietaria.
- No cambia la API pública (`/api/v1`) ni `openapi.json`: las rutas nuevas viven en el grupo web
  (sesión y CSRF).

## Paleta por defecto

- Sin elegir nada, la aplicación usa la paleta Untangle en modo claro y oscuro: superficies `#F9FCFD`
  (claro) y `#1C1C1C` (oscuro), con el turquesa de Untangle como acento en botones y enlaces.
- Los tokens viven en `resources/css/untangle-theme.css` y los otros cinco acentos en
  `resources/css/accent-presets.css`, importados al final de `resources/css/app.css`.
- Las metaetiquetas `theme-color` del navegador siguen el modo (`#1C1C1C` oscuro, `#F9FCFD` claro).

## Tema y acento por persona

- Cada persona elige en su perfil el tema (sistema, claro u oscuro) y uno de seis acentos: `untangle`
  (por defecto), `azure`, `indigo`, `violet`, `ember` y `graphite`. También se puede cambiar el acento
  desde la paleta de comandos.
- La elección se guarda por persona en la tabla `user_appearance_settings` (una fila por persona,
  columnas `theme` y `accent`; vacías significan «sin elegir»). La fila se borra con la persona.
- La ruta es de sesión: `PUT /user/appearance` (limitada a 60 peticiones por minuto). Siempre actúa
  sobre la persona que ha iniciado sesión; no recibe ningún identificador.
- Un script en línea al principio del `<head>` (`resources/views/branding/early-theme.blade.php`) aplica
  el tema y el acento antes del primer pintado, con los valores del servidor y la última elección
  guardada en el navegador. Así no hay parpadeo de otro tema al recargar ni en un dispositivo nuevo.
  La misma vista parcial sustituye al script de tema de la página de autorización OAuth.

## Icono de la organización

- Las personas propietarias y administradoras (permiso `organizations:update`) suben un icono en los
  ajustes de la organización; el resto de miembros lo ven en modo lectura. Aparece en el selector de
  organizaciones de la barra lateral y en su lista; sin icono se muestra una tesela con la inicial.
- Formatos: PNG o JPG (detectados por el contenido, nunca por el nombre), hasta 1 MB, entre 32 y
  1024 píxeles por lado. SVG y GIF se rechazan.
- Rutas de sesión: `POST /organizations/<ORGANIZATION-UUID>/icon` para subir y
  `DELETE /organizations/<ORGANIZATION-UUID>/icon` para quitar (20 peticiones por minuto cada una).
- Los datos viven en la tabla `organization_icons`; el archivo se guarda en `organization-icons/` del
  disco `public` (`PUBLIC_FILESYSTEM_DISK: public` en el compose), con un nombre nuevo en cada subida y
  borrando el anterior.
- Ese disco está dentro del volumen `app-storage-files` (montado en `/var/www/html/storage/app`), así
  que los iconos sobreviven a los redespliegues. Se sirven a través del enlace `storage:link` que
  `start-container` ya crea al arrancar; no hace falta ningún paso extra.
- Al borrar una organización se borra también el archivo de su icono.

## Migraciones

`AUTO_DB_MIGRATE` las ejecuta al arrancar el contenedor `app`. Las dos son aditivas (tablas nuevas, sin
tocar datos existentes):

- `2026_11_16_000001_create_user_appearance_settings_table`
- `2026_11_16_000002_create_organization_icons_table`

Las carga el proveedor `App\Appearance\AppearanceServiceProvider` desde
`app/Appearance/database/migrations`. Tras el despliegue, `php artisan migrate:status` en el contenedor
`app` debe mostrarlas como `Ran`.

## Comprobación tras desplegar

Solo lecturas públicas, sin credenciales:

- `/health-check/up` responde 200.
- La página `/login` contiene el script `data-early-theme` y `window.__APPEARANCE__`.
- `GET /user/appearance` y `GET /organizations/<ORGANIZATION-UUID>/icon` responden 405 (la ruta existe
  pero solo admite `PUT` / `POST` y `DELETE`); un 404 indica que la Fase 3.2 no está desplegada.
- El CSS servido contiene el turquesa Untangle (triplete `0, 245, 212`).

## Vuelta atrás

- Volver a la imagen anterior (cambiar el tag en el compose y redesplegar) basta para quitar la
  apariencia: la imagen anterior no conoce las tablas nuevas y las ignora. Los datos quedan en la base de
  datos y los iconos en el volumen, listos para cuando se vuelva a desplegar.
- Para borrar también las tablas, hay que hacerlo **antes** de cambiar de imagen, con la imagen de la
  Fase 3.2 aún en marcha: las dos migraciones tienen `down()` y se ejecutaron en el mismo lote, así que
  `php artisan migrate:rollback` en el contenedor `app` las deshace (comprobar antes con
  `php artisan migrate:status` que son el último lote). Los archivos de `organization-icons/` del
  volumen se pueden borrar a mano después.
