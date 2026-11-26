import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: {
  env: {
    GITHUB_REPOSITORY?: string;
    GITHUB_PAGES?: string;
    VITE_BASE_PATH?: string;
  };
};

const [owner, repository] = process.env.GITHUB_REPOSITORY?.split("/") ?? [];
const isUserOrOrgPage =
  repository?.toLowerCase() === `${owner?.toLowerCase()}.github.io`;
const githubPagesBase =
  repository && !isUserOrOrgPage ? `/${repository}/` : "/";
const baseOverride = process.env.VITE_BASE_PATH?.trim();
const base =
  baseOverride ||
  (process.env.GITHUB_PAGES === "true" ? githubPagesBase : "/");

export default defineConfig({
  base,
  plugins: [react()],
});
