export type PageSection = 
  | "Checkout"
  | "PdP"
  | "Carrinho"
  | "Login"
  | "Meus pedidos"
  | "Meus dados"
  | "Minha conta"
  | "PdP/Carrinho"
  | "Pdp";

export type LoginState = "Sim" | "Não" | "Sim e não";

export type ResolutionStatus = "Resolvido" | "Ajustado" | "Pendente" | "Precisa de info";

export interface RawBugEntry {
  pageSection: string;
  error: string;
  loggedIn: string;
  tester: string;
  observations: string;
}

export interface BugEntry {
  pageSection: PageSection | null;
  error: string;
  loggedIn: LoginState | null;
  tester: string;
  observations: string;
  resolutionStatus: ResolutionStatus;
  subUrls: string[];
}

export interface ParsedBugData {
  bugs: BugEntry[];
  rawEntries: RawBugEntry[];
}

export function parseResolutionStatus(observations: string): ResolutionStatus {
  const obs = observations.toLowerCase();
  if (obs.includes("resolvido")) return "Resolvido";
  if (obs.includes("ajustado")) return "Ajustado";
  if (obs.includes("como") && (obs.includes("reproduzo") || obs.includes("reproduz"))) return "Precisa de info";
  return "Pendente";
}

export function isValidPageSection(section: string): section is PageSection {
  return ["Checkout", "PdP", "Carrinho", "Login", "Meus pedidos", "Meus dados", "Minha conta", "PdP/Carrinho", "Pdp"].includes(section);
}

export function isValidLoginState(state: string): state is LoginState {
  return ["Sim", "Não", "Sim e não"].includes(state);
}

export function isUrl(text: string): boolean {
  return text.startsWith("https://") || text.startsWith("http://");
}