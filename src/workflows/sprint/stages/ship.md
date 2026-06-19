# 🚀 Ship — Release Engineering

> **Propósito:** Sync main, run full test suite, audit coverage, update changelog, push, open PR.
> **Inspiración:** gstack `/ship`
> **Artefactos que produce:** `release_notes` (notas de release), `pr_description` (descripción del PR)

---

## Paso 1: Verificar Estado

**Objetivo:** Asegurar que todo está listo para shippear.

**Acciones del agente:**
1. Lee el `qa_report` del artifact store — ¿el veredicto es PASS?
2. Lee el `review_report` del artifact store — ¿los bugs HIGH están fixeados?
3. Verifica que la rama actual esté actualizada con main
4. Verifica que no haya conflictos

**Validación:** ¿Estás seguro de que esto está listo para producción?

---

## Paso 2: Preparar Release

**Objetivo:** Dejar todo listo para el merge.

**Acciones del agente:**
1. Ejecuta `npm test` (o el comando de pruebas) para confirmar que todo pasa
2. Si hay auditoría de cobertura, verifica que cumple el mínimo
3. Actualiza el CHANGELOG.md con los cambios de esta release
4. Actualiza la versión si aplica (semver)
5. Asegúrate de que los archivos de documentación estén actualizados

**Formato de CHANGELOG:**
```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- Nueva funcionalidad A

### Changed
- Cambio en B

### Fixed
- Bug fix C

### Security
- Parche de seguridad D
```

**Validación:** ¿El changelog está actualizado? ¿La versión es correcta?

---

## Paso 3: Crear Pull Request

**Objetivo:** Abrir un PR bien documentado para el merge final.

**Acciones del agente:**
1. Haz commit de todos los cambios con mensaje convencional
2. Haz push a la rama
3. Prepara la descripción del PR

**Artefactos a producir:**
- `release_notes` — Notas de release para el changelog
- `pr_description` — Descripción del PR para GitHub/GitLab

**Formato del PR:**
```markdown
## Description
[Resumen de los cambios]

## Related Issues
Closes #XXX

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## How Has This Been Tested?
- [ ] Unit tests: N/N passing
- [ ] Integration tests: N/N passing
- [ ] Manual verification: [descripción]

## Checklist
- [ ] My code follows the project's style guidelines
- [ ] I have performed a self-review
- [ ] I have commented complex code
- [ ] I have updated the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective
- [ ] New and existing tests pass

## Screenshots (if applicable)
[ ]

## Additional Context
[Cualquier contexto adicional]
```

**Validación:** ¿El PR está listo para ser mergeado?

---

## Paso 4: Post-Ship

**Objetivo:** Cerrar el ciclo de ship.

**Acciones del agente:**
1. Si aplica, despliega a producción/staging
2. Verifica que el deploy fue exitoso (health check)
3. Notifica al equipo (si hay integración con Slack/Discord)
4. Prepara el contexto para la retrospectiva

**Validación:** ¿El código está en producción? ¿El equipo está notificado?
