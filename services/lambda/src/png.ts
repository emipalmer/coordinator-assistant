import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { initWasm, Resvg } from '@resvg/resvg-wasm';

// The wasm renderer and font are copied next to the Lambda bundle at build time (see infra);
// locally they're read from node_modules. Lambda has no system fonts, so we ship Inter.
const ASSETS = {
  wasm: { bundled: 'index_bg.wasm', pkg: '@resvg/resvg-wasm/index_bg.wasm' },
  regular: { bundled: 'Inter_400Regular.ttf', pkg: '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf' },
  semibold: { bundled: 'Inter_600SemiBold.ttf', pkg: '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf' },
};

function load(a: { bundled: string; pkg: string }): Uint8Array {
  const local = fileURLToPath(new URL(`./${a.bundled}`, import.meta.url));
  return readFileSync(existsSync(local) ? local : createRequire(import.meta.url).resolve(a.pkg));
}

let ready: Promise<Uint8Array[]> | undefined;

export async function svgToPng(svg: string, widthPx = 1600): Promise<Uint8Array> {
  ready ??= initWasm(load(ASSETS.wasm)).then(() => [load(ASSETS.regular), load(ASSETS.semibold)]);
  const fonts = await ready;
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: widthPx }, // 2x for crisp text on Retina phones
    font: { fontBuffers: fonts, defaultFontFamily: 'Inter', loadSystemFonts: false },
  });
  return r.render().asPng();
}
