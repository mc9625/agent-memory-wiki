/**
 * A slider panel for `VISUAL_CONFIG`, shown only when the URL carries `?tune=1`.
 *
 * This is a development tool, not part of the page. The reference's controls
 * panel is deliberately absent from `/world` because nothing on the page is
 * interactive; this is the opposite case — every control here does something,
 * and it is hidden unless it is asked for by name.
 *
 * Most knobs write straight into `VISUAL_CONFIG` and take effect on the next
 * frame. `faceShadeStrength` is baked into vertex colours, so it asks the caller
 * to rebuild the scene instead.
 */

import { VISUAL_CONFIG, VISUAL_DEFAULTS, type VisualConfig } from "./visual";

type NumericKey = {
  [K in keyof VisualConfig]: VisualConfig[K] extends number ? K : never;
}[keyof VisualConfig];

interface Field {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** True when the value is baked at build time and needs the scene rebuilt. */
  rebuild?: boolean;
}

const GROUPS: readonly { title: string; fields: readonly Field[] }[] = [
  {
    title: "Tone",
    fields: [
      { key: "exposure", label: "exposure", min: 0.4, max: 2, step: 0.01 },
      { key: "saturation", label: "saturation", min: 0.5, max: 1.8, step: 0.01 },
    ],
  },
  {
    title: "Key light",
    fields: [
      { key: "keyIntensity", label: "intensity", min: 0, max: 6, step: 0.05 },
      { key: "keyAzimuthDeg", label: "azimuth°", min: -180, max: 180, step: 1 },
      { key: "keyElevationDeg", label: "elevation°", min: 5, max: 88, step: 1 },
      { key: "shadowRadius", label: "shadow blur", min: 0, max: 12, step: 0.25 },
    ],
  },
  {
    title: "Key pool",
    fields: [
      { key: "keySpotIntensity", label: "amount", min: 0, max: 4, step: 0.05 },
      { key: "keySpotAngleDeg", label: "cone°", min: 10, max: 89, step: 1 },
      { key: "keySpotPenumbra", label: "softness", min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: "Fill",
    fields: [
      { key: "fillIntensity", label: "back fill", min: 0, max: 2, step: 0.01 },
      { key: "hemiIntensity", label: "hemisphere", min: 0, max: 2, step: 0.01 },
      { key: "ambientIntensity", label: "ambient", min: 0, max: 1, step: 0.01 },
      { key: "roomLightScale", label: "room lights", min: 0, max: 2, step: 0.01 },
    ],
  },
  {
    title: "Occlusion",
    fields: [
      { key: "aoIntensity", label: "AO amount", min: 0, max: 1.5, step: 0.01 },
      { key: "aoRadius", label: "AO radius", min: 0.2, max: 4, step: 0.05 },
    ],
  },
  {
    title: "Bloom",
    fields: [
      { key: "bloomStrength", label: "strength", min: 0, max: 1.5, step: 0.01 },
      { key: "bloomRadius", label: "radius", min: 0, max: 1.5, step: 0.01 },
      { key: "bloomThreshold", label: "threshold", min: 0, max: 1.5, step: 0.01 },
    ],
  },
  {
    title: "Voxel faces (rebuilds)",
    fields: [
      { key: "faceShadeStrength", label: "baked shade", min: 0, max: 1.5, step: 0.01, rebuild: true },
    ],
  },
];

/** True when the page was opened with `?tune=1`. */
export const tuningEnabled = (): boolean =>
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("tune");

export interface TunePanelHandlers {
  /** A runtime value changed; re-read the config. */
  onChange: () => void;
  /** A build-time value changed; the scene has to be compiled again. */
  onRebuild: () => void;
}

const CSS = `
/* Below the roster HUD, which owns the top-right corner. */
.world-tune{position:absolute;top:158px;right:12px;z-index:20;width:224px;max-height:calc(100% - 170px);
overflow:auto;padding:10px 12px 12px;border-radius:10px;background:rgba(18,20,26,.86);
color:#e8e6df;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;backdrop-filter:blur(6px);
box-shadow:0 8px 28px rgba(0,0,0,.35)}
.world-tune h4{margin:10px 0 4px;font-size:10px;letter-spacing:.09em;text-transform:uppercase;opacity:.55}
.world-tune h4:first-child{margin-top:0}
.world-tune label{display:block;margin-bottom:5px}
.world-tune .row{display:flex;align-items:center;justify-content:space-between;gap:6px}
.world-tune .row span{flex:1}
.world-tune .row b{font-weight:500;opacity:.8}
/* Dim until the value is off its default, so the panel does not read as
   sixteen buttons when nothing has been touched. */
.world-tune .reset{padding:0 2px;border:0;width:auto;margin:0;background:none;color:inherit;
line-height:1;opacity:.22;cursor:pointer;font-size:11px}
.world-tune .reset:hover{opacity:.9;background:none}
.world-tune .reset.on{opacity:.7;color:#7fd4ff}
.world-tune input{width:100%;margin:1px 0 0;accent-color:#7fd4ff}
.world-tune button{width:100%;margin-top:10px;padding:5px;border:0;border-radius:6px;
background:#2f3a4a;color:#e8e6df;font:inherit;cursor:pointer}
.world-tune button:hover{background:#3c4a5e}
`;

/**
 * Mounts the panel into `container`. Returns a disposer; a no-op when tuning is
 * not enabled, so the caller can always call it.
 */
export const createTunePanel = (
  container: HTMLElement,
  handlers: TunePanelHandlers,
): (() => void) => {
  if (!tuningEnabled()) return () => {};

  const style = document.createElement("style");
  style.textContent = CSS;
  const panel = document.createElement("div");
  panel.className = "world-tune";

  for (const group of GROUPS) {
    const heading = document.createElement("h4");
    heading.textContent = group.title;
    panel.append(heading);

    for (const field of group.fields) {
      const label = document.createElement("label");
      const row = document.createElement("div");
      row.className = "row";
      const name = document.createElement("span");
      name.textContent = field.label;
      const readout = document.createElement("b");
      const reset = document.createElement("button");
      reset.className = "reset";
      reset.type = "button";
      reset.textContent = "\u21ba";
      reset.title = `reset to ${VISUAL_DEFAULTS[field.key]}`;
      row.append(name, readout, reset);

      const input = document.createElement("input");
      input.type = "range";
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step);

      const show = (value: number): void => {
        input.value = String(value);
        readout.textContent = String(value);
        reset.classList.toggle("on", value !== VISUAL_DEFAULTS[field.key]);
      };
      show(VISUAL_CONFIG[field.key]);

      input.addEventListener("input", () => {
        const value = Number(input.value);
        VISUAL_CONFIG[field.key] = value;
        show(value);
        // A rebuild costs a full scene compile, so it waits for the drag to end.
        if (!field.rebuild) handlers.onChange();
      });
      if (field.rebuild) input.addEventListener("change", handlers.onRebuild);

      reset.addEventListener("click", () => {
        const value = VISUAL_DEFAULTS[field.key];
        if (value === VISUAL_CONFIG[field.key]) return;
        VISUAL_CONFIG[field.key] = value;
        show(value);
        if (field.rebuild) handlers.onRebuild();
        else handlers.onChange();
      });

      label.append(row, input);
      panel.append(label);
    }
  }

  const copy = document.createElement("button");
  copy.textContent = "copy config";
  copy.addEventListener("click", () => {
    void navigator.clipboard?.writeText(JSON.stringify(VISUAL_CONFIG, null, 2));
    copy.textContent = "copied";
    window.setTimeout(() => (copy.textContent = "copy config"), 1200);
  });
  panel.append(copy);

  container.append(style, panel);
  return () => {
    style.remove();
    panel.remove();
  };
};
