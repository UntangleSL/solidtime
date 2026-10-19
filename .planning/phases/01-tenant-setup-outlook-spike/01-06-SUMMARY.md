---
phase: 01-tenant-setup-outlook-spike
plan: 06
subsystem: testing
tags: [microsoft-graph, calendarview, fixtures, round-a, gate-failed]

requires:
  - phase: 01-tenant-setup-outlook-spike
    provides: "01-03 sanitizer and fixture gate, 01-05 registered and verified Entra app"
provides:
  - "Round A raw capture exists locally (git-ignored); sanitize and gate were run against it"
  - "Gate verdict: one semantic failure (S8 has an attendee), nothing committed from fixtures"
affects: [01-06, 01-07, 01-08]

actuals:
  tokens: 12000
  tasks: 1
  commits: 0
plan_head_before: 77d555a47fb52d0b49f900c8fe5ea0eabda90f91
plan_head_after: 77d555a47fb52d0b49f900c8fe5ea0eabda90f91

key-files:
  created: []
  modified: []

key-decisions:
  - "The plan's own stop rule was applied: S8 with an attendee list fails the semantic gate, so no fixture is committed and no predicate was loosened without an owner decision"

requirements-completed: []

duration: 6min
completed: 2026-10-19
status: blocked
---

# Phase 1 Plan 06: Round A capture and fixtures (BLOCKED at the gate, S8) Summary

**Round A was captured and sanitized; the gate passed schema, leaks and replay but failed one semantic rule: the `[M365-TEST S8] block` event is organized by A with an attendee list that contains A herself. Per the plan, nothing was committed from the fixtures and the generated files were removed. Round B must NOT start.**

## Estado en una frase (para la propietaria)

Falta un solo arreglo pequeño en el buzón de A (S8) y repetir la captura de la Ronda A. Todo lo demás de la Ronda A está bien.

## Resultado de la puerta (gate)

Comando: `doppler run -p vps -c dev -- node tests/Tools/m365-spike/validate-fixtures.mjs --round A --raw tests/Tools/m365-spike/raw`

| Check | Resultado |
|-------|-----------|
| `--schema` | OK (652 checks): manifest con los 11 escenarios obligatorios presentes, sin huérfanos |
| `--leaks` (con `--raw`) | OK (138 checks): ningún valor del raw ni evento sin etiqueta en los ficheros |
| `--replay` | OK (6 checks): 5 pasadas completas, 22 peticiones y 14 eventos etiquetados cada una |
| `--semantic` | FALLA: `S8 round A: expected an organized event without attendees` |

`validate-docs.mjs secrets`: OK (1536 checks). Suite completa de node (`tests/Tools/m365-spike/test/*.test.mjs`): 205 tests, 0 fallos.

Sanitize: 137 ficheros escritos, 13 escenarios presentes (11 obligatorios + 2 sintéticos SYN), 260 eventos sin etiqueta descartados. Tras el fallo se borraron los ficheros generados (queda solo `tests/Fixtures/M365/README.md`); `git status` no muestra nada de fixtures y `raw/` sigue ignorado. `raw/salt` e `identity-map.json` se conservan (necesarios hasta 01-08).

## Lista de arreglos para el administrador / propietaria (en español)

Solo hay un escenario mal. Los demás obligatorios (S1, S1b, S2, S3, S4, S5, S5b, S6, S6b, S7) pasan.

| Escenario | Qué está mal | Qué hacer (Parte 8, fila S8) |
|-----------|--------------|------------------------------|
| S8 `[M365-TEST S8] block` | Graph devuelve `attendees` con un elemento: la propia usuaria A como asistente "required". La fila S8 exige "Sin asistentes". | En el Outlook web de A abrir el evento, comprobar el campo de asistentes ("Invitar a asistentes"). Si aparece A, quitarla y **Guardar** (no hay a quién enviar nada). Dejar "Mostrar como: Ocupado". |

Pasos, en orden:

