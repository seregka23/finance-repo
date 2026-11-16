// Nest's optional loaders catch this rejection for unused feature packages.
// Throw on import rather than pretending to implement the missing package.
throw new Error(
  'This optional NestJS package is not installed. Install it and remove its alias in wrangler.jsonc before enabling the feature.',
);

export {};
