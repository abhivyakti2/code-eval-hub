// This file contains type definitions for your data.
// It describes the shape of the data, and what data type each property should accept.
// Types are generated automatically if you're using an ORM such as Prisma.

import { MessageFeature } from "@prisma/client";


export type SignUpState = {
  errors?: {
    //shape matches the result of zod's flatten method, which organizes errors by field
    email?: string[];
    password?: string[];
    confirmPassword?: string[];
  };
  message?: string | null;
};

export type LoginState = {
  errors?: {
    email?: string[];
    password?: string[];
  };
  message?: string | null;
};
// TODO : move state types to separate file? since they are used in both server actions and UI components. or keep them here since they are closely related to the actions?
export type AddRepoState = {
  error?: string | null;
  repoId?: string;
  chatId?: string;
  message?: string | null;
};
// error will be about url validation or database error, message will be more general, like "Failed to add repository." or "Repository added successfully." We can use message to show success messages as well, not just error messages.

export type ValidateRepoUrlState = {
  valid: boolean;
  error?: string;
  owner?: string;
  repo?: string;
  normalizedURL?: string;
}; //state and zod schema are different
//is creating type bestpractice to do this?

export type ChatHistoryItem = {
  id: string;
  repositoryId: string;
  repository: { name: string; githubUrl: string };
  _count: { messages: number };
};

export type RepoAction = MessageFeature;

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  features?: RepoAction[];
};