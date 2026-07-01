(function () {
  "use strict";

  var MODEL_BASE_URL = "https://data.imagefreely.com/background-removal/1.0.2/models";
  var U2NETP_HASH = "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8";

  var original = null;
  var editSource = null;
  var view = { x: 0, y: 0, scale: 1, width: 0, height: 0 };
  var crop = { x: 0, y: 0, w: 0, h: 0 };
  var history = [];
  var historyIndex = -1;
  var drag = null;
  var estimateTimer = null;
  var rembgSession = null;
  var activeSizeMode = "scale";
  var dragRenderFrame = null;
  var pendingPreset = "";

  var $ = function (selector) {
    return document.querySelector(selector);
  };

  var $$ = function (selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  };

  var presets = {
    avatar: { aspect: "1:1", width: 512, height: 512, format: "image/png", suffix: "-avatar" },
    social: { aspect: "1:1", width: 1080, height: 1080, format: "image/jpeg", quality: 88, suffix: "-social" },
    email: { aspect: "free", maxEdge: 1600, format: "image/jpeg", quality: 82, suffix: "-email" },
    webp: { aspect: "free", maxEdge: 1400, format: "image/webp", quality: 82, suffix: "-web" }
  };

  document.addEventListener("DOMContentLoaded", function () {
    bindEvents();
    syncQualityLabel();
    syncScaleLabel();
    syncSizeControls();
    detectAvifSupport();
    updateReadyState();
    drawEmpty();
  });

  function bindEvents() {
    var drop = $("#editorDrop");
    var input = $("#editorFileInput");
    var stage = $("#editorStage");

    input.addEventListener("change", function () {
      if (input.files && input.files[0]) {
        loadFile(input.files[0]);
      }
      input.value = "";
    });

    ["dragenter", "dragover"].forEach(function (eventName) {
      drop.addEventListener(eventName, function (event) {
        event.preventDefault();
        drop.classList.add("dragging");
      });
    });

    ["dragleave", "drop"].forEach(function (eventName) {
      drop.addEventListener(eventName, function (event) {
        event.preventDefault();
        drop.classList.remove("dragging");
        if (eventName === "drop" && event.dataTransfer && event.dataTransfer.files[0]) {
          loadFile(event.dataTransfer.files[0]);
        }
      });
    });

    document.addEventListener("paste", function (event) {
      var items = event.clipboardData ? Array.prototype.slice.call(event.clipboardData.items) : [];
      var imageItem = items.find(function (item) { return item.type && item.type.indexOf("image/") === 0; });
      if (imageItem) {
        var file = imageItem.getAsFile();
        if (file) loadFile(file);
      }
    });

    $("#editorForm").addEventListener("input", function (event) {
      handleControlInput(event);
    });

    $("#editorForm").addEventListener("change", function (event) {
      handleControlInput(event);
    });

    $("[data-editor-preset='avatar']").addEventListener("click", function () { applyPreset("avatar"); });
    $("[data-editor-preset='social']").addEventListener("click", function () { applyPreset("social"); });
    $("[data-editor-preset='email']").addEventListener("click", function () { applyPreset("email"); });
    $("[data-editor-preset='webp']").addEventListener("click", function () { applyPreset("webp"); });

    $("#undoButton").addEventListener("click", undo);
    $("#redoButton").addEventListener("click", redo);
    $("#resetCropButton").addEventListener("click", resetCrop);
    $("#downloadButton").addEventListener("click", downloadEditedImage);
    $("#removeBackgroundButton").addEventListener("click", removeBackground);

    stage.addEventListener("pointerdown", startCropDrag);
    window.addEventListener("pointermove", moveCropDrag);
    window.addEventListener("pointerup", endCropDrag);
    window.addEventListener("resize", scheduleRender);
  }

  async function loadFile(file) {
    if (!isLikelyImage(file)) {
      setBadge("Choose an image file");
      return;
    }

    try {
      setBadge("Loading image");
      var decodedImage = await decodeImage(file);
      if (editSource && editSource !== original) cleanupImage(editSource);
      cleanupImage(original);
      original = {
        file: file,
        image: decodedImage,
        removedBackground: false
      };
      editSource = original;
      crop = { x: 0, y: 0, w: original.image.width, h: original.image.height };
      setCustomSizeToCrop();
      history = [];
      historyIndex = -1;
      pushHistory();
      $("#editorWorkbench").hidden = false;
      updateReadyState();
      if (pendingPreset) {
        applyPreset(pendingPreset);
      } else {
        setBadge("Ready");
        render();
      }
    } catch (error) {
      setBadge("Could not decode image");
      $("#backgroundHelp").textContent = error && error.message ? error.message : "This browser could not decode that image.";
      updateReadyState();
    }
  }

  function handleControlInput(event) {
    if (event.target.id === "sizeMode") {
      if (original && event.target.value === "custom" && activeSizeMode !== "custom") {
        setCustomSize(getOutputSizeForMode(activeSizeMode));
      }
      activeSizeMode = event.target.value;
    }

    syncQualityLabel();
    syncScaleLabel();
    syncSizeControls();

    if (!original) {
      return;
    }

    if (event.target.id === "aspectRatio") {
      applyAspectToCrop();
      pushHistory();
    } else if (event.target.id === "outputWidth" && $("#sizeMode").value === "custom" && $("#lockOutputRatio").checked) {
      syncCustomHeightFromWidth();
    } else if (event.target.id === "outputHeight" && $("#sizeMode").value === "custom" && $("#lockOutputRatio").checked) {
      syncCustomWidthFromHeight();
    }

    render();
  }

  function applyPreset(name) {
    if (!presets[name]) return;
    var preset = presets[name];

    if (preset.format) {
      var formatOption = $('#format option[value="' + preset.format + '"]');
      if (!formatOption || !formatOption.disabled) {
        $("#format").value = preset.format;
      }
    }
    if (preset.quality) $("#quality").value = preset.quality;
    if (preset.suffix) $("#filenameSuffix").value = preset.suffix;

    syncQualityLabel();
    syncScaleLabel();
    syncSizeControls();

    if (!original) {
      pendingPreset = name;
      setBadge("Preset ready");
      return;
    }

    pendingPreset = "";

    if (preset.aspect) {
      $("#aspectRatio").value = preset.aspect;
      applyAspectToCrop();
    }

    if (preset.width && preset.height) {
      $("#sizeMode").value = "custom";
      activeSizeMode = "custom";
      $("#outputWidth").value = preset.width;
      $("#outputHeight").value = preset.height;
    } else if (preset.maxEdge) {
      $("#sizeMode").value = "custom";
      activeSizeMode = "custom";
      setMaxEdge(preset.maxEdge);
    }

    syncQualityLabel();
    syncScaleLabel();
    syncSizeControls();
    pushHistory();
    setBadge("Preset applied");
    render();
  }

  function startCropDrag(event) {
    if (!original || !event.target.closest("#cropBox")) return;
    event.preventDefault();
    var point = eventToImagePoint(event);
    drag = {
      pointerId: event.pointerId,
      handle: event.target.dataset.handle || "move",
      startPoint: point,
      startCrop: copyCrop(crop)
    };
    window.clearTimeout(estimateTimer);
    $("#editorStage").setPointerCapture(event.pointerId);
  }

  function moveCropDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId || !original) return;
    var point = eventToImagePoint(event);
    var dx = point.x - drag.startPoint.x;
    var dy = point.y - drag.startPoint.y;
    var next = copyCrop(drag.startCrop);
    var minSize = Math.max(12, Math.min(original.image.width, original.image.height) * 0.02);

    if (drag.handle === "move") {
      next.x += dx;
      next.y += dy;
      crop = clampCrop(next, minSize);
    } else {
      crop = resizeCropFromHandle(drag.handle, dx, dy, minSize);
    }

    scheduleDragRender();
  }

  function endCropDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (dragRenderFrame) {
      window.cancelAnimationFrame(dragRenderFrame);
      dragRenderFrame = null;
    }
    drag = null;
    pushHistory();
    render();
  }

  function resetCrop() {
    if (!original) return;
    crop = { x: 0, y: 0, w: original.image.width, h: original.image.height };
    pushHistory();
    render();
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    restoreHistory();
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    restoreHistory();
  }

  function pushHistory() {
    if (!original) return;
    var snapshot = {
      crop: copyCrop(crop),
      aspect: $("#aspectRatio").value
    };
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot);
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }

  function restoreHistory() {
    var snapshot = history[historyIndex];
    if (!snapshot) return;
    crop = copyCrop(snapshot.crop);
    $("#aspectRatio").value = snapshot.aspect;
    updateHistoryButtons();
    render();
  }

  function updateHistoryButtons() {
    $("#undoButton").disabled = historyIndex <= 0;
    $("#redoButton").disabled = historyIndex >= history.length - 1;
  }

  async function removeBackground() {
    if (!original) return;

    var button = $("#removeBackgroundButton");
    button.disabled = true;
    setBadge("Loading remover");
    $("#backgroundHelp").textContent = "Loading browser background-removal model...";

    try {
      var rembg = await ensureRembg();
      var session = await getRembgSession(rembg);
      var blob = await rembg.remove(original.file, {
        session: session,
        postProcessMask: true,
        onProgress: function (info) {
          if (info && info.message) {
            $("#backgroundHelp").textContent = info.message;
          }
          if (info && Number.isFinite(info.progress)) {
            setBadge(Math.round(info.progress) + "%");
          }
        }
      });
      cleanupImage(editSource !== original ? editSource : null);
      editSource = {
        file: new File([blob], outputName(original.file.name, "-background-removed", "png"), { type: "image/png" }),
        image: await decodeImage(blob),
        removedBackground: true
      };
      $("#backgroundMode").value = "transparent";
      $("#format").value = "image/png";
      setBadge("Background removed");
      $("#backgroundHelp").textContent = "Background removed locally. Use transparent PNG/WebP or add a solid color.";
      render();
    } catch (error) {
      setBadge("Removal unavailable");
      $("#backgroundHelp").textContent = error && error.message ? error.message : "Background removal could not run in this browser.";
    } finally {
      updateReadyState();
    }
  }

  async function ensureRembg() {
    var rembg = window.RembgWeb || window.rembgWeb;
    if (!window.ort || !rembg) {
      throw new Error("Background-removal runtime did not load.");
    }

    window.ort.env.logLevel = "fatal";
    window.ort.env.wasm.wasmPaths = "/assets/vendor/rembg/";
    window.ort.env.wasm.numThreads = window.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    window.ort.env.wasm.simd = true;

    rembg.rembgConfig.setBaseUrl(MODEL_BASE_URL);
    if (typeof rembg.setModelHash === "function") {
      rembg.setModelHash("u2netp.onnx", U2NETP_HASH);
    }
    return rembg;
  }

  async function getRembgSession(rembg) {
    if (rembgSession) return rembgSession;
    rembgSession = await rembg.newSession("u2netp", undefined, {
      numThreads: window.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1,
      executionProviders: ["wasm"]
    });
    return rembgSession;
  }

  function render(options) {
    if (!options || typeof options !== "object") options = {};
    if (!original) {
      drawEmpty();
      return;
    }

    resizeSourceCanvas();
    drawSourceCanvas();
    positionCropBox();
    updateMeta();
    if (options.deferPreview) {
      $("#estimateMeta").textContent = "Release to update";
      return;
    }
    drawOutputCanvas();
    scheduleEstimate();
  }

  function scheduleRender() {
    window.requestAnimationFrame(render);
  }

  function scheduleDragRender() {
    if (dragRenderFrame) return;
    dragRenderFrame = window.requestAnimationFrame(function () {
      dragRenderFrame = null;
      render({ deferPreview: true });
    });
  }

  function drawEmpty() {
    var canvas = $("#sourceCanvas");
    var output = $("#outputCanvas");
    if (canvas) {
      canvas.width = 800;
      canvas.height = 520;
      var context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (output) {
      output.width = 800;
      output.height = 520;
      output.getContext("2d").clearRect(0, 0, output.width, output.height);
    }
  }

  function resizeSourceCanvas() {
    var canvas = $("#sourceCanvas");
    var stage = $("#editorStage");
    var dpr = window.devicePixelRatio || 1;
    var width = Math.max(1, stage.clientWidth);
    var height = Math.max(1, stage.clientHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
  }

  function drawSourceCanvas() {
    var canvas = $("#sourceCanvas");
    var context = canvas.getContext("2d");
    var image = editSource.image;
    var padding = 28 * (window.devicePixelRatio || 1);
    var availableW = Math.max(1, canvas.width - padding * 2);
    var availableH = Math.max(1, canvas.height - padding * 2);
    var scale = Math.min(availableW / image.width, availableH / image.height);
    var drawW = image.width * scale;
    var drawH = image.height * scale;
    var drawX = (canvas.width - drawW) / 2;
    var drawY = (canvas.height - drawH) / 2;

    view = {
      x: drawX / (window.devicePixelRatio || 1),
      y: drawY / (window.devicePixelRatio || 1),
      scale: scale / (window.devicePixelRatio || 1),
      width: drawW / (window.devicePixelRatio || 1),
      height: drawH / (window.devicePixelRatio || 1)
    };

    context.clearRect(0, 0, canvas.width, canvas.height);
    drawChecker(context, canvas.width, canvas.height, 16 * (window.devicePixelRatio || 1));
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, drawX, drawY, drawW, drawH);

    context.save();
    context.fillStyle = "rgba(23, 33, 31, 0.48)";
    context.beginPath();
    context.rect(drawX, drawY, drawW, drawH);
    context.rect(
      drawX + crop.x * scale,
      drawY + crop.y * scale,
      crop.w * scale,
      crop.h * scale
    );
    context.fill("evenodd");
    context.restore();
  }

  function positionCropBox() {
    var box = $("#cropBox");
    if (!original) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.style.left = (view.x + crop.x * view.scale) + "px";
    box.style.top = (view.y + crop.y * view.scale) + "px";
    box.style.width = Math.max(20, crop.w * view.scale) + "px";
    box.style.height = Math.max(20, crop.h * view.scale) + "px";
  }

  function drawOutputCanvas() {
    var output = $("#outputCanvas");
    var result = renderResultCanvas();
    var maxW = output.parentElement.clientWidth || 800;
    var maxH = 420;
    var scale = Math.min(maxW / result.width, maxH / result.height, 1);
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    var dpr = window.devicePixelRatio || 1;
    output.width = Math.max(1, Math.round(result.width * scale * dpr));
    output.height = Math.max(1, Math.round(result.height * scale * dpr));
    output.style.width = Math.round(result.width * scale) + "px";
    output.style.height = Math.round(result.height * scale) + "px";
    var context = output.getContext("2d");
    context.clearRect(0, 0, output.width, output.height);
    drawChecker(context, output.width, output.height, 14 * dpr);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(result, 0, 0, output.width, output.height);
  }

  function renderResultCanvas() {
    var settings = readSettings();
    var source = editSource.image;
    var outW = settings.width;
    var outH = settings.height;

    var temp = document.createElement("canvas");
    temp.width = outW;
    temp.height = outH;
    var tempContext = temp.getContext("2d", { alpha: settings.hasAlpha });
    fillBackground(tempContext, temp.width, temp.height, settings);
    tempContext.imageSmoothingEnabled = true;
    tempContext.imageSmoothingQuality = "high";
    tempContext.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
    return applyTransforms(temp, settings);
  }

  async function downloadEditedImage() {
    if (!original) return;
    try {
      setBadge("Exporting");
      var settings = readSettings();
      var canvas = renderResultCanvas();
      var blob = await canvasToBlob(canvas, settings.mime, settings.quality);
      var ext = extensionForMime(blob.type || settings.mime);
      downloadBlob(blob, outputName(original.file.name, settings.suffix, ext));
      setBadge("Downloaded");
    } catch (error) {
      setBadge("Export failed");
      $("#backgroundHelp").textContent = error && error.message ? error.message : "Could not export that format.";
    }
  }

  function readSettings() {
    var mime = $("#format").value;
    var backgroundMode = $("#backgroundMode").value;
    var hasAlpha = mime !== "image/jpeg" && backgroundMode === "transparent";
    var outputSize = getOutputSize();
    return {
      mime: mime,
      quality: clampNumber($("#quality").value, 35, 100, 90) / 100,
      width: outputSize.width,
      height: outputSize.height,
      preventUpscale: $("#preventUpscale").checked,
      backgroundMode: backgroundMode,
      background: $("#backgroundColor").value || "#ffffff",
      hasAlpha: hasAlpha,
      rotation: clampNumber($("#rotation").value, 0, 270, 0),
      flipHorizontal: $("#flipHorizontal").checked,
      flipVertical: $("#flipVertical").checked,
      suffix: $("#filenameSuffix").value || ""
    };
  }

  function getOutputSize() {
    return getOutputSizeForMode($("#sizeMode").value);
  }

  function getOutputSizeForMode(mode) {
    var width;
    var height;

    if (mode === "custom") {
      width = clampNumber($("#outputWidth").value, 1, 12000, Math.max(1, Math.round(crop.w)));
      height = clampNumber($("#outputHeight").value, 1, 12000, Math.max(1, Math.round(crop.h)));
    } else {
      var scale = clampNumber($("#outputScale").value, 10, 200, 100) / 100;
      width = Math.max(1, Math.round(crop.w * scale));
      height = Math.max(1, Math.round(crop.h * scale));
    }

    if ($("#preventUpscale").checked) {
      var scaleLimit = Math.min(1, crop.w / width, crop.h / height);
      width = Math.max(1, Math.round(width * scaleLimit));
      height = Math.max(1, Math.round(height * scaleLimit));
    }

    return { width: width, height: height };
  }

  function updateMeta() {
    var settings = readSettings();
    $("#sourceMeta").textContent = original.image.width + " x " + original.image.height + " - " + formatBytes(original.file.size);
    $("#cropMeta").textContent = Math.round(crop.w) + " x " + Math.round(crop.h);
    $("#outputMeta").textContent = settings.width + " x " + settings.height;
    updateHistoryButtons();
  }

  function scheduleEstimate() {
    window.clearTimeout(estimateTimer);
    $("#estimateMeta").textContent = "Estimating";
    estimateTimer = window.setTimeout(async function () {
      if (!original) return;
      try {
        var settings = readSettings();
        var canvas = renderResultCanvas();
        var blob = await canvasToBlob(canvas, settings.mime, settings.quality);
        $("#estimateMeta").textContent = formatBytes(blob.size);
      } catch (error) {
        $("#estimateMeta").textContent = "Unsupported";
      }
    }, 250);
  }

  function applyAspectToCrop() {
    var ratio = getAspectRatio();
    if (!ratio || !original) return;

    var currentCenterX = crop.x + crop.w / 2;
    var currentCenterY = crop.y + crop.h / 2;
    var nextW = crop.w;
    var nextH = nextW / ratio;
    if (nextH > crop.h) {
      nextH = crop.h;
      nextW = nextH * ratio;
    }
    crop = clampCrop({
      x: currentCenterX - nextW / 2,
      y: currentCenterY - nextH / 2,
      w: nextW,
      h: nextH
    }, 12);
  }

  function resizeCropFromHandle(handle, dx, dy, minSize) {
    var start = drag.startCrop;
    var edges = {
      left: start.x,
      top: start.y,
      right: start.x + start.w,
      bottom: start.y + start.h
    };

    if (handle.indexOf("w") !== -1) edges.left = start.x + dx;
    if (handle.indexOf("e") !== -1) edges.right = start.x + start.w + dx;
    if (handle.indexOf("n") !== -1) edges.top = start.y + dy;
    if (handle.indexOf("s") !== -1) edges.bottom = start.y + start.h + dy;

    edges = clampResizeEdges(edges, handle, minSize);

    var ratio = getAspectRatio();
    if (!ratio) {
      return rectFromEdges(edges);
    }

    if (handle.length === 2) {
      return resizeCornerWithAspect(handle, edges, ratio, minSize);
    }

    return resizeEdgeWithAspect(handle, edges, ratio, minSize);
  }

  function clampResizeEdges(edges, handle, minSize) {
    var image = editSource.image;

    if (handle.indexOf("w") !== -1) {
      edges.left = clampFloat(edges.left, 0, edges.right - minSize);
    } else if (handle.indexOf("e") !== -1) {
      edges.right = clampFloat(edges.right, edges.left + minSize, image.width);
    }

    if (handle.indexOf("n") !== -1) {
      edges.top = clampFloat(edges.top, 0, edges.bottom - minSize);
    } else if (handle.indexOf("s") !== -1) {
      edges.bottom = clampFloat(edges.bottom, edges.top + minSize, image.height);
    }

    return edges;
  }

  function resizeCornerWithAspect(handle, edges, ratio, minSize) {
    var start = drag.startCrop;
    var image = editSource.image;
    var anchorX = handle.indexOf("w") !== -1 ? start.x + start.w : start.x;
    var anchorY = handle.indexOf("n") !== -1 ? start.y + start.h : start.y;
    var maxW = handle.indexOf("w") !== -1 ? anchorX : image.width - anchorX;
    var maxH = handle.indexOf("n") !== -1 ? anchorY : image.height - anchorY;
    var width = handle.indexOf("w") !== -1 ? anchorX - edges.left : edges.right - anchorX;
    var height = handle.indexOf("n") !== -1 ? anchorY - edges.top : edges.bottom - anchorY;

    width = Math.max(minSize, width);
    height = Math.max(minSize, height);
    if (width / height > ratio) {
      width = height * ratio;
    } else {
      height = width / ratio;
    }

    var size = fitAspectSize(width, height, ratio, minSize, maxW, maxH);
    var x = handle.indexOf("w") !== -1 ? anchorX - size.width : anchorX;
    var y = handle.indexOf("n") !== -1 ? anchorY - size.height : anchorY;
    return { x: x, y: y, w: size.width, h: size.height };
  }

  function resizeEdgeWithAspect(handle, edges, ratio, minSize) {
    var start = drag.startCrop;
    var image = editSource.image;
    var centerX = start.x + start.w / 2;
    var centerY = start.y + start.h / 2;
    var x = start.x;
    var y = start.y;
    var width = start.w;
    var height = start.h;

    if (handle === "w" || handle === "e") {
      var anchorX = handle === "w" ? start.x + start.w : start.x;
      var maxW = handle === "w" ? anchorX : image.width - anchorX;
      width = handle === "w" ? anchorX - edges.left : edges.right - anchorX;
      height = width / ratio;
      var horizontalSize = fitAspectSize(width, height, ratio, minSize, maxW, image.height);
      width = horizontalSize.width;
      height = horizontalSize.height;
      x = handle === "w" ? anchorX - width : anchorX;
      y = clampFloat(centerY - height / 2, 0, image.height - height);
    } else {
      var anchorY = handle === "n" ? start.y + start.h : start.y;
      var maxH = handle === "n" ? anchorY : image.height - anchorY;
      height = handle === "n" ? anchorY - edges.top : edges.bottom - anchorY;
      width = height * ratio;
      var verticalSize = fitAspectSize(width, height, ratio, minSize, image.width, maxH);
      width = verticalSize.width;
      height = verticalSize.height;
      x = clampFloat(centerX - width / 2, 0, image.width - width);
      y = handle === "n" ? anchorY - height : anchorY;
    }

    return { x: x, y: y, w: width, h: height };
  }

  function fitAspectSize(width, height, ratio, minSize, maxW, maxH) {
    maxW = Math.max(1, maxW);
    maxH = Math.max(1, maxH);
    width = Math.max(Math.min(minSize, maxW), Math.min(width, maxW));
    height = Math.max(Math.min(minSize, maxH), Math.min(height, maxH));

    if (width / height > ratio) {
      width = height * ratio;
    } else {
      height = width / ratio;
    }

    if (width > maxW) {
      width = maxW;
      height = width / ratio;
    }
    if (height > maxH) {
      height = maxH;
      width = height * ratio;
    }
    if (width > maxW) {
      width = maxW;
      height = width / ratio;
    }

    return {
      width: Math.max(1, Math.min(width, maxW)),
      height: Math.max(1, Math.min(height, maxH))
    };
  }

  function rectFromEdges(edges) {
    return {
      x: edges.left,
      y: edges.top,
      w: edges.right - edges.left,
      h: edges.bottom - edges.top
    };
  }

  function getAspectRatio() {
    var value = $("#aspectRatio").value;
    if (value === "free") return null;
    var parts = value.split(":").map(Number);
    return parts[0] / parts[1];
  }

  function syncCustomHeightFromWidth() {
    var width = clampNumber($("#outputWidth").value, 1, 12000, Math.round(crop.w));
    $("#outputHeight").value = Math.max(1, Math.round(width * crop.h / crop.w));
  }

  function syncCustomWidthFromHeight() {
    var height = clampNumber($("#outputHeight").value, 1, 12000, Math.round(crop.h));
    $("#outputWidth").value = Math.max(1, Math.round(height * crop.w / crop.h));
  }

  function setCustomSizeToCrop() {
    $("#outputWidth").value = Math.max(1, Math.round(crop.w));
    $("#outputHeight").value = Math.max(1, Math.round(crop.h));
  }

  function setCustomSize(size) {
    $("#outputWidth").value = Math.max(1, Math.round(size.width));
    $("#outputHeight").value = Math.max(1, Math.round(size.height));
  }

  function setMaxEdge(maxEdge) {
    var scale = Math.min(1, maxEdge / Math.max(crop.w, crop.h));
    $("#outputWidth").value = Math.max(1, Math.round(crop.w * scale));
    $("#outputHeight").value = Math.max(1, Math.round(crop.h * scale));
  }

  function clampCrop(next, minSize) {
    var image = editSource.image;
    var cropW = Math.max(minSize, Math.min(next.w, image.width));
    var cropH = Math.max(minSize, Math.min(next.h, image.height));
    var x = Math.max(0, Math.min(next.x, image.width - cropW));
    var y = Math.max(0, Math.min(next.y, image.height - cropH));
    return { x: x, y: y, w: cropW, h: cropH };
  }

  function eventToImagePoint(event) {
    var rect = $("#editorStage").getBoundingClientRect();
    return {
      x: clampNumber((event.clientX - rect.left - view.x) / view.scale, 0, editSource.image.width, 0),
      y: clampNumber((event.clientY - rect.top - view.y) / view.scale, 0, editSource.image.height, 0)
    };
  }

  function applyTransforms(canvas, settings) {
    var rotation = settings.rotation % 360;
    var rotated = rotation === 90 || rotation === 270;
    var output = document.createElement("canvas");
    output.width = rotated ? canvas.height : canvas.width;
    output.height = rotated ? canvas.width : canvas.height;
    var context = output.getContext("2d", { alpha: settings.hasAlpha });
    fillBackground(context, output.width, output.height, settings);
    context.translate(output.width / 2, output.height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.scale(settings.flipHorizontal ? -1 : 1, settings.flipVertical ? -1 : 1);
    context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return output;
  }

  function fillBackground(context, width, height, settings) {
    if (!settings.hasAlpha) {
      context.fillStyle = settings.background;
      context.fillRect(0, 0, width, height);
    } else {
      context.clearRect(0, 0, width, height);
    }
  }

  function drawChecker(context, width, height, size) {
    context.fillStyle = "#f6f2ea";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "rgba(23, 33, 31, 0.06)";
    for (var y = 0; y < height; y += size) {
      for (var x = 0; x < width; x += size) {
        if ((x / size + y / size) % 2 === 0) {
          context.fillRect(x, y, size, size);
        }
      }
    }
  }

  function syncQualityLabel() {
    var quality = clampNumber($("#quality").value, 35, 100, 90);
    $("#quality").value = quality;
    $("#qualityValue").textContent = quality + "%";
  }

  function syncScaleLabel() {
    var scale = clampNumber($("#outputScale").value, 10, 200, 100);
    $("#outputScale").value = scale;
    $("#scaleValue").textContent = scale + "%";
  }

  function syncSizeControls() {
    var mode = $("#sizeMode").value;
    $("#scaleControls").hidden = mode !== "scale";
    $("#customSizeControls").hidden = mode !== "custom";
    $("#lockOutputLine").hidden = mode !== "custom";

    if (mode === "custom") {
      $("#resizeHelp").textContent = "Crop changes the frame; width and height stay fixed for the export.";
    } else {
      $("#resizeHelp").textContent = "Set scale to 100% to export at the crop's native pixel size.";
    }
  }

  function updateReadyState() {
    var hasImage = Boolean(original);
    $("#removeBackgroundButton").disabled = !hasImage;
    $("#downloadButton").disabled = !hasImage;
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

  function isLikelyImage(file) {
    var name = file.name.toLowerCase();
    return /^image\//.test(file.type) || /\.(heic|heif|avif|webp|png|jpe?g|gif|bmp|tiff?)$/.test(name);
  }

  function decodeImage(fileOrBlob) {
    if (window.createImageBitmap) {
      return createImageBitmap(fileOrBlob);
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(fileOrBlob);
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

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
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

  function clampFloat(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function copyCrop(source) {
    return { x: source.x, y: source.y, w: source.w, h: source.h };
  }

  function setBadge(message) {
    $("#editorBadge").textContent = message;
  }

  function cleanupImage(source) {
    if (source && source.image && typeof source.image.close === "function") {
      source.image.close();
    }
  }
})();
