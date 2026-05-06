import { z } from "zod";
import { parseGithubUrl } from "@/app/lib/github";

const GithubUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((url) => /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url), {
    message: "Must be a valid Github repository URL.",
  });

export type ValidateRepoUrlState = {
  valid: boolean;
  error?: string;
  owner?: string;
  repo?: string;
  normalizedURL?: string;
};

export function validateGithubUrlFormat(rawUrl: string): ValidateRepoUrlState {
  const parsed = GithubUrlSchema.safeParse(rawUrl.trim());
  if (!parsed.success) return { valid: false, error: parsed.error.errors[0].message };
  const { owner, repo } = parseGithubUrl(parsed.data);
  return { valid: true, owner, repo, normalizedURL: `https://github.com/${owner}/${repo}` };
}
