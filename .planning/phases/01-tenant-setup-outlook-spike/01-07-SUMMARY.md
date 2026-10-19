---
phase: 01-tenant-setup-outlook-spike
plan: 07
subsystem: testing
tags: [microsoft-graph, calendarview, fixtures, round-b, phpunit, http-fake]

requires:
  - phase: 01-tenant-setup-outlook-spike
    provides: "01-03 sanitizer and fixture gate, 01-06 committed Round A fixtures"
provides:
  - "Sanitized Round B fixtures committed under tests/Fixtures/M365 (calendarview passes, scenarios, series, 11 lookups) and manifest round_b entries"
  - "Real Outlook/Graph behaviour of an edited occurrence, a cancellation, a decline, a same-day move and a move out of the window, as seen by the attendee"
  - "tests/Unit/M365/CalendarViewFixturesTest.php: manifest-driven Http::sequence replay for Phases 2-6"
affects: [01-08, phase-3, phase-4]

actuals:
  tokens: 40000
  tasks: 3
  commits: 3
plan_head_before: 52cf9dc3f38bded83b2798935a04f212b3d9c530
plan_head_after: e1cb75ee83a262ae77552e03f958fc953870075a

key-files:
  created:
    - tests/Fixtures/M365/lookups/
    - tests/Fixtures/M365/calendarview/roundB.*
    - tests/Fixtures/M365/scenarios/*.roundB.json
    - tests/Fixtures/M365/series/S2.*.roundB.json
    - tests/Unit/M365/CalendarViewFixturesTest.php
  modified:
    - tests/Fixtures/M365/manifest.json
    - tests/Tools/m365-spike/validate-fixtures.mjs
    - tests/Tools/m365-spike/test/validate-fixtures.test.mjs

key-decisions:
  - "Rule 1: the S2 round B gate reads originalStart from the prod-select pages when the scenario file (default shape) lacks it"
  - "S3 (cancelled but not processed by A) and S4 (declined) are recorded as Outlook reported them, not as the plan hypothesised"
  - "S6 privacy observation (sensitivity propagates to attendees) is informational for 01-08, not in fixtures"

requirements-completed: [SETUP-02]

duration: 20min
completed: 2026-10-19
status: complete
---

# Phase 1 Plan 07: Round B capture and fixtures Summary

**Round B is captured, sanitized and committed next to Round A (which stayed byte-identical); the full gate passes (1542 checks, schema, semantic, leaks against raw, replay of both rounds), and a manifest-driven PHPUnit replay test exists for later phases. The PHPUnit test itself has not run: PHP is not available on this host (CI/Sail pending).**

## Resultado de la puerta

| Check | Resultado |
|-------|-----------|
| `validate-fixtures.mjs --raw tests/Tools/m365-spike/raw` (ambas rondas) | `validate-fixtures: OK (1542 checks)`; replay A: 22 peticiones por pasada, replay B: 21 peticiones por pasada |
| `validate-fixtures.mjs --schema --replay` (tras añadir el test PHP) | `validate-fixtures: OK (1240 checks)` |
| `validate-docs.mjs secrets` | `secrets: OK (1811 checks)` |
| `node --test "tests/Tools/m365-spike/test/*.test.mjs"` | 208 tests, 208 pasan (207 + 1 de regresion nuevo) |
| Determinismo | `git diff --name-only -- tests/Fixtures/M365` antes de commitear: solo `manifest.json`; ninguna ruta `roundA`, `me.json`, `token-response.shape.json` ni `SYN-`. Ronda A identica byte a byte |
| PHPUnit `CalendarViewFixturesTest` | **no disponible** (sin PHP en este equipo); comprobada solo la estructura (grep de los constructos exigidos) y que todas las rutas del manifest existen. Pendiente de CI (`phpunit.yml`) o Sail |

Captura Round B: 2026-10-19T17:04:30Z, misma ventana que Round A (2026-10-19 a 2026-11-16). Las pasadas devolvieron 200 (prod-select 21 paginas y 63 eventos en raw, frente a 22 y 65 en Round A: S4 y S5b desaparecen del calendarView); lookups: 65 consultas directas en raw, 14 etiquetadas conservadas en fixtures (13 con 200, 1 con 404).

## Hechos por escenario (del manifest saneado)

| Escenario | round_b.present | id_equal | round_b.lookup | Observed (Round B) |
|-----------|-----------------|----------|----------------|--------------------|
| S1 | true | true | 200, isCancelled=false | sin cambios |
| S1b | true | true | 200, isCancelled=false | sin cambios (attendeesOtherThanOrganizer=1) |
| S2 | true (4 eventos) | true | 200, isCancelled=false | la repeticion del 2026-11-03 aparece como `type=exception` con asunto `[M365-TEST S2] series (edited)` y start 10:00 UTC (antes 09:00 UTC); las otras tres siguen `occurrence`; mismo `seriesMasterId` |
| S3 | true | true | 200, isCancelled=true | cancelada por B y no procesada por A: **sigue presente en calendarView** con `isCancelled=true`, mismo id, `responseStatus=accepted` |
| S4 | **false** | null | **404 ErrorItemNotFound** | A rechaza con "enviar la respuesta ahora": **desaparece del calendarView y la consulta directa por el id de la Ronda A da 404** |
| S5 | true | true | 200, isCancelled=false | movida a 11:00-11:30 el mismo dia: **mismo id**, `responseStatus` pasa de `accepted` a `notResponded` |
| S5b | **false** | null | 200, isCancelled=false | movida fuera de la ventana: ausente del calendarView, pero la consulta directa por el id de la Ronda A da 200 (el id se conserva) |
| S6 | true | true | 200, isCancelled=false | sin cambios, `sensitivity=private` |
| S6b | true | true | 200, isCancelled=false | sin cambios, `sensitivity=normal` |
| S7 | true | true | 200, isCancelled=false | sin cambios (dia completo, attendeesOtherThanOrganizer=0) |
| S8 | true | true | 200, isCancelled=false | sin cambios (attendeesOtherThanOrganizer=0) |
| SYN-confidential, SYN-personal | n/a | n/a | n/a | sinteticos derivados de S6 Round A; `synthetic: true` |

Los opcionales E1, E2, E6, S7b, E3, E4, E5 no se crearon: ausentes, no fallos.

## Hallazgos para la decision 01-08

1. **Los ids son estables entre rondas** para S1-S3, S5-S8 (id_equal true) y, por lookup, tambien para S5b (movida fuera de ventana): mover una reunion no cambia el id con `Prefer: IdType="ImmutableId"`.
2. **Cancelacion no procesada (S3):** el evento sigue en calendarView con `isCancelled=true`; no se borra solo del calendario del asistente. El sync debe tratar `isCancelled=true` como cancelado y no asumir ausencia.
3. **Rechazo (S4):** al rechazar con respuesta enviada, Graph deja de listar el evento y `GET /me/events/{id}` devuelve 404 `ErrorItemNotFound`. Un evento rechazado equivale a "desaparecido" para el sync; no hay `responseStatus=declined` en calendarView para este caso (el predicado de la puerta acepta ambas representaciones).
4. **Movida (S5):** mismo id, nuevas horas; la actualizacion resetea la respuesta a `notResponded`.
5. **Movida fuera de la ventana (S5b):** desaparece del calendarView de la ventana, pero la consulta directa sigue dando 200 con el mismo id: ausencia en calendarView no implica borrado.
6. **Excepcion de serie (S2):** `type=exception` con `seriesMasterId` comun; **`originalStart` solo viene cuando se pide en `$select`** (prod-select lo trae como cadena `"2026-11-03T09:00:00Z"`; la forma por defecto sin `$select` no lo incluye). Por eso el `$select` de produccion debe incluirlo.
7. **Privacidad (informativo, no en fixtures):** la propietaria observa que S6 (organizada por A, marcada Privada) aparece como Privada en el calendario de B: la sensibilidad se propaga a los asistentes. S6b no fue marcada Privada por B (error de la propietaria), por lo que `sensitivity=normal` en el calendario de A es lo esperado y correcto; no es un hallazgo de Graph sobre privacidad en el lado del asistente.
8. Experimentos Round B: `round_b_lookups` = `{200: 13, 404: 1}`; `id_format` de Round B registrado en `calendarview/roundB.id-format.json`.

## Deviations from Plan

**1. [Rule 1 - Bug] El gate semantico de S2 en Round B no encontraba la excepcion editada**
- **Found during:** Task 2, `validate-fixtures --raw` (`FAIL semantic: S2 round B: no exception whose originalStart differs from start`)
- **Issue:** el gate leia `originalStart` solo de los ficheros de escenario, que salen de la pasada `full-shape` (sin `$select`); ahi Graph no devuelve `originalStart`. La mutacion si ocurrio (la excepcion existe, con otra hora y asunto) y las paginas prod-select, que lo traen, lo confirman. No era un fallo de la propietaria ni de la captura.
- **Fix:** `isMovedException` usa `event.originalStart` o, si falta, el `originalStart` del mismo evento (por id) en las paginas prod-select de Round B listadas en el manifest. No se relajo ningun check de fugas o esquema; si no hay `originalStart` en ningun sitio, o es igual a `start`, sigue fallando. Test de regresion de tres casos (usa el de la pagina; sin `originalStart` en ningun sitio falla; igual a `start` falla).
- **Files modified:** `tests/Tools/m365-spike/validate-fixtures.mjs`, `tests/Tools/m365-spike/test/validate-fixtures.test.mjs`
- **Commit:** `7d121e4d`

Con el fix no hubo que tocar el sanitizador ni la captura, y ningun fichero Round A cambio.

**Nota:** `$select` y la deteccion con `type=exception` quedan como dos evidencias; el hallazgo 6 se traslada a 01-08.

## Issues Encountered

- El guard de secretos del entorno bloqueo `node --env-file=tests/Tools/m365-spike/.env.local`; se uso el wrapper de Doppler indicado por el orquestador (mismo resultado, `status`, `sanitize` y `validate-fixtures --raw`).
- Las paginas sanitizadas conservan solo eventos etiquetados `[M365-TEST`: el replay cuenta 14 eventos (Round A) y 12 (Round B) por pasada; 520 eventos sin etiqueta descartados en el saneado. Solo se inspeccionaron eventos con esa etiqueta.

## Known Stubs

None.

## Threat Flags

None. T-01-23: leak gate contra raw, `validate-docs.mjs secrets` y revision de ficheros saneados antes de commitear. T-01-24: ningun valor editado a mano; Round A identico byte a byte. T-01-25: el test PHP usa `Http::fake` con `Http::preventStrayRequests()` heredado de `Tests\TestCase`.

## Commits

- `7d121e4d` fix(01-07): S2 round B gate reads originalStart from the prod-select pages
- `3f3168b2` test(01-07): add sanitized Round B fixtures and lookups for the Outlook spike (137 ficheros)
- `e1cb75ee` test(01-07): add manifest-driven PHPUnit replay of the calendarView fixtures

## Self-Check: PASSED

- FOUND: tests/Unit/M365/CalendarViewFixturesTest.php, tests/Fixtures/M365/lookups/ (11 ficheros), tests/Fixtures/M365/manifest.json con `round_b` en los once escenarios obligatorios
- FOUND commits: 7d121e4d, 3f3168b2, e1cb75ee
- `raw/salt` e `identity-map.json` conservados; `raw/` sigue ignorado por git
