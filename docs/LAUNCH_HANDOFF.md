# Launch handoff

**Saved to Shipped v0.4.0b1** is the free local release. The optional hosted service stays closed until its existing deployment/capacity checks pass. This page is the short operator handoff; [the checklist](RELEASE_CHECKLIST.md) records what actually completed, and [Releasing](RELEASING.md) owns the full artifact procedure.

## Finish the candidate

Finish the focused product polish and selected-source retrieval regression, refresh the synthetic public screenshots, then run the relevant final checks. Merge the reviewed candidate and record its exact release commit and CI URLs. Do not treat the previous `7505833` results as tests of later code or assets.

Use Python 3.10+ with `requirements-dev.txt` installed. From the clean reviewed checkout, build into a fresh directory:

```sh
python -m build --outdir dist/v0.4.0b1
python -m twine check --strict dist/v0.4.0b1/*
python scripts/check_distribution.py --dist dist/v0.4.0b1 --install
```

Generate the checksum file without including unrelated files:

```sh
python -c "from pathlib import Path; from hashlib import sha256; d=Path('dist/v0.4.0b1'); files=sorted([*d.glob('*.whl'), *d.glob('*.tar.gz')]); (d/'SHA256SUMS').write_text(''.join(sha256(p.read_bytes()).hexdigest()+'  '+p.name+chr(10) for p in files))"
```

Record the exact commit and successful checks alongside those hashes. The release-note source is [v0.4.0b1](releases/v0.4.0b1.md). Keep personal archives, settings, provider responses and browser state outside the artifacts.

## Publish the local beta

Complete the source/history and artifact privacy review first. GitHub CLI visibility/reporting commands, from an authenticated maintainer session:

```sh
gh repo edit the-anantkumar/saved-to-shipped --visibility public --accept-visibility-change-consequences
gh api --method PUT repos/the-anantkumar/saved-to-shipped/private-vulnerability-reporting
gh api repos/the-anantkumar/saved-to-shipped/private-vulnerability-reporting
```

Verify `enabled: true` and the **Security → Report a vulnerability** route after visibility changes and before announcement. If that route cannot be enabled, finish the private-contact fallback in [Security](../SECURITY.md) before announcing.

Replace `REVIEWED_RELEASE_COMMIT` with the recorded full commit SHA. Create the prerelease with only the verified assets:

```sh
gh release create v0.4.0b1 \
  dist/v0.4.0b1/*.whl dist/v0.4.0b1/*.tar.gz dist/v0.4.0b1/SHA256SUMS \
  --target REVIEWED_RELEASE_COMMIT --prerelease \
  --title "Saved to Shipped v0.4.0b1" --notes-file docs/releases/v0.4.0b1.md
```

Verify the release and asset downloads anonymously, compare downloaded hashes, and install the downloaded wheel in a fresh environment before linking the release announcement. Never move an existing published tag or silently replace an artifact with a different build. PyPI ownership/publishing setup is a separate optional step.

## Hosted setup stays separate

The real Firebase development path is already documented in [Firebase setup](FIREBASE_SETUP.md). From `hosted/`, Node 24 and the pinned dependencies support these preparation commands:

```sh
npm ci
npm run typecheck
npm run release:check
```

The last command builds and checks a **closed** production bundle; it does not deploy. The deployment-specific configuration is an ignored `hosted/.local/deploy.jsonc`, copied and adjusted as described in [Hosted operations](HOSTED_OPERATIONS.md#prepare-a-real-preview):

| Setting | Handoff |
| --- | --- |
| Entry/assets | `main: ../src/app.ts`; assets directory `./client-assets`; preserve Firebase namespace bindings and both migration tags. |
| API/admission | Keep `HOSTED_ENABLED=false`, `ADMISSION_OPEN=false`, `PROCESSING_OPEN=false`, `BETA_CAP=0` for the first closed deployment. |
| Identity/origin | Exact HTTPS `APP_ORIGIN`; matching `FIREBASE_PROJECT_ID`/public configuration; authorized Firebase domain; explicit operator/test UIDs. |
| Storage | Existing Enterprise Native database `save2ship`; scoped service account; Cloudflare Free and Firebase Spark without overage billing. |
| Server secrets | `SESSION_SIGNING_KEY`, `CREDENTIAL_KEYS`, `FIRESTORE_SERVICE_ACCOUNT`, supplied through the platform prompt/store. No values in source, command arguments or chat. |

Before any real deployment, review the exact target/configuration and the [existing shipping gates](SHIP_PLAN.md). The reviewed-config dry run is:

```sh
npx wrangler deploy --config .local/deploy.jsonc --dry-run --outdir .local/reviewed-deploy
```

[Hosted operations](HOSTED_OPERATIONS.md) contains the real deployment, secret, verification and rollback commands. Daily reservation calibration, cloud metering and real-account acceptance remain open there. No synthetic UAT entrypoint or public proxy to the local Python server is a hosted release.
