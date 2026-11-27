---
phase: 08-project-hour-budgets-profitability
plan: 20
subsystem: release
tags: [release, dokploy, budg, chrg]
requires: [08-19]
provides:
  - "docs/deploy/dokploy-compose.fork.yml pinned to ghcr.io/untanglesl/solidtime:sha-d81587b with the Phase 8 header line"
  - "Production time.untangle.es on sha-d81587b (Phase 8 project budgets & profitability), checked from outside"
affects: []
requirements-completed: [BUDG-01, BUDG-02, BUDG-03, BUDG-04, BUDG-05, BUDG-06, BUDG-07, CHRG-01, CHRG-02, CHRG-03]
status: complete
completed: 2026-11-27
---

# 08-20 Summary: Phase 8 release

Executed by the orchestrator.

## Task 1: release artifact

- R = d81587b36d90d3f1cd232151cb364827cc57aefb (merge of 08-19, pushed; origin equals HEAD).
- Ten workflows on R: Fork - Build image, NPM Build, NPM Format Check, NPM Lint, NPM Test Unit, NPM Typecheck,
  PHP Linting, PHPUnit Tests, Playwright Tests, Static code analysis (PHPStan): all success. Playwright first
  failed on one shard at "Install Playwright Browsers" (apt 403 from packages.microsoft.com, no test ran); the
  re-run passed (2 flaky retries that passed, 0 failed).
- PHPUnit PASS lines: Profitability 108 (27 classes x 4 jobs), Microsoft365 196. 2586 tests passed per job.
- Image tag `solidtime:sha-d81587b` present in the Fork - Build image log (14 matches).
- Pin commit 53b5105f `chore(08-20): pin release image sha-d81587b`; `validate-docs secrets` OK (2536 checks).

## Task 2: deploy

- Dokploy compose PtyO0frWvgS_QEaN9g1bW updated with the pinned file; deployment GTdsg24_JeYgUdRU-G8EI
  "Phase 8: project budgets & profitability (sha-d81587b)" done 2026-11-27 20:31:34-20:33:02 UTC.
- app, scheduler and queue: running, healthy. database and gotenberg untouched (healthy).
- Migrations: not visible (compose log tool unavailable); the app started healthy with AUTO_DB_MIGRATE and the
  new routes answer, so they ran. Environment tab not touched. Legacy non-billable counts: not available (no
  container exec tool).

## Task 3: public checks

- `/health-check/up` 200, `/login` 200.
- `/profitability`, `.../projects/{id}/summary`, `.../views/projects` without a session: 401 each (protected).
- Deployed bundle (165 chunks): all 8 markers present (summary card, page, projects, clients, people, settings
  views, contract editor, plan grid).

## Mensaje para la propietaria

Ya está publicada la fase 8 en time.untangle.es. En el menú hay una página nueva, «Profitability» (saldrá
«Rentabilidad» cuando la app esté en español).
Antes de mirar cifras, configura en Profitability > Settings:
1. El coste por hora y la jornada semanal con su objetivo de cargabilidad de cada persona.
2. Los project managers de cada proyecto y los account managers de cada cliente.
3. Los proyectos «Vacaciones» y «Festivo» como proyectos de ausencia.
Después, en cada proyecto de cliente, pulsa «Set contract terms» (horas e importe por periodo y renovación) y,
si quieres, «Plan months» para repartir las horas.
Desde hoy, el tiempo en un proyecto facturable siempre se guarda como facturable. Las horas antiguas no
facturables no se tocan.

## Comprobaciones de la propietaria

1. Settings: añadir coste por hora y jornada (40 h, 75 %) a dos personas, marcar Vacaciones y Festivo como
   ausencia, asignar un account manager a un cliente y un project manager a uno de sus proyectos. Cada cambio
   se guarda con confirmación.
2. En un proyecto facturable real: «Set contract terms» (mensual o trimestral, inicio a mitad de mes, horas e
   importe) y «Plan months» cargando más horas al principio. La tarjeta muestra el primer tramo prorrateado,
   horas vendidas, consumidas y por consumir, la proyección a cierre y el gráfico mensual; el plan solo se
   guarda si los meses suman las horas vendidas.
3. Pestañas Projects, Clients y People: el margen de un cliente y la cargabilidad de una persona cuadran con lo
   que esperas; Vacaciones y Festivo bajan las horas disponibles.
4. El project manager ve Profitability solo con horas (sin importes ni márgenes); un employee no ve nada nuevo.
5. Registrar tiempo en un proyecto facturable e intentar marcarlo como no facturable: se queda facturable. La
   tarjeta y los gráficos se leen bien en tema claro y oscuro y en el móvil.

Open decisions noted for later (not blocking): extending the end date of a one-off contract that already
started is locked; a contract created while its project is archived back-fills its periods on un-archive.
