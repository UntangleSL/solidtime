# Backup de la configuración Dokploy (2026-10-19)

Copia del compose que sirve `time.untangle.es` antes de cualquier cambio del fork M365.

- Proyecto Dokploy: compose `solidtime` (appName `untangle-solidtime-tq34sf`, composeId `PtyO0frWvgS_QEaN9g1bW`), entorno production.
- Origen: `raw` (compose pegado en Dokploy), imagen oficial `solidtime/solidtime:${SOLIDTIME_IMAGE_TAG:-latest}`.
- Servicios: `app` (puerto 8000, dominio `time.untangle.es`, https), `scheduler`, `queue`, `database` (postgres:15), `gotenberg`.
- Volúmenes: `database-storage`, `app-storage`, `app-storage-files`, `app-logs`.
- `dokploy-compose.converted.yml` es la versión convertida por Dokploy (incluye las etiquetas de Traefik). Solo contiene referencias `${VAR}`; los valores (APP_KEY, DB_PASSWORD, PASSPORT_*, MAIL_*) **no** se copian aquí: siguen en el entorno de Dokploy.
- Aviso: el compose no tiene backups de base de datos configurados en Dokploy a fecha de esta copia.

## GitHub Actions en el fork (2026-10-19)

Activados solo los workflows de tests y calidad (PHPUnit, PHPStan, Pint, NPM build/lint/format/typecheck/test, Playwright).
Desactivados con `gh workflow disable` (ajuste del repo, sin tocar ficheros, para no complicar merges con upstream):
build-public/private/onpremise, generate-api-docs, npm-publish-api/ui, phpunit-extensions, playwright-extensions
(necesitan repos privados de extensiones de solidtime-io), extension-manifest-check y vouch-*.

## Cambio al fork (2026-10-22)

- Dokploy usa `docs/deploy/dokploy-compose.fork.yml`: imagen `ghcr.io/untanglesl/solidtime:feature-m365-integration`
  (construida por `.github/workflows/fork-image.yml`), BD nueva en el volumen `database-storage-m365`
  (migraciones automáticas con `AUTO_DB_MIGRATE`). El volumen antiguo `database-storage` sigue existiendo, sin usar.
- La imagen en GHCR es privada (la organización no permite paquetes públicos). Dokploy la descarga con el registro
  `ghcr.io` (usuario `untangle-juan`, token classic solo `read:packages`, guardado también en Doppler `vps/prd`
  como `SOLIDTIME_GHCR_READ_TOKEN`).
- Verificado: los 5 contenedores arrancan, las migraciones se aplican, `/login`, `/register` y `/health-check/up` dan 200.
- Conocido: `scheduler` y `queue` aparecen como "unhealthy" porque el HEALTHCHECK de la imagen comprueba el puerto HTTP,
  que solo sirve `app`. Funcionan bien (el scheduler ejecuta sus tareas y el worker está en RUNNING). Pendiente de
  ajustar en el compose (fase 7).
