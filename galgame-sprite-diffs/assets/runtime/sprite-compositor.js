/**
 * Lossless Galgame eye/mouth compositor for exported sprite packages.
 * Patches are exact rectangular replacement crops, not alpha overlays.
 */
export class GalSpriteCompositor {
  constructor(canvas, manifest, manifestUrl) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError("canvas must be an HTMLCanvasElement");
    }
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: true });
    this.context.imageSmoothingEnabled = false;
    this.manifest = manifest;
    this.manifestUrl = new URL(manifestUrl, window.location.href);
    this.figureId = null;
    this.figure = null;
    this.images = new Map();
    this.eyeState = "base";
    this.mouthState = "base";
    this._talkTimer = null;
    this._blinkTimer = null;
    this._blinkTimers = [];
  }

  static async load(canvas, manifestUrl = "./runtime-manifest.json") {
    const response = await fetch(manifestUrl);
    if (!response.ok) {
      throw new Error(`Unable to load runtime manifest: ${response.status}`);
    }
    const manifest = await response.json();
    if (manifest.schema_version !== 1 || manifest.patch_mode !== "replace-rect") {
      throw new Error("Unsupported sprite runtime manifest");
    }
    const runtime = new GalSpriteCompositor(canvas, manifest, manifestUrl);
    const firstFigure = Object.keys(manifest.figures)[0];
    if (!firstFigure) throw new Error("Runtime manifest contains no figures");
    await runtime.setFigure(firstFigure);
    return runtime;
  }

  _url(relativePath) {
    return new URL(relativePath, this.manifestUrl).href;
  }

  async _image(relativePath) {
    const url = this._url(relativePath);
    if (this.images.has(url)) return this.images.get(url);
    const image = new Image();
    image.decoding = "async";
    const promise = new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to load sprite image: ${url}`));
    });
    image.src = url;
    this.images.set(url, promise);
    return promise;
  }

  async setFigure(figureId) {
    const figure = this.manifest.figures[figureId];
    if (!figure) throw new Error(`Unknown figure: ${figureId}`);
    this.stopSpeaking(false);
    this.stopBlinking(false);
    this.figureId = figureId;
    this.figure = figure;
    this.eyeState = "base";
    this.mouthState = "base";
    const paths = [figure.base, ...Object.values(figure.parts).map((part) => part.file)];
    await Promise.all(paths.map((path) => this._image(path)));
    this.canvas.width = this.manifest.canvas.width;
    this.canvas.height = this.manifest.canvas.height;
    await this.render();
  }

  availableEyeStates() {
    return ["base", ...Object.keys(this.figure.parts).filter((key) => key.startsWith("eyes_"))];
  }

  availableMouthStates() {
    return ["base", ...Object.keys(this.figure.parts).filter((key) => key.startsWith("mouth_"))];
  }

  async setEyes(state = "base") {
    if (!this.availableEyeStates().includes(state)) {
      throw new Error(`Eye state ${state} is not available for ${this.figureId}`);
    }
    this.eyeState = state;
    await this.render();
  }

  async setMouth(state = "base") {
    if (!this.availableMouthStates().includes(state)) {
      throw new Error(`Mouth state ${state} is not available for ${this.figureId}`);
    }
    this.mouthState = state;
    await this.render();
  }

  async _replace(part) {
    const image = await this._image(part.file);
    const { x, y, width, height } = part.rect;
    this.context.clearRect(x, y, width, height);
    this.context.drawImage(image, x, y, width, height);
  }

  async render() {
    if (!this.figure) return;
    const base = await this._image(this.figure.base);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.drawImage(base, 0, 0, this.canvas.width, this.canvas.height);
    if (this.eyeState !== "base") await this._replace(this.figure.parts[this.eyeState]);
    if (this.mouthState !== "base") await this._replace(this.figure.parts[this.mouthState]);
  }

  startSpeaking({ intervalMs = 105 } = {}) {
    this.stopSpeaking();
    const states = ["mouth_half_open", "mouth_open"].filter((state) =>
      this.availableMouthStates().includes(state),
    );
    if (!states.length) return () => {};
    let index = 0;
    this.setMouth(states[index]);
    this._talkTimer = window.setInterval(() => {
      index = (index + 1) % (states.length + 1);
      this.setMouth(index === states.length ? "base" : states[index]);
    }, intervalMs);
    return () => this.stopSpeaking();
  }

  stopSpeaking(render = true) {
    if (this._talkTimer !== null) window.clearInterval(this._talkTimer);
    this._talkTimer = null;
    if (this.figure && this.mouthState !== "base") {
      this.mouthState = "base";
      if (render) this.render();
    }
  }

  speakFor(durationMs, options = {}) {
    this.startSpeaking(options);
    return new Promise((resolve) => {
      window.setTimeout(() => {
        this.stopSpeaking();
        resolve();
      }, durationMs);
    });
  }

  startBlinking({ minDelayMs = 2600, maxDelayMs = 5200, halfMs = 55, closedMs = 90 } = {}) {
    this.stopBlinking();
    if (!this.availableEyeStates().includes("eyes_close")) return () => {};
    const schedule = () => {
      const delay = minDelayMs + Math.random() * Math.max(0, maxDelayMs - minDelayMs);
      this._blinkTimer = window.setTimeout(async () => {
        if (this.availableEyeStates().includes("eyes_half")) {
          await this.setEyes("eyes_half");
          this._blinkTimers.push(window.setTimeout(() => this.setEyes("eyes_close"), halfMs));
          this._blinkTimers.push(
            window.setTimeout(() => this.setEyes("eyes_half"), halfMs + closedMs),
          );
          this._blinkTimers.push(
            window.setTimeout(() => {
              this.setEyes("base");
              schedule();
            }, halfMs * 2 + closedMs),
          );
        } else {
          await this.setEyes("eyes_close");
          this._blinkTimers.push(
            window.setTimeout(() => {
              this.setEyes("base");
              schedule();
            }, closedMs),
          );
        }
      }, delay);
    };
    schedule();
    return () => this.stopBlinking();
  }

  stopBlinking(render = true) {
    if (this._blinkTimer !== null) window.clearTimeout(this._blinkTimer);
    this._blinkTimer = null;
    for (const timer of this._blinkTimers) window.clearTimeout(timer);
    this._blinkTimers = [];
    if (this.figure && this.eyeState !== "base") {
      this.eyeState = "base";
      if (render) this.render();
    }
  }

  toBlob(type = "image/png", quality) {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed"))), type, quality);
    });
  }

  dispose() {
    this.stopSpeaking(false);
    this.stopBlinking(false);
    this.images.clear();
  }
}