1. A (o la propietaria con el buzón de A) arregla S8 como arriba. Opcional, ya que se toca el evento: moverlo al miércoles 2026-10-28, 14:00-15:00, como dice la guía (se aceptó el martes 27; la fecha no afecta a la puerta).
2. No tocar ningún otro evento ni empezar la Parte 9 (Ronda B).
3. El desarrollador repite en su terminal: `doppler run -p vps -c dev -- node tests/Tools/m365-spike/capture.mjs capture --round A` (ventana nueva InPrivate, iniciar sesión como A).
4. Se repite la Tarea 2 de 01-06 (sanitize, gate, commit). Los seudónimos de los eventos que no cambian saldrán idénticos porque se conserva `raw/salt`.

Aviso importante: S7 (todo el día, creado por A) tiene exactamente el mismo patrón (`attendees` = [A]). Dos eventos sin invitados, creados en el mismo cliente (Outlook web), devuelven a A como asistente. Puede ser un descuido al crearlos o un comportamiento sistemático de este cliente. Si tras quitar a A y recapturar S8 sigue devolviendo `attendees` con A, no es un error de la propietaria sino un hecho real de Graph: en ese caso hace falta una decisión (ver más abajo).

## Decisión pendiente si el patrón persiste (para el orquestador / propietaria)

Si S8 recapturado vuelve a traer `attendees: [A]`, hay dos opciones:

- **Aceptarlo como hecho real:** cambiar el predicado `isAlone` de `validate-fixtures.mjs` a "organizado y sin asistentes distintos del organizador", con un test de regresión (Rule 1) y dejar constancia en el manifest/README de que Outlook web añade a la organizadora como asistente. Se pierde el caso `attendees: []` en los fixtures, así que habría que decidir si Phases 3-4 necesitan ese caso (se podría añadir un escenario extra creado de otra forma, o un derivado SYN).
- **Forzar `attendees: []`:** crear S8 desde otro cliente (Outlook clásico/escritorio) y capturar de nuevo.

No se ha aflojado ningún predicado: el plan nombra expresamente "S8 with attendees" como motivo de parada.

## Ronda B

**NO empezar la Parte 9.** El administrador no debe mover, cancelar ni rechazar nada hasta que la Ronda A esté capturada de nuevo, pase la puerta y quede commiteada; entonces se avisará con "Ronda A capturada". Las instrucciones de la Ronda B (quién hace qué en Outlook y en qué orden) se entregarán en ese momento, tomadas de la guía Parte 9.

## Hallazgos provisionales de la captura (no commiteados, se regeneran al repetir)

Estos datos son de la primera captura y de eventos etiquetados o agregados; se confirmarán tras la recaptura.

- Ventana: 2026-10-19 a 2026-11-16, cliente Outlook web, zona del buzón `Romance Standard Time` (Europe/Madrid); Graph devolvió UTC en todas las páginas con `Prefer`.
- Estados: prod-select, prefer-separate, no-immutableid, experiment-select, full-shape y series respondieron 200; page2-no-prefer 200 (2 páginas, 6 eventos).
- Prefer combinado y en dos líneas: ambos 200 con UTC en todas las páginas.
- Página 2 sin cabeceras `Prefer`: sigue devolviendo UTC, pero los ids de sus eventos etiquetados son distintos de los de la pasada con `Prefer` (0 iguales, 3 distintos). Conclusión provisional: las cabeceras hay que reenviarlas en cada petición, también al seguir `@odata.nextLink`.
- Formato de id: con inmutable 68-84 caracteres, por defecto 152-168; charset `A-Za-z0-9-=_`; ninguna coincidencia entre ambos (0 iguales, 14 distintos).
- `$select` de producción: 200, no devuelve `lastModifiedDateTime` ni `attendees`; el de experimento (los añade): 200 y los devuelve.
- Serie maestra: 200, `recurrence` presente, `cancelledOccurrences` ausente.
- S2: 4 ocurrencias en la ventana (martes 20 oct a 10 nov, la del 13 oct queda fuera por la ventana); la puerta confirma evidencia de cambio horario (la hora UTC cambia entre el 20 y el 27 de octubre).
- `observed` por escenario (Ronda A): S1, S3, S4, S5, S5b y S6b: `singleInstance`, `isOrganizer=false`, respuesta `accepted`, sensibilidad `normal`; S1b: organizado, `organizer`; S6: organizado, sensibilidad `private`; S7: todo el día, organizado, respuesta `none`; S8: organizado, respuesta `none`; S2: 4 eventos, primero `occurrence` aceptado.

