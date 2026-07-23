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

export type EducationCommand =
  | TeachCommand
  | ForgetCommand
  | ListCommand
  | SearchCommand
  | InvalidCommand;

export type CommandResult = {
  handled: boolean;
  message: string;
  speechText?: string;
};

export type PluginSettings = {
  educationCommandEnabled: boolean;
  forgetCommandEnabled: boolean;
};

export type StoreLike = {
  get(key: string, defaultValue?: unknown): unknown;
  set(key: string, value: unknown): void;
};
