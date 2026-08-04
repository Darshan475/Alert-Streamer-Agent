import type { Team } from "./types";

/** Suggested on-call assignees per team (dummy roster for human review assignment). */
export const TEAM_ASSIGNEES: Record<Team, string[]> = {
  platform: ["platform-oncall", "infra-lead", "k8s-sre"],
  sre: ["sre-oncall", "reliability-lead", "incident-commander"],
  database: ["dba-oncall", "postgres-admin", "data-platform"],
  security: ["sec-oncall", "ssl-admin", "compliance-lead"],
  payments: ["payments-oncall", "billing-sre", "fraud-analyst"],
  frontend: ["frontend-oncall", "web-lead", "ux-platform"],
  backend: ["backend-oncall", "api-lead", "checkout-sre"],
};

export const TEAMS: Team[] = [
  "platform",
  "sre",
  "database",
  "security",
  "payments",
  "frontend",
  "backend",
];

/** Map alert category keywords to recommended owning team. */
export function suggestTeam(category: string, currentTeam: Team): Team {
  const cat = category.toLowerCase();
  if (cat.includes("payment")) return "payments";
  if (cat.includes("database") || cat.includes("db")) return "database";
  if (cat.includes("ssl") || cat.includes("security")) return "security";
  if (cat.includes("api") || cat.includes("error")) return "backend";
  if (cat.includes("cpu") || cat.includes("disk") || cat.includes("kubernetes")) return "platform";
  if (cat.includes("memory") || cat.includes("pod")) return "sre";
  return currentTeam;
}
