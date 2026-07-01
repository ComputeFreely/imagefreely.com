(function () {
  "use strict";

  var files = [];
  var nextId = 1;
  var processing = false;
  var objectUrls = [];

  var $ = function (selector) {
    return document.querySelector(selector);
  };

  var $$ = function (selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  };

  var presets = {
    email: {
      format: "image/jpeg",
      quality: 82,
      resizeMode: "max",
      maxEdge: 1600,
      filenameSuffix: "-email"
    },
    web: {
      format: "image/webp",
      quality: 80,
      resizeMode: "max",
      maxEdge: 1400,
      filenameSuffix: "-web"
    },
    avatar: {
      format: "image/png",
      quality: 100,
      resizeMode: "square",
      squareSize: 512,
      filenameSuffix: "-avatar"
    },
    social: {
      format: "image/jpeg",
      quality: 88,
      resizeMode: "cover",
      targetWidth: 1080,
      targetHeight: 1080,
      filenameSuffix: "-social"
    },
    convert: {
      format: "image/webp",
      quality: 90,
      resizeMode: "none",
      filenameSuffix: "-converted"
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    bindEvents();
    syncControls();
    render();
    detectAvifSupport();
  });

  function bindEvents() {
    var dropZone = $("#dropZone");
    var fileInput = $("#fileInput");

    fileInput.addEventListener("change", function () {
      addFiles(fileInput.files);
      fileInput.value = "";
    });

    ["dragenter", "dragover"].forEach(function (eventName) {
      dropZone.addEventListener(eventName, function (event) {
        event.preventDefault();
        dropZone.classList.add("dragging");
      });
    });

    ["dragleave", "drop"].forEach(function (eventName) {
      dropZone.addEventListener(eventName, function (event) {
        event.preventDefault();
        if (eventName === "drop" && event.dataTransfer) {
          addFiles(event.dataTransfer.files);
        }
        dropZone.classList.remove("dragging");
      });
    });

    $("#imageForm").addEventListener("input", function () {
      syncControls();
      render();
    });

    $("#imageForm").addEventListener("change", function () {
      syncControls();
      render();
    });

    $$(".preset").forEach(function (button) {
      button.addEventListener("click", function () {
        applyPreset(button.dataset.preset);
      });
    });

    $$(".mini-button[data-batch]").forEach(function (button) {
      button.addEventListener("click", function () {
        applyBatch(button.dataset.batch);
      });
    });

    $("#processSelected").addEventListener("click", function () {
      processSelected(false);
    });
    $("#downloadZip").addEventListener("click", function () {
      processSelected(true, true);
    });
    $("#downloadSelected").addEventListener("click", function () {
      processSelected(true, false);
    });
    $("#resetAll").addEventListener("click", resetAll);

    $("#imageGrid").addEventListener("click", handleCardClick);
    $("#imageGrid").addEventListener("change", handleCardChange);
  }

  function addFiles(fileList) {
    var added = 0;

    Array.prototype.forEach.call(fileList || [], function (file) {
      if (!isLikelyImage(file)) {
        return;
      }

      var url = URL.createObjectURL(file);
      objectUrls.push(url);
      var item = {
        id: String(nextId++),
        file: file,
        url: url,
        selected: true,
        width: 0,
        height: 0,
        status: "queued",
        error: "",
        result: null,
        resultUrl: ""
      };
      files.push(item);
      added += 1;
      readDimensions(item);
    });

    if (added) {
      setBadge(added + " image" + (added === 1 ? "" : "s") + " added");
    }

    render();
  }

  function isLikelyImage(file) {
    var name = file.name.toLowerCase();
    return /^image\//.test(file.type) || /\.(heic|heif|avif|webp|png|jpe?g|gif|bmp|tiff?)$/.test(name);
  }

  function readDimensions(item) {
    decodeImage(item.file)
      .then(function (image) {
        item.width = image.width;
        item.height = image.height;
        closeImage(image);
        render();
      })
      .catch(function () {
        item.status = "error";
        item.error = "This browser could not decode the image.";
        render();
      });
  }

  function syncControls() {
    var quality = clampNumber($("#quality").value, 35, 100, 82);
    $("#quality").value = quality;
    $("#qualityValue").textContent = quality + "%";

    var mode = $("#resizeMode").value;
    $$("[data-mode-field]").forEach(function (node) {
      var fieldMode = node.getAttribute("data-mode-field");
      var show = fieldMode === mode || (fieldMode === "exact" && (mode === "contain" || mode === "cover"));
      node.hidden = !show;
    });
  }

  function applyPreset(name) {
    var preset = presets[name];
    if (!preset) return;

    Object.keys(preset).forEach(function (id) {
      var element = $("#" + id);
      if (element) {
        element.value = preset[id];
      }
    });

    syncControls();
    render();
  }

  function applyBatch(action) {
    if (action === "select-all") {
      files.forEach(function (item) { item.selected = true; });
    } else if (action === "select-none") {
      files.forEach(function (item) { item.selected = false; });
    } else if (action === "invert") {
      files.forEach(function (item) { item.selected = !item.selected; });
    } else if (action === "remove-complete") {
      files = files.filter(function (item) {
        var keep = !item.result;
        if (!keep) revokeItemUrls(item);
        return keep;
      });
    }
    render();
  }

  function handleCardClick(event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var item = findItem(button.closest(".image-card").dataset.id);
    if (!item) return;

    var action = button.dataset.action;
    if (action === "process") {
      processItems([item], false, false);
    } else if (action === "download") {
      processItems([item], true, false);
    } else if (action === "remove") {
      removeItem(item.id);
    }
  }

  function handleCardChange(event) {
    if (!event.target.matches("[data-select]")) return;
    var item = findItem(event.target.closest(".image-card").dataset.id);
    if (item) {
      item.selected = event.target.checked;
      render();
    }
  }

  function removeItem(id) {
    files = files.filter(function (item) {
      var keep = item.id !== id;
      if (!keep) revokeItemUrls(item);
      return keep;
    });
    render();
  }

  function resetAll() {
    files.forEach(revokeItemUrls);
    files = [];
    objectUrls.forEach(URL.revokeObjectURL);
    objectUrls = [];
    $("#imageForm").reset();
    syncControls();
    setBadge("Ready");
    render();
  }

  function render() {
    var grid = $("#imageGrid");
    grid.innerHTML = "";
    $("#emptyState").hidden = files.length > 0;

    var settings = readSettings();
    var settingsKey = JSON.stringify(settings);

    files.forEach(function (item) {
      grid.appendChild(createCard(item, settingsKey));
    });

    var original = files.reduce(function (sum, item) { return sum + item.file.size; }, 0);
    var output = files.reduce(function (sum, item) { return sum + (item.result ? item.result.blob.size : 0); }, 0);
    var selectedCount = files.filter(function (item) { return item.selected; }).length;
    var savings = output && original ? Math.round((1 - output / original) * 100) : 0;

    $("#fileCount").textContent = files.length ? files.length + " / " + selectedCount : "0";
    $("#originalSize").textContent = formatBytes(original);
    $("#outputSize").textContent = formatBytes(output);
    $("#savingsSize").textContent = output ? savings + "%" : "0%";

    var hasFiles = files.length > 0;
    $("#processSelected").disabled = processing || !selectedCount;
    $("#downloadZip").disabled = processing || !selectedCount;
    $("#downloadSelected").disabled = processing || !selectedCount;
    $$(".mini-button[data-batch]").forEach(function (button) {
      button.disabled = !hasFiles;
    });
  }

  function createCard(item, settingsKey) {
    var card = document.createElement("article");
    card.className = "image-card";
    card.dataset.id = item.id;

    var badgeText = getBadgeText(item, settingsKey);
    var metaText = getMetaText(item);
    var outputText = item.result ? item.result.width + "x" + item.result.height + " - " + formatBytes(item.result.blob.size) : "Not exported yet";

    card.innerHTML =
      '<div class="card-preview">' +
        '<img src="' + attr(item.url) + '" alt="Preview of ' + attr(item.file.name) + '">' +
        '<label class="card-check" aria-label="Select ' + attr(item.file.name) + '">' +
          '<input type="checkbox" data-select ' + (item.selected ? "checked" : "") + '>' +
        '</label>' +
        '<span class="card-badge">' + text(badgeText) + '</span>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="card-name" title="' + attr(item.file.name) + '">' + text(item.file.name) + '</div>' +
        '<div class="card-meta">' +
          '<span>' + text(metaText) + '</span>' +
          '<span>' + text(outputText) + '</span>' +
        '</div>' +
        (item.error ? '<div class="card-error">' + text(item.error) + '</div>' : '') +
      '</div>' +
      '<div class="card-actions">' +
        '<button class="mini-button" type="button" data-action="process">Process</button>' +
        '<button class="mini-button" type="button" data-action="download">Download</button>' +
        '<button class="mini-button danger" type="button" data-action="remove">Remove</button>' +
      '</div>';

    return card;
  }

  function getBadgeText(item, settingsKey) {
    if (item.status === "processing") return "Processing";
    if (item.status === "error") return "Needs attention";
    if (item.result && item.result.settingsKey === settingsKey) return "Complete";
    if (item.result) return "Update ready";
    return "Queued";
  }

  function getMetaText(item) {
    var size = formatBytes(item.file.size);
    if (item.width && item.height) {
      return item.width + "x" + item.height + " - " + size;
    }
    return "Reading dimensions - " + size;
  }

  function processSelected(download, zip) {
    var selected = files.filter(function (item) { return item.selected; });
    processItems(selected, download, zip);
  }

  async function processItems(items, download, zip) {
    if (processing || !items.length) return;

    processing = true;
    setBadge("Processing " + items.length + " image" + (items.length === 1 ? "" : "s"));
    render();

    var settings = readSettings();
    var settingsKey = JSON.stringify(settings);
    var processed = [];

    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      if (item.status === "error" && !item.width) continue;

      try {
        if (!item.result || item.result.settingsKey !== settingsKey) {
          item.status = "processing";
          item.error = "";
          render();
          item.result = await processItem(item, settings, settingsKey);
          if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
          item.resultUrl = URL.createObjectURL(item.result.blob);
        }
        item.status = "complete";
        processed.push(item);
      } catch (error) {
        item.status = "error";
        item.error = error && error.message ? error.message : "Could not process this image.";
      }
    }

    processing = false;
    setBadge(processed.length ? "Processed " + processed.length : "Nothing processed");
    render();

    if (download && processed.length) {
      if (zip || processed.length > 1) {
        await downloadZip(processed);
      } else {
        downloadBlob(processed[0].result.blob, processed[0].result.name);
      }
    }
  }

  async function processItem(item, settings, settingsKey) {
    var image = await decodeImage(item.file);
    var layout = computeLayout(image.width, image.height, settings);
    var temp = document.createElement("canvas");
    temp.width = layout.canvasW;
    temp.height = layout.canvasH;

    var tempContext = temp.getContext("2d", { alpha: settings.mime !== "image/jpeg" });
    if (!tempContext) {
      closeImage(image);
      throw new Error("Canvas is not available in this browser.");
    }

    fillCanvas(tempContext, temp.width, temp.height, settings);
    tempContext.imageSmoothingEnabled = true;
    tempContext.imageSmoothingQuality = "high";
    tempContext.drawImage(
      image,
      layout.srcX,
      layout.srcY,
      layout.srcW,
      layout.srcH,
      layout.drawX,
      layout.drawY,
      layout.drawW,
      layout.drawH
    );
    closeImage(image);

    var finalCanvas = applyTransforms(temp, settings);
    var blob = await canvasToBlob(finalCanvas, settings.mime, settings.quality);
    var ext = extensionForMime(blob.type || settings.mime);
    var name = outputName(item.file.name, settings.suffix, ext);

    return {
      blob: blob,
      name: name,
      mime: blob.type || settings.mime,
      width: finalCanvas.width,
      height: finalCanvas.height,
      settingsKey: settingsKey
    };
  }

  function readSettings() {
    return {
      mime: $("#format").value,
      quality: clampNumber($("#quality").value, 35, 100, 82) / 100,
      background: $("#backgroundColor").value || "#ffffff",
      resizeMode: $("#resizeMode").value,
      maxEdge: clampNumber($("#maxEdge").value, 64, 12000, 1600),
      scalePercent: clampNumber($("#scalePercent").value, 1, 400, 50),
      squareSize: clampNumber($("#squareSize").value, 64, 6000, 1024),
      targetWidth: clampNumber($("#targetWidth").value, 1, 12000, 1200),
      targetHeight: clampNumber($("#targetHeight").value, 1, 12000, 800),
      preventUpscale: $("#preventUpscale").checked,
      focalPoint: $("#focalPoint").value,
      rotation: clampNumber($("#rotation").value, 0, 270, 0),
      flipHorizontal: $("#flipHorizontal").checked,
      flipVertical: $("#flipVertical").checked,
      suffix: $("#filenameSuffix").value || ""
    };
  }

  function computeLayout(srcW, srcH, settings) {
    var mode = settings.resizeMode;
    var layout = {
      srcX: 0,
      srcY: 0,
      srcW: srcW,
      srcH: srcH,
      canvasW: srcW,
      canvasH: srcH,
      drawX: 0,
      drawY: 0,
      drawW: srcW,
      drawH: srcH
    };

    if (mode === "none") {
      return layout;
    }

    if (mode === "max") {
      var maxEdge = Math.max(srcW, srcH);
      var scale = settings.maxEdge / maxEdge;
      if (settings.preventUpscale) scale = Math.min(1, scale);
      layout.canvasW = Math.max(1, Math.round(srcW * scale));
      layout.canvasH = Math.max(1, Math.round(srcH * scale));
      layout.drawW = layout.canvasW;
      layout.drawH = layout.canvasH;
      return layout;
    }

    if (mode === "percent") {
      var percentScale = settings.scalePercent / 100;
      layout.canvasW = Math.max(1, Math.round(srcW * percentScale));
      layout.canvasH = Math.max(1, Math.round(srcH * percentScale));
      layout.drawW = layout.canvasW;
      layout.drawH = layout.canvasH;
      return layout;
    }

    if (mode === "contain") {
      layout.canvasW = settings.targetWidth;
      layout.canvasH = settings.targetHeight;
      var containScale = Math.min(settings.targetWidth / srcW, settings.targetHeight / srcH);
      if (settings.preventUpscale) containScale = Math.min(1, containScale);
      layout.drawW = Math.max(1, Math.round(srcW * containScale));
      layout.drawH = Math.max(1, Math.round(srcH * containScale));
      layout.drawX = Math.round((layout.canvasW - layout.drawW) / 2);
      layout.drawY = Math.round((layout.canvasH - layout.drawH) / 2);
      return layout;
    }

    if (mode === "cover" || mode === "square") {
      var targetW = mode === "square" ? settings.squareSize : settings.targetWidth;
      var targetH = mode === "square" ? settings.squareSize : settings.targetHeight;
      var crop = coverCrop(srcW, srcH, targetW, targetH, settings.focalPoint);
      layout.srcX = crop.x;
      layout.srcY = crop.y;
      layout.srcW = crop.w;
      layout.srcH = crop.h;
      layout.canvasW = targetW;
      layout.canvasH = targetH;
      layout.drawW = targetW;
      layout.drawH = targetH;
      return layout;
    }

    return layout;
  }

  function coverCrop(srcW, srcH, targetW, targetH, focal) {
    var sourceRatio = srcW / srcH;
    var targetRatio = targetW / targetH;
    var cropW = srcW;
    var cropH = srcH;
    var x = 0;
    var y = 0;

    if (sourceRatio > targetRatio) {
      cropW = Math.round(srcH * targetRatio);
      if (focal === "left") {
        x = 0;
      } else if (focal === "right") {
        x = srcW - cropW;
      } else {
        x = Math.round((srcW - cropW) / 2);
      }
    } else {
      cropH = Math.round(srcW / targetRatio);
      if (focal === "top") {
        y = 0;
      } else if (focal === "bottom") {
        y = srcH - cropH;
      } else {
        y = Math.round((srcH - cropH) / 2);
      }
    }

    return { x: x, y: y, w: cropW, h: cropH };
  }

  function fillCanvas(context, width, height, settings) {
    if (settings.mime === "image/jpeg" || settings.resizeMode === "contain") {
      context.fillStyle = settings.background;
      context.fillRect(0, 0, width, height);
    } else {
      context.clearRect(0, 0, width, height);
    }
  }

  function applyTransforms(canvas, settings) {
    var rotation = settings.rotation % 360;
    var rotated = rotation === 90 || rotation === 270;
    var output = document.createElement("canvas");
    output.width = rotated ? canvas.height : canvas.width;
    output.height = rotated ? canvas.width : canvas.height;
    var context = output.getContext("2d", { alpha: settings.mime !== "image/jpeg" });
    if (!context) {
      throw new Error("Canvas is not available in this browser.");
    }
    fillCanvas(context, output.width, output.height, settings);
    context.translate(output.width / 2, output.height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.scale(settings.flipHorizontal ? -1 : 1, settings.flipVertical ? -1 : 1);
    context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return output;
  }

  function decodeImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file);
    }

    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("This browser could not decode the image."));
      };
      image.src = url;
    });
  }

  function closeImage(image) {
    if (image && typeof image.close === "function") {
      image.close();
    }
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error("This browser could not export that format."));
          return;
        }
        if (mime === "image/avif" && blob.type !== "image/avif") {
          reject(new Error("AVIF export is not supported in this browser."));
          return;
        }
        resolve(blob);
      }, mime, quality);
    });
  }

  async function detectAvifSupport() {
    var canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    try {
      var blob = await canvasToBlob(canvas, "image/avif", 0.8);
      if (blob.type === "image/avif") return;
    } catch (error) {
    }
    var avifOption = $('#format option[value="image/avif"]');
    if (avifOption) {
      avifOption.textContent = "AVIF not supported here";
      avifOption.disabled = true;
    }
    if ($("#format").value === "image/avif") {
      $("#format").value = "image/webp";
    }
  }

  async function downloadZip(items) {
    setBadge("Building ZIP");
    var entries = [];
    for (var i = 0; i < items.length; i += 1) {
      if (!items[i].result) continue;
      entries.push({
        name: items[i].result.name,
        data: new Uint8Array(await items[i].result.blob.arrayBuffer()),
        lastModified: items[i].file.lastModified || Date.now()
      });
    }
    if (!entries.length) return;
    var zipBlob = createZip(entries);
    downloadBlob(zipBlob, "imagefreely-images.zip");
    setBadge("ZIP ready");
  }

  function createZip(entries) {
    var chunks = [];
    var central = [];
    var offset = 0;

    entries.forEach(function (entry) {
      var nameBytes = new TextEncoder().encode(entry.name);
      var crc = crc32(entry.data);
      var dateTime = dosDateTime(new Date(entry.lastModified));
      var local = new Uint8Array(30 + nameBytes.length);
      var view = new DataView(local.buffer);
      writeHeader(view, 0x04034b50, dateTime, crc, entry.data.length, nameBytes.length);
      local.set(nameBytes, 30);
      chunks.push(local, entry.data);

      var centralHeader = new Uint8Array(46 + nameBytes.length);
      var centralView = new DataView(centralHeader.buffer);
      writeCentralHeader(centralView, dateTime, crc, entry.data.length, nameBytes.length, offset);
      centralHeader.set(nameBytes, 46);
      central.push(centralHeader);
      offset += local.length + entry.data.length;
    });

    var centralStart = offset;
    central.forEach(function (chunk) {
      chunks.push(chunk);
      offset += chunk.length;
    });

    var end = new Uint8Array(22);
    var endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, offset - centralStart, true);
    endView.setUint32(16, centralStart, true);
    chunks.push(end);

    return new Blob(chunks, { type: "application/zip" });
  }

  function writeHeader(view, signature, dateTime, crc, size, nameLength) {
    view.setUint32(0, signature, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, dateTime.time, true);
    view.setUint16(12, dateTime.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameLength, true);
  }

  function writeCentralHeader(view, dateTime, crc, size, nameLength, offset) {
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, dateTime.time, true);
    view.setUint16(14, dateTime.date, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, size, true);
    view.setUint32(24, size, true);
    view.setUint16(28, nameLength, true);
    view.setUint32(42, offset, true);
  }

  var crcTable = null;

  function crc32(data) {
    if (!crcTable) {
      crcTable = [];
      for (var n = 0; n < 256; n += 1) {
        var c = n;
        for (var k = 0; k < 8; k += 1) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < data.length; i += 1) {
      crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    var year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function outputName(inputName, suffix, extension) {
    var base = inputName.replace(/\.[^.]+$/, "");
    base = base.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "image";
    return base + suffix + "." + extension;
  }

  function extensionForMime(mime) {
    if (mime === "image/jpeg") return "jpg";
    if (mime === "image/png") return "png";
    if (mime === "image/avif") return "avif";
    return "webp";
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 KB";
    var units = ["B", "KB", "MB", "GB"];
    var value = bytes;
    var unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return (value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)) + " " + units[unit];
  }

  function clampNumber(value, min, max, fallback) {
    var number = Number(value);
    if (!Number.isFinite(number)) number = fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function findItem(id) {
    return files.find(function (item) { return item.id === id; });
  }

  function revokeItemUrls(item) {
    URL.revokeObjectURL(item.url);
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
  }

  function setBadge(message) {
    $("#engineBadge").textContent = message;
  }

  function text(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char];
    });
  }

  function attr(value) {
    return text(value);
  }
})();
