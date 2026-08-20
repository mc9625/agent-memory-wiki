import type { ReadOnlyState } from "./ports/index";

export interface SettingsRepository {
  getReadOnly(): Promise<boolean | null>;
}

export class SafeReadOnlyState implements ReadOnlyState {
  readonly #emergencyOverride: boolean;
  readonly #settings: SettingsRepository;

  public constructor(settings: SettingsRepository, emergencyOverride: boolean) {
    this.#settings = settings;
    this.#emergencyOverride = emergencyOverride;
  }

  public async isReadOnly(): Promise<boolean> {
    if (this.#emergencyOverride) return true;
    try {
      return (await this.#settings.getReadOnly()) ?? true;
    } catch {
      return true;
    }
  }
}