## Comprobación humana de la lista permitida (allow-list) — realizada por el orquestador

Comparación de claves (solo claves, sin valores) de los 14 eventos etiquetados de `full-shape` en raw contra los saneados:

- Claves en raw: 43. Claves en los ficheros saneados: 34. Ninguna clave añadida.
- **Claves de evento descartadas:** `body`, `bodyPreview`, `categories`, `hasAttachments`, `isReminderOn`, `onlineMeetingProvider`, `reminderMinutesBeforeStart`, `transactionId`, `uid`.
- Subclaves descartadas: de `location` y `locations`, `locationType`, `uniqueId`, `uniqueIdType` (y `address`, `coordinates` en `location`); de `attendees` y `onlineMeeting` no se descarta nada (`type`, `status`, `emailAddress`; `joinUrl`).
- Para juzgar: ninguna clave descartada parece dato de decisión para las fases 3-6 (`onlineMeetingProvider` es el único dudoso, pero `isOnlineMeeting` y `joinUrl` se conservan). Si alguna fase lo necesita, se añade a la allow-list de `lib/sanitize.mjs` con test.
- La unión de claves se calculó sobre los 14 eventos etiquetados; no se leyó ni imprimió ningún evento sin etiqueta.

## Deviations from Plan

**1. [Parada por regla del plan] S8 con asistente, gate semántico en rojo**
- **Found during:** Task 2, step 2
- **Issue:** `validate-fixtures.mjs --round A` falla en `S8 round A: expected an organized event without attendees`; el evento tiene `attendees` = [A].
- **Action:** por el paso 3 de la tarea, no se commitea nada de fixtures, se borraron los generados (excepto README.md) y se escribe esta lista de arreglos. No es un defecto del validador: el plan lo nombra como fallo ("S8 with attendees"). La decisión de aflojarlo si el patrón persiste queda arriba.
- **Files modified:** ninguno (solo ficheros generados sin versionar, ya eliminados)

**2. [Aceptado por el orquestador] S8 creado el martes 2026-10-27 en vez del miércoles 2026-10-28**
- No afecta a ninguna regla de la puerta; se corrige opcionalmente al arreglar S8. Los opcionales S7b y E1-E6 no se crearon por decisión de la propietaria; los validadores solo exigen los once obligatorios y no fallaron por su ausencia.

## Issues Encountered

None beyond the gate failure above. Tarea 1 (checkpoint humano) quedó completa con la captura de 2026-10-19T16:27:59Z.

## Known Stubs

None. No se creó ni modificó código.

## Threat Flags

None. T-01-20 (fuga): no se commiteó ningún fixture; el escaneo de fugas contra raw pasó. T-01-21: solo se inspeccionaron claves de eventos con etiqueta `[M365-TEST`.

## Next Steps

1. Propietaria/A: arreglar S8 (ver lista) y avisar.
2. Desarrollador: `capture --round A` otra vez.
3. Repetir Tarea 2 de 01-06; si `isAlone` sigue fallando por el patrón [A], decidir según la sección de decisión pendiente.
4. Solo entonces: "Ronda A capturada — el administrador puede empezar la Parte 9".

## Self-Check: PASSED

SUMMARY exists, `git status` shows no fixture files and `tests/Tools/m365-spike/raw` untracked-but-ignored, `raw/salt` and `raw/identity-map.json` present; no code commits were made (plan_head_before equals plan_head_after).
