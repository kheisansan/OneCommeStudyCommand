export type DictionaryFile = {
  version: 2;
  entries: DictionaryEntry[];
};

export type DictionaryEntry = {
  word: string;
  reading: string;
  priority: number;
  enabled: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type TeachCommand = {
  type: "teach";
  word: string;
  reading: string;
};

export type ForgetCommand = {
  type: "forget";
  word: string;
};

export type ListCommand = {
  type: "list";
};

export type SearchCommand = {
  type: "search";
  query: string;
};

export type InvalidCommand = {
  type: "invalid";
  message: string;
};

export type SharedTeachCommand = {
  type: "sharedTeach";
  word: string;
  reading: string;
};

export type SharedForgetCommand = {
  type: "sharedForget";
  word: string;
};

export type SharedApproveCommand = {
  type: "sharedApprove";
  word: string;
};

export type SharedRejectCommand = {
  type: "sharedReject";
  word: string;
};

export type EducationCommand =
  | TeachCommand
  | ForgetCommand
  | ListCommand
  | SearchCommand
  | InvalidCommand;

export type ParsedCommand =
  | EducationCommand
  | SharedTeachCommand
  | SharedForgetCommand
  | SharedApproveCommand
  | SharedRejectCommand;

export type CommandResult = {
  handled: boolean;
  message: string;
  speechText?: string;
};

export type PluginSettings = {
  educationCommandEnabled: boolean;
  forgetCommandEnabled: boolean;
  sharedEducationCommandEnabled: boolean;
  sharedForgetCommandEnabled: boolean;
  sharedReviewCommandEnabled: boolean;
};

export type StoreLike = {
  get(key: string, defaultValue?: unknown): unknown;
  set(key: string, value: unknown): void;
};
