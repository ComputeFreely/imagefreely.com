# Background Removal Vendor Notes

Image Freely uses browser-local background removal through small vendored
JavaScript wrappers and R2-hosted model files.

Vendored in this repo:

- `onnxruntime-web` 1.23.0, MIT license, https://github.com/microsoft/onnxruntime
- `@bunnio/rembg-web` 1.0.2, MIT license, https://github.com/bunn-io/rembg-web

Files in `assets/vendor/rembg/`:

- `ort.min.js`
- `ort-wasm-simd-threaded.jsep.mjs`
- `ort-wasm-simd-threaded.jsep.wasm`
- `ort-wasm-simd-threaded.mjs`
- `ort-wasm-simd-threaded.wasm`
- `rembg-web.umd.min.js`

R2-hosted model files:

- Bucket: `imagefreely-data`
- Custom domain: `https://data.imagefreely.com`
- Model prefix: `background-removal/1.0.2/models/`
- Default model: `u2netp.onnx`
- Expected SHA-256: `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`

The editor loads these assets only when the user clicks "Remove background".
User images remain local in the browser.

Current source commands:

```sh
tmpdir="$(mktemp -d)"
curl -L https://registry.npmjs.org/@bunnio/rembg-web/-/rembg-web-1.0.2.tgz -o "$tmpdir/rembg-web.tgz"
curl -L https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.23.0.tgz -o "$tmpdir/onnxruntime-web.tgz"
curl -L https://github.com/bunn-io/rembg-web/releases/download/base-models/u2netp.onnx -o "$tmpdir/u2netp.onnx"
```

Hash checks:

```sh
shasum -a 256 assets/vendor/rembg/*
curl -fsSL https://data.imagefreely.com/background-removal/1.0.2/models/u2netp.onnx | shasum -a 256
```
