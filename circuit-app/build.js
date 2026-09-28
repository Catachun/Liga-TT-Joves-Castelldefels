const esbuild = require("esbuild");
const fs = require("fs");

const isWatch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/index.jsx"],
  bundle: true,
  outfile: "public/bundle.js",
  minify: true,
  sourcemap: false,
  target: ["es2019"],
  loader: { ".js": "jsx" },
  define: { "process.env.NODE_ENV": '"production"' },
};

// Extract CSS emitted alongside JS is not needed here — style.css is
// imported directly and esbuild will write public/bundle.css from it
// when css is bundled via the "css" outfile below.
esbuild
  .build({
    ...options,
    outfile: "public/bundle.js",
  })
  .then(() => {
    // Bundle CSS separately (esbuild extracts CSS from JS imports into
    // a sibling .css automatically when using outdir; with a single
    // outfile we build it explicitly here).
    return esbuild.build({
      entryPoints: ["src/style.css"],
      bundle: true,
      outfile: "public/bundle.css",
      minify: true,
    });
  })
  .then(() => {
    console.log("Build complete.");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
