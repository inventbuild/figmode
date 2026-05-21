import * as esbuild from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function inlineUiBundle() {
  const template = readFileSync(join(root, "ui.template.html"), "utf8");
  const bundle = readFileSync(join(root, "ui.js"), "utf8");
  writeFileSync(join(root, "ui.html"), template.replace("<!--FIGMODE_UI_BUNDLE-->", bundle));
}

const uiBuildOptions = {
  entryPoints: [join(root, "ui/main.ts")],
  outfile: join(root, "ui.js"),
  bundle: true,
  format: "iife",
  target: "es2017",
  logLevel: "info",
  plugins: [
    {
      name: "inline-ui-html",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) {
            inlineUiBundle();
          }
        });
      },
    },
  ],
};

const watch = process.argv.includes("--watch");

if (watch) {
  const ctx = await esbuild.context(uiBuildOptions);
  await ctx.watch();
  console.log("Watching ui/main.ts → ui.html");
} else {
  await esbuild.build(uiBuildOptions);
  inlineUiBundle();
}
