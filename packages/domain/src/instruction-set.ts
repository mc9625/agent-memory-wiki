import { DomainInvariantError } from "./errors";

export interface InstructionSet {
  readonly id: string;
  readonly version: number;
  readonly content: string;
  readonly createdAt: Date;
}

export const createInstructionSet = (input: InstructionSet): InstructionSet => {
  if (!input.id) {
    throw new DomainInvariantError("An instruction set requires an id");
  }

  if (!Number.isSafeInteger(input.version) || input.version <= 0) {
    throw new DomainInvariantError("An instruction-set version must be a positive integer");
  }

  if (input.content.trim().length === 0) {
    throw new DomainInvariantError("Instruction content must not be blank");
  }

  return Object.freeze({ ...input });
};
