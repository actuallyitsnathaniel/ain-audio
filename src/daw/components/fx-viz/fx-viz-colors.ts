/** Shared dry/wet palette for spectral FX assistants (SPECCOMP + IMPARTIALER). */

export const VIZ_DRY = "#3D6FA8";
export const VIZ_WET = "#00E676";

export const VIZ_DRY_RGB = [0x3d, 0x6f, 0xa8] as const;
export const VIZ_WET_RGB = [0x00, 0xe6, 0x76] as const;

export function parseHexRgb(hex: string): [number, number, number] {
  if (hex.startsWith("#") && hex.length >= 7) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }
  return [0, 0, 0];
}
