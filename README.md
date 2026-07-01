# Image Freely

Image Freely is a free browser image editor for one-image edits and batch image conversion.

Live site: https://imagefreely.com/

## Features

- Crop, resize, rotate, flip, and preview one image interactively.
- Export JPEG, PNG, WebP, or AVIF when supported by the browser.
- Set transparent or solid backgrounds.
- Remove backgrounds locally with an on-demand browser model.
- Re-encode images through Canvas to strip common EXIF and embedded metadata.
- Use `/bulk/` for multi-image compression, resizing, conversion, metadata cleanup, and ZIP downloads.

## Run Locally

This is a static site. From this directory:

```sh
python3 -m http.server 4175
```

Then open `http://localhost:4175`.

The bulk page is available at `http://localhost:4175/bulk/`.

## Notes

- Browser support determines which input and output image formats are available.
- AVIF export is only available in browsers that support AVIF encoding.
- Background removal loads a model from `https://data.imagefreely.com/background-removal/1.0.2/models/`.
- Very large images are limited by browser memory.

## License

CC0-1.0. See `LICENSE`.
