// src/server/bundle-routes.ts
//
// HTTP admin surface for FeatureBundle registry queries.
// Consumed by dc-k8s-operator reconcilers to query bundles at runtime.
//
// Routes (all mounted under /api/feature-bundles by the caller):
//   GET    /                    -> list all bundles
//   GET    /by-fingerprint/:fp  -> find by fingerprint (must be before /:name)
//   GET    /:name               -> get latest version
//   GET    /:name/:version      -> get specific version
//   PATCH  /:name/:version      -> mark bundle deprecated
//   GET    /:name/crd-schema    -> JSON schema for a CRD referencing this bundle
//   POST   /validate            -> validate a bundle against catalog, return errors[]

import { Router, type HttpRouter, type Request, type Response } from './http-router.js';
import type {
  FeatureBundleRegistry,
  FeatureBundle,
} from '../bundles/FeatureBundle.js';
import { validateBundle } from '../bundles/FeatureBundle.js';
import type { IRegistry } from '../registry/types.js';

export interface BundleRoutesDeps {
  /** Isolated FeatureBundleRegistry instance (DI-friendly). */
  bundleRegistry: FeatureBundleRegistry;
  /** Event registry for validate endpoint transport/version checks. */
  registry: IRegistry;
}

export function createBundleRoutes(deps: BundleRoutesDeps): HttpRouter {
  const { bundleRegistry, registry } = deps;
  const router = Router();

  // GET /api/feature-bundles
  // Returns all registered bundles sorted by name then version.
  router.get('/', (_req: Request, res: Response) => {
    const bundles = bundleRegistry.list();
    res.json({ bundles, total: bundles.length });
  });

  // GET /api/feature-bundles/by-fingerprint/:fp
  // Reverse lookup used by CRD controllers that embed fingerprints.
  // Must be mounted BEFORE /:name to avoid the clash.
  router.get('/by-fingerprint/:fp', (req: Request, res: Response) => {
    const bundle = bundleRegistry.findByFingerprint(req.params.fp);
    if (!bundle) {
      res.status(404).json({ error: `No bundle found with fingerprint "${req.params.fp}"` });
      return;
    }
    res.json(bundle);
  });

  // POST /api/feature-bundles/validate
  // Validates a bundle descriptor against the current event catalog.
  // Body: FeatureBundle-shaped object (fingerprint may be empty string).
  // 200 { valid: true, errors: [] }  — passes
  // 200 { valid: false, errors: [...] } — validation failures
  // 400 { error: '...' }             — malformed request body
  router.post('/validate', (req: Request, res: Response) => {
    const body = req.body as Partial<FeatureBundle> | undefined;
    if (!body || typeof body.name !== 'string' || !Array.isArray(body.events)) {
      res.status(400).json({ error: 'body must be a FeatureBundle with name and events[]' });
      return;
    }
    // Tolerate a missing fingerprint — validation doesn't require it.
    const bundle: FeatureBundle = {
      name: body.name,
      version: typeof body.version === 'string' ? body.version : '0.0.0',
      fingerprint: typeof body.fingerprint === 'string' ? body.fingerprint : '',
      transport: body.transport ?? 'signal',
      events: body.events,
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.deprecated !== undefined ? { deprecated: body.deprecated } : {}),
    };
    const result = validateBundle(bundle, registry);
    res.json(result);
  });

  // GET /api/feature-bundles/:name/crd-schema
  // Returns a JSON Schema fragment for embedding in a K8s CRD spec.
  // Must be registered before /:name to avoid Express matching "crd-schema"
  // as the version segment of /:name/:version.
  router.get('/:name/crd-schema', (req: Request, res: Response) => {
    // Generated directly from the injected bundleRegistry rather than the
    // module-singleton `getCrdSchema` helper, so an isolated registry
    // (tests, multi-tenant callers) reports its own bundles.
    const bundle = bundleRegistry.get(req.params.name);
    if (!bundle) {
      res.status(404).json({ error: `Bundle "${req.params.name}" not found` });
      return;
    }
    const schema = {
      type: 'object',
      required: ['name', 'version', 'fingerprint'],
      properties: {
        name: { type: 'string', enum: [bundle.name] },
        version: { type: 'string' },
        fingerprint: { type: 'string', minLength: 64 },
      },
    };
    res.json(schema);
  });

  // GET /api/feature-bundles/:name/:version
  // Get a specific version of a bundle.
  router.get('/:name/:version', (req: Request, res: Response) => {
    const bundle = bundleRegistry.get(req.params.name, req.params.version);
    if (!bundle) {
      res.status(404).json({
        error: `Bundle "${req.params.name}" v${req.params.version} not found`,
      });
      return;
    }
    res.json(bundle);
  });

  // PATCH /api/feature-bundles/:name/:version
  // Mark a bundle version as deprecated.
  // Body: { deprecated: { since: string, replacement?: string } }
  // Returns: updated bundle (with deprecated field set + recomputed fingerprint)
  router.patch('/:name/:version', (req: Request, res: Response) => {
    const { name, version } = req.params;
    const body = req.body as { deprecated?: { since?: unknown; replacement?: unknown } } | undefined;

    if (!body?.deprecated || typeof body.deprecated.since !== 'string' || !body.deprecated.since.trim()) {
      res.status(400).json({ error: 'body must include deprecated.since (non-empty string)' });
      return;
    }

    const deprecation: { since: string; replacement?: string } = {
      since: body.deprecated.since.trim(),
    };
    if (typeof body.deprecated.replacement === 'string' && body.deprecated.replacement.trim()) {
      deprecation.replacement = body.deprecated.replacement.trim();
    }

    const updated = bundleRegistry.deprecate(name, version, deprecation);
    if (!updated) {
      res.status(404).json({ error: `Bundle "${name}" v${version} not found` });
      return;
    }

    res.json(updated);
  });

  // GET /api/feature-bundles/:name
  // Get the latest version of a named bundle.
  router.get('/:name', (req: Request, res: Response) => {
    const bundle = bundleRegistry.get(req.params.name);
    if (!bundle) {
      res.status(404).json({ error: `Bundle "${req.params.name}" not found` });
      return;
    }
    res.json(bundle);
  });

  return router;
}
